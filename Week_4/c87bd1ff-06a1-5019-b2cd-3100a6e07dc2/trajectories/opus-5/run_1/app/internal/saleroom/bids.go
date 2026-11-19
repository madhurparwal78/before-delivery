package saleroom

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"gavelhouse/internal/domain"
)

// BidRequest is one attempt to place a maximum on a lot.
type BidRequest struct {
	LotID string
	Type  string
	// MaxAmount is nil when the field was missing or not a JSON integer.
	MaxAmount      *int
	IdempotencyKey string
	BodyHash       string
}

// StoredResponse is an API answer kept against an idempotency key, so a bid
// sent twice counts once and both attempts get the same answer.
type StoredResponse struct {
	Status int
	Body   json.RawMessage
}

// PlaceBid decides one bid: it settles anything due, honours the idempotency
// key, checks the amount rules and the spending limit, applies the
// price-and-leader rule and moves the lot's close inside the soft-close
// window.
func (s *Saleroom) PlaceBid(ctx context.Context, v Viewer, req BidRequest) (StoredResponse, error) {
	var out StoredResponse
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		serverNow, err := now(ctx, tx)
		if err != nil {
			return err
		}
		// Each bidder's bids are decided one at a time.
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, v.PersonID); err != nil {
			return fmt.Errorf("take the bidder's turn: %w", err)
		}
		if err := s.settle(ctx, tx, serverNow); err != nil {
			return err
		}
		stored, owned, err := claimIdempotencyKey(ctx, tx, v.PersonID, req.IdempotencyKey, req.BodyHash)
		if err != nil {
			return err
		}
		if !owned {
			out = stored
			return nil
		}
		status, body, err := s.decideBid(ctx, tx, v, req, serverNow)
		if err != nil {
			return err
		}
		raw, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("encode bid response: %w", err)
		}
		_, err = tx.Exec(ctx,
			`UPDATE idempotency_keys SET status = $3, response = $4
			  WHERE person_id = $1 AND key = $2`, v.PersonID, req.IdempotencyKey, status, raw)
		if err != nil {
			return fmt.Errorf("store bid response: %w", err)
		}
		out = StoredResponse{Status: status, Body: raw}
		return nil
	})
	return out, err
}

// ErrKeyReused marks the same idempotency key used with a different body.
var ErrKeyReused = errors.New("idempotency key reused")

func claimIdempotencyKey(ctx context.Context, tx pgx.Tx, personID, key, bodyHash string) (StoredResponse, bool, error) {
	var claimed int
	err := tx.QueryRow(ctx,
		`INSERT INTO idempotency_keys (person_id, key, body_hash, status, response)
		 VALUES ($1,$2,$3,0,'null'::jsonb)
		 ON CONFLICT (person_id, key) DO NOTHING RETURNING 1`,
		personID, key, bodyHash).Scan(&claimed)
	if err == nil {
		return StoredResponse{}, true, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return StoredResponse{}, false, fmt.Errorf("claim idempotency key: %w", err)
	}
	var storedHash string
	var stored StoredResponse
	err = tx.QueryRow(ctx,
		`SELECT body_hash, status, response FROM idempotency_keys
		  WHERE person_id = $1 AND key = $2`, personID, key).Scan(&storedHash, &stored.Status, &stored.Body)
	if err != nil {
		return StoredResponse{}, false, fmt.Errorf("read stored bid response: %w", err)
	}
	if storedHash != bodyHash {
		return StoredResponse{}, false, ErrKeyReused
	}
	return stored, false, nil
}

func (s *Saleroom) decideBid(ctx context.Context, tx pgx.Tx, v Viewer, req BidRequest,
	serverNow time.Time) (int, map[string]any, error) {
	if v.RegStatus != "active" {
		return 0, nil, conflict("registration_pending", "Your spending limit is waiting for approval.")
	}
	if _, err := tx.Exec(ctx, `SELECT id FROM lots WHERE id = $1 FOR UPDATE`, req.LotID); err != nil {
		return 0, nil, fmt.Errorf("take the lot's turn: %w", err)
	}
	l, err := visibleLot(ctx, tx, req.LotID, v)
	if err != nil {
		return 0, nil, err
	}
	bids, err := loadBids(ctx, tx, l.ID)
	if err != nil {
		return 0, nil, err
	}
	st := standing(l, bids)
	watching, err := isWatching(ctx, tx, l.ID, v.PersonID)
	if err != nil {
		return 0, nil, err
	}

	if !domain.IsLive(l.State) {
		return 0, nil, &Conflict{
			Code:    "lot_closed",
			Message: fmt.Sprintf("Bidding on lot %d has closed.", intOr(l.LotNumber, 0)),
			Lot:     bidderLot(l, st, bids, serverNow, v.PersonID, watching),
		}
	}

	if req.MaxAmount == nil || *req.MaxAmount < 1 {
		return 0, nil, invalidField("max_amount", domain.MsgNotWholeEuros)
	}
	amount := *req.MaxAmount
	if amount > domain.MaxBidEuros {
		return 0, nil, invalidField("max_amount", domain.MsgAboveCeiling)
	}
	if req.Type == "single" && amount != st.Asking {
		return 0, nil, &Conflict{
			Code: "asking_changed",
			Message: fmt.Sprintf("The next bid is now %s. Check it and confirm again.",
				domain.Euros(st.Asking)),
			Lot: bidderLot(l, st, bids, serverNow, v.PersonID, watching),
		}
	}
	iLead := st.HasLeader && st.LeaderID == v.PersonID
	switch {
	case iLead && amount <= st.LeaderMax:
		return 0, nil, invalidField("max_amount", domain.MsgRaiseOwnMaximum(st.LeaderMax))
	case !iLead && amount < st.Asking:
		return 0, nil, invalidField("max_amount", domain.MsgAtLeast(st.Asking))
	}
	limit := intOr(v.SpendLimit, 0)
	committed, err := committedEuros(ctx, tx, v.PersonID, l.ID)
	if err != nil {
		return 0, nil, err
	}
	if committed+amount > limit {
		return 0, nil, invalidField("max_amount", domain.MsgPastSpendingLimit(limit))
	}

	bidID := newID()
	_, err = tx.Exec(ctx,
		`INSERT INTO bids (id, lot_id, bidder_id, max_amount, accepted_at)
		 VALUES ($1,$2,$3,$4,$5)`, bidID, l.ID, v.PersonID, amount, serverNow)
	if err != nil {
		return 0, nil, fmt.Errorf("insert bid on lot %s: %w", l.ID, err)
	}

	previousLeader := ""
	if st.HasLeader {
		previousLeader = st.LeaderID
	}
	bids, err = loadBids(ctx, tx, l.ID)
	if err != nil {
		return 0, nil, err
	}
	st = standing(l, bids)
	lotNumber := intOr(l.LotNumber, 0)
	if previousLeader != "" && previousLeader != st.LeaderID {
		body := domain.NoticeOutbidText(lotNumber)
		if err := addNotice(ctx, tx, previousLeader, domain.NoticeOutbid, body, l.ID, serverNow); err != nil {
			return 0, nil, err
		}
	}

	cause := CauseBid
	if l.ClosesAt != nil && l.ClosesAt.Sub(serverNow) < s.cfg.SoftClose {
		newClose := serverNow.Add(s.cfg.SoftClose)
		_, err := tx.Exec(ctx, `UPDATE lots SET closes_at = $2, state = $3 WHERE id = $1`,
			l.ID, newClose, domain.LotExtended)
		if err != nil {
			return 0, nil, fmt.Errorf("extend lot %s: %w", l.ID, err)
		}
		l.ClosesAt = &newClose
		l.State = domain.LotExtended
		cause = CauseExtension
	}
	if err := recordLotChange(ctx, tx, cause, l.ID); err != nil {
		return 0, nil, err
	}

	return 201, map[string]any{
		"bid": map[string]any{
			"id":          bidID,
			"max_amount":  amount,
			"accepted_at": serverNow.UTC().Format(time.RFC3339),
		},
		"lot": bidderLot(l, st, bids, serverNow, v.PersonID, watching),
	}, nil
}

// committedEuros is the sum of the bidder's maximums on every open or
// extended lot where they currently lead, leaving out one lot.
func committedEuros(ctx context.Context, tx pgx.Tx, personID, excludeLotID string) (int, error) {
	lots, err := loadLots(ctx, tx,
		`WHERE l.state IN ('open','extended') AND l.id <> $2
		   AND EXISTS(SELECT 1 FROM bids b
		        WHERE b.lot_id = l.id AND b.bidder_id = $1 AND b.removed_at IS NULL)`,
		personID, excludeLotID)
	if err != nil {
		return 0, err
	}
	total := 0
	for _, l := range lots {
		bids, err := loadBids(ctx, tx, l.ID)
		if err != nil {
			return 0, err
		}
		st := standing(l, bids)
		if st.HasLeader && st.LeaderID == personID {
			total += st.LeaderMax
		}
	}
	return total, nil
}

// SetWatch turns a bidder's watch on a lot on or off. It is safe to repeat.
func (s *Saleroom) SetWatch(ctx context.Context, v Viewer, lotID string, watching bool) (bool, error) {
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		serverNow, err := now(ctx, tx)
		if err != nil {
			return err
		}
		if err := s.settle(ctx, tx, serverNow); err != nil {
			return err
		}
		l, err := visibleLot(ctx, tx, lotID, v)
		if err != nil {
			return err
		}
		var tag int64
		if watching {
			// A watch taken out after the closing-soon notice is due sends none.
			alreadyDue := l.ClosesAt != nil &&
				!l.ClosesAt.Add(-s.cfg.WatchNotice).After(serverNow)
			res, err := tx.Exec(ctx,
				`INSERT INTO watches (lot_id, person_id, closing_notice_sent)
				 VALUES ($1,$2,$3) ON CONFLICT (lot_id, person_id) DO NOTHING`,
				lotID, v.PersonID, alreadyDue || !domain.IsLive(l.State))
			if err != nil {
				return fmt.Errorf("watch lot %s: %w", lotID, err)
			}
			tag = res.RowsAffected()
		} else {
			res, err := tx.Exec(ctx,
				`DELETE FROM watches WHERE lot_id = $1 AND person_id = $2`, lotID, v.PersonID)
			if err != nil {
				return fmt.Errorf("stop watching lot %s: %w", lotID, err)
			}
			tag = res.RowsAffected()
		}
		if tag == 0 {
			return nil
		}
		return recordWatchChange(ctx, tx, lotID, v.PersonID)
	})
	return watching, err
}

// RemoveBid takes one bid out of a lot's history and works the price and
// leader out again from the remaining bids, keeping any extension that bid
// caused.
func (s *Saleroom) RemoveBid(ctx context.Context, bidID, reason string) (map[string]any, []map[string]any, error) {
	var lot map[string]any
	var history []map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		serverNow, err := now(ctx, tx)
		if err != nil {
			return err
		}
		if err := s.settle(ctx, tx, serverNow); err != nil {
			return err
		}
		var lotID, bidderID string
		var removedAt *time.Time
		err = tx.QueryRow(ctx,
			`SELECT lot_id, bidder_id, removed_at FROM bids WHERE id = $1 FOR UPDATE`, bidID).
			Scan(&lotID, &bidderID, &removedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("read bid %s: %w", bidID, err)
		}
		if removedAt != nil {
			return conflict("already_removed", "That bid has already been removed.")
		}
		l, err := loadLot(ctx, tx, lotID)
		if err != nil {
			return err
		}
		if !domain.IsLive(l.State) {
			return conflict("lot_closed",
				fmt.Sprintf("Bidding on lot %d has closed.", intOr(l.LotNumber, 0)))
		}
		_, err = tx.Exec(ctx,
			`UPDATE bids SET removed_at = $2, removed_reason = $3 WHERE id = $1`,
			bidID, serverNow, reason)
		if err != nil {
			return fmt.Errorf("remove bid %s: %w", bidID, err)
		}
		body := domain.NoticeBidRemovedText(intOr(l.LotNumber, 0))
		if err := addNotice(ctx, tx, bidderID, domain.NoticeBidRemoved, body, lotID, serverNow); err != nil {
			return err
		}
		if err := recordLotChange(ctx, tx, CauseRemoval, lotID); err != nil {
			return err
		}
		bids, err := loadBids(ctx, tx, lotID)
		if err != nil {
			return err
		}
		st := standing(l, bids)
		lot = staffLot(l, st, serverNow, nil)
		history = adminHistory(bids)
		return nil
	})
	return lot, history, err
}

// visibleLot reads a lot the viewer is allowed to know about. A draft sale,
// and the lots placed in it, are unknown to everyone except the specialist.
func visibleLot(ctx context.Context, tx pgx.Tx, lotID string, v Viewer) (lotRow, error) {
	l, err := loadLot(ctx, tx, lotID)
	if err != nil {
		return lotRow{}, err
	}
	if v.HasRole["specialist"] || l.ConsignorID == v.PersonID {
		return l, nil
	}
	switch l.State {
	case domain.LotIntake, domain.LotEstimated, domain.LotPlaced:
		return lotRow{}, ErrNotFound
	}
	return l, nil
}
