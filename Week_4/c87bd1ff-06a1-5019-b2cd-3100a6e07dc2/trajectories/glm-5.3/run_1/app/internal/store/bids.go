package store

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
)

// BidBody is the JSON body of a bid request.
type BidBody struct {
	Type      json.RawMessage `json:"type"`
	MaxAmount json.RawMessage `json:"max_amount"`
}

// ParsedBid is the decoded body with whole-euro checking done.
type ParsedBid struct {
	Type      string
	MaxAmount int
}

// ParseBid decodes a bid body, treating any non-integer max_amount as invalid.
func ParseBid(raw []byte) (ParsedBid, error) {
	var body struct {
		Type      json.RawMessage `json:"type"`
		MaxAmount json.RawMessage `json:"max_amount"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return ParsedBid{}, Invalid(map[string]string{"max_amount": "Enter a whole number of euros."})
	}
	if string(body.Type) == "" {
		body.Type = json.RawMessage(`"single"`)
	}
	var typ string
	if err := json.Unmarshal(body.Type, &typ); err != nil || (typ != "single" && typ != "maximum") {
		return ParsedBid{}, Invalid(map[string]string{"max_amount": "Enter a whole number of euros."})
	}
	if len(body.MaxAmount) == 0 {
		return ParsedBid{}, Invalid(map[string]string{"max_amount": "Enter a whole number of euros."})
	}
	var amt int
	if err := json.Unmarshal(body.MaxAmount, &amt); err != nil {
		return ParsedBid{}, Invalid(map[string]string{"max_amount": "Enter a whole number of euros."})
	}
	return ParsedBid{Type: typ, MaxAmount: amt}, nil
}

func HashBody(lotID string, b ParsedBid) string {
	raw, _ := json.Marshal(map[string]any{"lot_id": lotID, "type": b.Type, "max_amount": b.MaxAmount})
	return fmt.Sprintf("%x", fnv64(raw))
}

func fnv64(b []byte) uint64 {
	var h uint64 = 14695981039346656037
	for _, c := range b {
		h ^= uint64(c)
		h *= 1099511628211
	}
	return h
}

// PlaceBid decides one bid inside one transaction, so of two bids that would
// together pass the spending limit exactly one is accepted.
func (s *Store) PlaceBid(ctx context.Context, viewer Person, lotID, idemKey string, body ParsedBid) (int, map[string]any, error) {
	var stored map[string]any
	var status int
	err := s.db.WithTx(ctx, func(ctx context.Context, tx Tx) error {
		if rec, err := tx.GetIdempotency(ctx, viewer.ID, idemKey); err != nil {
			return fmt.Errorf("checking the idempotency key: %w", err)
		} else if rec != nil {
			if rec.BodyHash != HashBody(lotID, body) {
				return Conflict("idempotency_key_reused", "That key was used for a different bid.")
			}
			status = rec.Status
			return json.Unmarshal(rec.Response, &stored)
		}
		resp, st, err := s.decideBid(ctx, tx, viewer, lotID, body)
		if err != nil {
			return err
		}
		raw, err := json.Marshal(resp)
		if err != nil {
			return fmt.Errorf("storing the bid response: %w", err)
		}
		stored, status = resp, st
		if err := tx.InsertIdempotency(ctx, viewer.ID, idemKey, HashBody(lotID, body), st, raw); err != nil {
			return fmt.Errorf("storing the idempotency key: %w", err)
		}
		return nil
	})
	if err != nil {
		return 0, nil, err
	}
	return status, stored, nil
}

func (s *Store) decideBid(ctx context.Context, tx Tx, viewer Person, lotID string, body ParsedBid) (map[string]any, int, error) {
	now, err := tx.Now(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("reading the clock: %w", err)
	}
	lot, err := s.loadLotFull(ctx, tx, lotID)
	if err != nil {
		return nil, 0, err
	}
	if lot == nil || !lotAccess(viewer, &lot.Lot) {
		return nil, 0, NotFound()
	}
	if lot.ClosesAt != nil && !now.Before(*lot.ClosesAt) {
		if err := s.closeLot(ctx, tx, lot, now); err != nil {
			return nil, 0, err
		}
		fresh, err := s.loadLotFull(ctx, tx, lotID)
		if err != nil || fresh == nil {
			return nil, 0, fmt.Errorf("re-reading the lot: %w", err)
		}
		cErr := &CodedError{Status: 409, Code: "lot_closed", Message: lotClosedSentence(fresh)}
		view, err := s.viewerLotView(ctx, tx, viewer, fresh, nil, now)
		if err != nil {
			return nil, 0, err
		}
		cErr.Extra = map[string]any{"lot": view}
		return nil, 0, cErr
	}
	reg, err := tx.GetRegistrationByPerson(ctx, viewer.ID)
	if err != nil {
		return nil, 0, fmt.Errorf("reading the registration: %w", err)
	}
	if reg == nil || reg.Role != "bidder" || reg.Status != "active" {
		return nil, 0, Conflict("registration_pending", "Your spending limit is waiting for approval.")
	}

	amount := body.MaxAmount
	asking := lot.Asking()
	var fields map[string]string
	switch {
	case amount < 1:
		fields = map[string]string{"max_amount": "Enter a whole number of euros."}
	case amount > 1000000:
		fields = map[string]string{"max_amount": "Enter no more than €1,000,000."}
	}
	if fields == nil {
		leading := lot.LeaderPersonID != nil && *lot.LeaderPersonID == viewer.ID
		if leading && amount <= *lot.LeaderMax {
			fields = map[string]string{"max_amount": "Enter more than your maximum of " + fmtEuros(*lot.LeaderMax) + "."}
		} else if !leading && amount < asking {
			fields = map[string]string{"max_amount": "Enter at least " + fmtEuros(asking) + "."}
		}
	}
	if fields == nil {
		committed, err := tx.Committed(ctx, viewer.ID)
		if err != nil {
			return nil, 0, fmt.Errorf("working out the committed amount: %w", err)
		}
		if lot.LeaderPersonID != nil && *lot.LeaderPersonID == viewer.ID {
			committed -= *lot.LeaderMax
		}
		limit := 0
		if reg.SpendingLimit != nil {
			limit = *reg.SpendingLimit
		}
		if committed+amount > limit {
			fields = map[string]string{"max_amount": "This bid would take you past your spending limit of " + fmtEuros(limit) + "."}
		}
	}
	if fields != nil {
		return nil, 0, Invalid(fields)
	}
	if body.Type == "single" && amount != asking {
		fresh, err := s.loadLotFull(ctx, tx, lotID)
		if err != nil || fresh == nil {
			return nil, 0, fmt.Errorf("re-reading the lot: %w", err)
		}
		view, err := s.viewerLotView(ctx, tx, viewer, fresh, nil, now)
		if err != nil {
			return nil, 0, err
		}
		return nil, 0, &CodedError{Status: 409, Code: "asking_changed", Message: "The next bid is now " + fmtEuros(fresh.Asking()) + ". Check it and confirm again.", Extra: map[string]any{"lot": view}}
	}

	// Decide the bid.
	bid := Bid{ID: ID(), LotID: lotID, BidderID: viewer.ID, MaxAmount: amount, AcceptedAt: now}
	newPrice, newLeaderBid, reserveMet := applyBids(lot, &bid)
	bid.PriceAfter = newPrice

	seq, err := tx.AppendEvent(ctx, "bid", &lotID, nil)
	if err != nil {
		return nil, 0, fmt.Errorf("recording the bid event: %w", err)
	}
	if err := tx.InsertBid(ctx, bid, seq); err != nil {
		return nil, 0, fmt.Errorf("saving the bid: %w", err)
	}
	leaderBidID := ""
	if newLeaderBid != nil {
		leaderBidID = newLeaderBid.ID
	}
	if err := tx.ApplyBidResult(ctx, lotID, newPrice, leaderBidID, reserveMet, bid.ID); err != nil {
		return nil, 0, fmt.Errorf("updating the lot: %w", err)
	}

	// Outbid notice to the bidder who just lost the lead.
	oldLeader := lot.LeaderPersonID
	if oldLeader != nil && *oldLeader != viewer.ID && (newLeaderBid == nil || newLeaderBid.BidderID != *oldLeader) {
		if _, err := tx.InsertNotice(ctx, Notice{ID: ID(), PersonID: *oldLeader, Kind: "outbid", Text: "You have been outbid on lot " + fmt.Sprint(*lot.LotNumber) + ".", LotID: &lotID}); err != nil {
			return nil, 0, fmt.Errorf("sending the outbid notice: %w", err)
		}
	}

	// Soft close: only this lot moves.
	extended := false
	if lot.ClosesAt != nil && now.Sub(*lot.ClosesAt) < s.cfg.SoftClose {
		newClose := now.Add(s.cfg.SoftClose)
		if err := tx.SetLotClose(ctx, lotID, newClose); err != nil {
			return nil, 0, fmt.Errorf("extending the lot: %w", err)
		}
		if err := tx.SetLotState(ctx, lotID, "extended"); err != nil {
			return nil, 0, fmt.Errorf("extending the lot: %w", err)
		}
		extended = true
		if err := s.scheduleClosingNotices(ctx, tx, lot, newClose); err != nil {
			return nil, 0, err
		}
	}
	_ = extended

	fresh, err := s.loadLotFull(ctx, tx, lotID)
	if err != nil || fresh == nil {
		return nil, 0, fmt.Errorf("re-reading the lot: %w", err)
	}
	view, err := s.viewerLotView(ctx, tx, viewer, fresh, nil, now)
	if err != nil {
		return nil, 0, err
	}
	return map[string]any{
		"bid": map[string]any{"id": bid.ID, "max_amount": amount, "accepted_at": rfc(now)},
		"lot": view,
	}, 201, nil
}

func lotClosedSentence(lot *LotFull) string {
	return "Bidding on lot " + fmt.Sprint(*lot.LotNumber) + " has closed."
}

// applyBids walks the remaining bids plus one new bid in acceptance order, and
// applies the reserve rule after every step. It is the one place the price and
// leader are decided for bids and removals alike.
func applyBids(lot *LotFull, newBid *Bid) (price int, leader *Bid, reserveMet bool) {
	bids := make([]Bid, 0, len(lot.Bids)+1)
	bids = append(bids, lot.Bids...)
	if newBid != nil {
		bids = append(bids, *newBid)
	}
	sort.SliceStable(bids, func(i, j int) bool { return bids[i].AcceptedAt.Before(bids[j].AcceptedAt) })
	opening := *lot.OpeningBid
	reserve := 0
	if lot.Reserve != nil {
		reserve = *lot.Reserve
	}
	var p int
	var lead *Bid
	for i := range bids {
		b := bids[i]
		switch {
		case lead == nil:
			p = opening
			lead = &bids[i]
		case b.BidderID == lead.BidderID:
			// A leader's raise replaces their maximum and leaves the price.
			lead = &bids[i]
		case b.MaxAmount > lead.MaxAmount:
			cand := minInt(b.MaxAmount, lead.MaxAmount+IncrementFor(lead.MaxAmount))
			p = cand
			lead = &bids[i]
		default:
			cand := maxInt(p, minInt(lead.MaxAmount, b.MaxAmount+IncrementFor(b.MaxAmount)))
			p = cand
		}
		if lead != nil && reserve > 0 && lead.MaxAmount >= reserve && p < reserve {
			p = reserve
		}
	}
	reserveMet = lead != nil && reserve > 0 && lead.MaxAmount >= reserve
	return p, lead, reserveMet
}

// recompute decides the price, leader and reserve-met from the remaining bids.
func recompute(lot *LotFull) (price int, leader *Bid, reserveMet bool) {
	if len(lot.Bids) == 0 {
		return 0, nil, false
	}
	return applyBids(lot, nil)
}
