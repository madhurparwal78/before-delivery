package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const ceiling = 1000000

var errLotDue = errors.New("lot is at or past its close and must be closed first")

// remainingBids loads a lot's bids that are not removed, in acceptance order.
func remainingBids(ctx context.Context, q querier, lotID string) ([]bidRecord, error) {
	rows, err := q.QueryContext(ctx, `SELECT id, person_id, max_amount FROM bids WHERE lot_id = $1 AND removed_at IS NULL ORDER BY n`, lotID)
	if err != nil {
		return nil, fmt.Errorf("load remaining bids: %w", err)
	}
	defer rows.Close()
	var bids []bidRecord
	for rows.Next() {
		var b bidRecord
		if err := rows.Scan(&b.ID, &b.PersonID, &b.Max); err != nil {
			return nil, fmt.Errorf("scan bid: %w", err)
		}
		bids = append(bids, b)
	}
	if err := readErr(rows, "remaining bids"); err != nil {
		return nil, err
	}
	return bids, nil
}

// lotStanding loads a lot's remaining bids and resolves its price and leader.
func lotStanding(ctx context.Context, q querier, lotID string, opening, reserve int) (standing, int, error) {
	bids, err := remainingBids(ctx, q, lotID)
	if err != nil {
		return standing{}, 0, err
	}
	return resolve(bids, opening, reserve), len(bids), nil
}

// applyStanding recomputes a lot's price and leader from its remaining bids. It is the only writer of those columns.
func applyStanding(ctx context.Context, t *Tx, lotID string, opening, reserve int) (standing, error) {
	s, count, err := lotStanding(ctx, t, lotID, opening, reserve)
	if err != nil {
		return s, err
	}
	var price, leaderMax any
	var leader any
	if s.LeaderID != "" {
		price, leader, leaderMax = s.Price, s.LeaderID, s.LeaderMax
	}
	_, err = t.ExecContext(ctx, `UPDATE lots SET price = $2, leader_id = $3, leader_max = $4, bid_count = $5 WHERE id = $1`,
		lotID, price, leader, leaderMax, count)
	if err != nil {
		return s, fmt.Errorf("store standing: %w", err)
	}
	return s, nil
}

type storedResponse struct {
	status int
	body   []byte
}

func printableKey(k string) bool {
	if len(k) < 1 || len(k) > 100 {
		return false
	}
	for _, r := range k {
		if r < 0x20 || r > 0x7e {
			return false
		}
	}
	return true
}

func (a *App) handleBid(c *reqCtx) error {
	ctx := c.r.Context()
	lotID := c.r.PathValue("id")
	var visible bool
	err := a.db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM lots WHERE id = $1 AND NOT (state = ANY($2)))`, lotID, pqStrings(lotsOnDesk)).Scan(&visible)
	if err != nil {
		return fmt.Errorf("find lot: %w", err)
	}
	if !visible {
		return c.fail(errNotFound)
	}
	key := c.r.Header.Get("Idempotency-Key")
	if !printableKey(key) {
		return c.fail(failure(400, "idempotency_key_required", "Send an Idempotency-Key header of 1 to 100 printable characters."))
	}
	body, ae := c.decode()
	if ae != nil {
		return c.fail(ae)
	}
	kind, _ := body["type"].(string)
	hash := sha256.Sum256([]byte(fmt.Sprintf("%s|%s|%T:%v", lotID, kind, body["max_amount"], body["max_amount"])))
	requestHash := hex.EncodeToString(hash[:])
	for attempt := 0; attempt < 3; attempt++ {
		var resp storedResponse
		err := a.tx(ctx, func(t *Tx) error {
			r, err := a.decideBid(ctx, t, c.viewer, lotID, key, requestHash, kind, body["max_amount"])
			resp = r
			return err
		})
		if errors.Is(err, errLotDue) {
			if err := a.closeLot(ctx, lotID); err != nil {
				return err
			}
			continue
		}
		if err != nil {
			return err
		}
		c.w.Header().Set("Content-Type", "application/json")
		c.w.Header().Set("Cache-Control", "no-store")
		c.w.WriteHeader(resp.status)
		if _, err := c.w.Write(resp.body); err != nil {
			return fmt.Errorf("write stored response: %w", err)
		}
		return nil
	}
	return errUnexpected
}

func (a *App) decideBid(ctx context.Context, t *Tx, v *Viewer, lotID, key, requestHash, kind string, rawMax any) (storedResponse, error) {
	var status string
	var limit sql.NullInt64
	if err := t.QueryRowContext(ctx, `SELECT status, spending_limit FROM registrations WHERE person_id = $1 FOR UPDATE`, v.PersonID).Scan(&status, &limit); err != nil {
		return storedResponse{}, fmt.Errorf("lock bidder: %w", err)
	}
	var prevHash string
	var prev storedResponse
	err := t.QueryRowContext(ctx, `SELECT request_hash, status, body FROM idempotency WHERE person_id = $1 AND key = $2`, v.PersonID, key).
		Scan(&prevHash, &prev.status, &prevBody{&prev})
	if err == nil {
		if prevHash != requestHash {
			return storedResponse{}, failure(409, "idempotency_key_reused", "That Idempotency-Key was used for a different bid.")
		}
		return prev, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return storedResponse{}, fmt.Errorf("look up idempotency key: %w", err)
	}
	respond := func(code int, payload any) (storedResponse, error) {
		raw, err := json.Marshal(payload)
		if err != nil {
			return storedResponse{}, fmt.Errorf("encode response: %w", err)
		}
		raw = append(raw, '\n')
		_, err = t.ExecContext(ctx, `INSERT INTO idempotency (person_id, key, request_hash, status, body) VALUES ($1, $2, $3, $4, $5)`,
			v.PersonID, key, requestHash, code, string(raw))
		if err != nil {
			return storedResponse{}, fmt.Errorf("store response: %w", err)
		}
		return storedResponse{status: code, body: raw}, nil
	}
	refuse := func(e *apiError) (storedResponse, error) { return respond(e.Status, e.body()) }

	if !registrationMayBid(status) {
		return refuse(failure(409, "registration_pending", "Your spending limit is waiting for approval."))
	}
	if _, err := t.ExecContext(ctx, `SELECT 1 FROM lots WHERE id = $1 FOR UPDATE`, lotID); err != nil {
		return storedResponse{}, fmt.Errorf("lock lot: %w", err)
	}
	lot, err := loadLot(ctx, t, v.PersonID, lotID)
	if err != nil || lot == nil {
		return storedResponse{}, fmt.Errorf("load lot: %w", err)
	}
	now, err := dbNow(ctx, t)
	if err != nil {
		return storedResponse{}, err
	}
	if lot.isRunning() && !now.Before(lot.ClosesAt.Time) {
		return storedResponse{}, errLotDue
	}
	if !lot.isRunning() {
		e := failure(409, "lot_closed", fmt.Sprintf("Bidding on lot %d has closed.", lot.LotNumber.Int64))
		e.Extra = map[string]any{"lot": lot.bidder(now, v.PersonID)}
		return refuse(e)
	}
	next := asking(int(lot.Price.Int64), int(lot.Opening.Int64))
	maximum, whole := wholeNumber(rawMax)
	if kind != "single" && kind != "maximum" {
		return refuse(invalid("type", "Choose bid now or maximum bid."))
	}
	if kind == "single" && !(whole && maximum == next) {
		e := failure(409, "asking_changed", fmt.Sprintf("The next bid is now %s. Check it and confirm again.", euros(next)))
		e.Extra = map[string]any{"lot": lot.bidder(now, v.PersonID)}
		return refuse(e)
	}
	leads := lot.LeaderID.Valid && lot.LeaderID.String == v.PersonID
	var problem string
	switch {
	case !whole || maximum < 1:
		problem = "Enter a whole number of euros."
	case maximum > ceiling:
		problem = "Enter no more than €1,000,000."
	case leads && maximum <= int(lot.LeaderMax.Int64):
		problem = fmt.Sprintf("Enter more than your maximum of %s.", euros(int(lot.LeaderMax.Int64)))
	case !leads && maximum < next:
		problem = fmt.Sprintf("Enter at least %s.", euros(next))
	default:
		var committed int
		err := t.QueryRowContext(ctx, `SELECT COALESCE(SUM(leader_max), 0) FROM lots WHERE leader_id = $1 AND state = ANY($3) AND id <> $2`,
			v.PersonID, lotID, pqStrings(lotsRunning)).Scan(&committed)
		if err != nil {
			return storedResponse{}, fmt.Errorf("sum committed maximums: %w", err)
		}
		if committed+maximum > int(limit.Int64) {
			problem = fmt.Sprintf("This bid would take you past your spending limit of %s.", euros(int(limit.Int64)))
		}
	}
	if problem != "" {
		return refuse(invalid("max_amount", problem))
	}

	bidID := newID("bid_")
	if _, err := t.ExecContext(ctx, `INSERT INTO bids (id, lot_id, person_id, max_amount, accepted_at) VALUES ($1, $2, $3, $4, $5)`,
		bidID, lotID, v.PersonID, maximum, now); err != nil {
		return storedResponse{}, fmt.Errorf("record bid: %w", err)
	}
	cause := "bid"
	if lot.ClosesAt.Time.Sub(now) < a.cfg.softClose {
		cause = "extension"
		extended, ok := lotFlow.next(lot.State, "extend")
		if !ok {
			return storedResponse{}, errTransition
		}
		_, err := t.ExecContext(ctx, `UPDATE lots SET closes_at = $2, state = $3 WHERE id = $1`, lotID, now.Add(a.cfg.softClose), extended)
		if err != nil {
			return storedResponse{}, fmt.Errorf("extend close: %w", err)
		}
	}
	after, err := applyStanding(ctx, t, lotID, int(lot.Opening.Int64), int(lot.Reserve.Int64))
	if err != nil {
		return storedResponse{}, err
	}
	if lot.LeaderID.Valid && lot.LeaderID.String != after.LeaderID {
		text := fmt.Sprintf("You have been outbid on lot %d.", lot.LotNumber.Int64)
		if err := notify(ctx, t, lot.LeaderID.String, "outbid", text, lotID); err != nil {
			return storedResponse{}, err
		}
	}
	t.lotChanged(lotID, cause)
	updated, err := loadLot(ctx, t, v.PersonID, lotID)
	if err != nil || updated == nil {
		return storedResponse{}, fmt.Errorf("reload lot: %w", err)
	}
	return respond(201, map[string]any{
		"bid": map[string]any{"id": bidID, "max_amount": maximum, "accepted_at": apiTime(now)},
		"lot": updated.bidder(now, v.PersonID),
	})
}

// prevBody scans a stored response body into a storedResponse.
type prevBody struct{ r *storedResponse }

func (p *prevBody) Scan(src any) error {
	switch s := src.(type) {
	case string:
		p.r.body = []byte(s)
	case []byte:
		p.r.body = append([]byte(nil), s...)
	default:
		return fmt.Errorf("unexpected body type %T", src)
	}
	return nil
}

func (a *App) handleAdminLots(c *reqCtx) error {
	var lots []map[string]any
	err := a.read(c.r.Context(), func(q *sql.Tx, now time.Time, seq int64) error {
		rows, err := loadLots(c.r.Context(), q, "", "WHERE l.state = ANY($2) ORDER BY l.closes_at, l.lot_number", pqStrings(lotsRunning))
		if err != nil {
			return err
		}
		lots = []map[string]any{}
		for _, l := range rows {
			lots = append(lots, l.staff(now, nil))
		}
		return nil
	})
	if err != nil {
		return err
	}
	return c.json(200, map[string]any{"lots": lots})
}

func (a *App) adminBids(ctx context.Context, q querier, lotID string, now time.Time) (map[string]any, error) {
	l, err := loadLot(ctx, q, "", lotID)
	if err != nil || l == nil || !l.published() {
		return nil, err
	}
	offers, err := latestOffers(ctx, q, []string{lotID})
	if err != nil {
		return nil, err
	}
	history, err := loadHistory(ctx, q, l)
	if err != nil {
		return nil, err
	}
	return map[string]any{"lot": l.staff(now, offers[lotID]), "bids": historyRows(history, "admin")}, nil
}

func (a *App) handleAdminLotBids(c *reqCtx) error {
	var out map[string]any
	err := a.read(c.r.Context(), func(q *sql.Tx, now time.Time, seq int64) error {
		var err error
		out, err = a.adminBids(c.r.Context(), q, c.r.PathValue("id"), now)
		return err
	})
	if err != nil {
		return err
	}
	if out == nil {
		return c.fail(errNotFound)
	}
	return c.json(200, out)
}

func (a *App) handleRemoveBid(c *reqCtx) error {
	ctx := c.r.Context()
	bidID := c.r.PathValue("id")
	var lotID string
	err := a.db.QueryRowContext(ctx, `SELECT lot_id FROM bids WHERE id = $1`, bidID).Scan(&lotID)
	if errors.Is(err, sql.ErrNoRows) {
		return c.fail(errNotFound)
	}
	if err != nil {
		return fmt.Errorf("find bid: %w", err)
	}
	body, ae := c.decode()
	if ae != nil {
		return c.fail(ae)
	}
	reason, _ := body["reason"].(string)
	for attempt := 0; attempt < 3; attempt++ {
		var out map[string]any
		err := a.tx(ctx, func(t *Tx) error {
			if _, err := t.ExecContext(ctx, `SELECT 1 FROM lots WHERE id = $1 FOR UPDATE`, lotID); err != nil {
				return fmt.Errorf("lock lot: %w", err)
			}
			lot, err := loadLot(ctx, t, "", lotID)
			if err != nil || lot == nil {
				return fmt.Errorf("load lot: %w", err)
			}
			now, err := dbNow(ctx, t)
			if err != nil {
				return err
			}
			if lot.isRunning() && !now.Before(lot.ClosesAt.Time) {
				return errLotDue
			}
			if !lot.isRunning() {
				return failure(409, "lot_closed", fmt.Sprintf("Bidding on lot %d has closed.", lot.LotNumber.Int64))
			}
			var removed bool
			var bidder string
			if err := t.QueryRowContext(ctx, `SELECT removed_at IS NOT NULL, person_id FROM bids WHERE id = $1`, bidID).Scan(&removed, &bidder); err != nil {
				return fmt.Errorf("load bid: %w", err)
			}
			if removed {
				return failure(409, "already_removed", "That bid has already been removed.")
			}
			if n := len([]rune(strings.TrimSpace(reason))); n < 1 || n > 300 {
				return invalid("reason", "Enter a reason of up to 300 characters.")
			}
			if _, err := t.ExecContext(ctx, `UPDATE bids SET removed_at = $2, removed_reason = $3 WHERE id = $1`, bidID, now, strings.TrimSpace(reason)); err != nil {
				return fmt.Errorf("remove bid: %w", err)
			}
			if _, err := applyStanding(ctx, t, lotID, int(lot.Opening.Int64), int(lot.Reserve.Int64)); err != nil {
				return err
			}
			text := fmt.Sprintf("Your bid on lot %d was removed by the saleroom.", lot.LotNumber.Int64)
			if err := notify(ctx, t, bidder, "bid_removed", text, lotID); err != nil {
				return err
			}
			t.lotChanged(lotID, "removal")
			out, err = a.adminBids(ctx, t, lotID, now)
			return err
		})
		if errors.Is(err, errLotDue) {
			if err := a.closeLot(ctx, lotID); err != nil {
				return err
			}
			continue
		}
		if err != nil {
			return err
		}
		return c.json(200, out)
	}
	return errUnexpected
}
