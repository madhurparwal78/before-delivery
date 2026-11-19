package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// ownLot loads one of the signed-in consignor's own lots, or nil.
func (a *App) ownLot(ctx context.Context, q querier, v *Viewer, id string) (*lotRow, error) {
	l, err := loadLot(ctx, q, v.PersonID, id)
	if err != nil {
		return nil, fmt.Errorf("load own lot: %w", err)
	}
	if l == nil || l.ConsignorID != v.PersonID {
		return nil, nil
	}
	return l, nil
}

func (a *App) handleSecondChance(c *reqCtx) error {
	ctx := c.r.Context()
	id := c.r.PathValue("id")
	own, err := a.ownLot(ctx, a.db, c.viewer, id)
	if err != nil {
		return err
	}
	if own == nil {
		return c.fail(errNotFound)
	}
	body, ae := c.decode()
	if ae != nil {
		return c.fail(ae)
	}
	var out map[string]any
	err = a.tx(ctx, func(t *Tx) error {
		if _, err := t.ExecContext(ctx, `SELECT 1 FROM lots WHERE id = $1 FOR UPDATE`, id); err != nil {
			return fmt.Errorf("lock lot: %w", err)
		}
		lot, err := loadLot(ctx, t, c.viewer.PersonID, id)
		if err != nil || lot == nil {
			return fmt.Errorf("load lot: %w", err)
		}
		if !lot.secondChanceOpen() {
			return errTransition
		}
		s, _, err := lotStanding(ctx, t, id, int(lot.Opening.Int64), int(lot.Reserve.Int64))
		if err != nil {
			return err
		}
		amount, whole := wholeNumber(body["amount"])
		switch {
		case !whole:
			return invalid("amount", "Enter a whole number of euros.")
		case amount < s.Price:
			return invalid("amount", fmt.Sprintf("Offer at least %s, the lot's final price.", euros(s.Price)))
		case amount > s.LeaderMax:
			return invalid("amount", "That is above what the top bidder offered.")
		}
		now, err := dbNow(ctx, t)
		if err != nil {
			return err
		}
		offered, ok := lotFlow.next(lot.State, "offer")
		if !ok {
			return errTransition
		}
		offer := &offerRow{ID: newID("off_"), LotID: id, PersonID: s.LeaderID, Kind: "second_chance", Status: offerFlow.start,
			Title: lot.Title, LotNumber: int(lot.LotNumber.Int64), Amount: amount, ExpiresAt: now.Add(a.cfg.offerWindow), CreatedAt: now}
		if _, err := t.ExecContext(ctx, `INSERT INTO offers (id, lot_id, person_id, kind, amount, status, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			offer.ID, id, offer.PersonID, offer.Kind, amount, offer.Status, now, offer.ExpiresAt); err != nil {
			return fmt.Errorf("write offer: %w", err)
		}
		if _, err := t.ExecContext(ctx, `UPDATE lots SET state = $2 WHERE id = $1`, id, offered); err != nil {
			return fmt.Errorf("offer lot: %w", err)
		}
		text := fmt.Sprintf("Second chance: lot %d can be yours for %s until %s.", offer.LotNumber, euros(amount), rotterdamTime(offer.ExpiresAt))
		if err := notify(ctx, t, offer.PersonID, "second_chance", text, id); err != nil {
			return err
		}
		t.lotChanged(id, "offer")
		out = offer.json()
		return nil
	})
	if err != nil {
		return err
	}
	return c.json(201, map[string]any{"offer": out})
}

func (a *App) handleLeaveUnsold(c *reqCtx) error {
	ctx := c.r.Context()
	id := c.r.PathValue("id")
	own, err := a.ownLot(ctx, a.db, c.viewer, id)
	if err != nil {
		return err
	}
	if own == nil {
		return c.fail(errNotFound)
	}
	var out map[string]any
	err = a.tx(ctx, func(t *Tx) error {
		if _, err := t.ExecContext(ctx, `SELECT 1 FROM lots WHERE id = $1 FOR UPDATE`, id); err != nil {
			return fmt.Errorf("lock lot: %w", err)
		}
		lot, err := loadLot(ctx, t, c.viewer.PersonID, id)
		if err != nil || lot == nil {
			return fmt.Errorf("load lot: %w", err)
		}
		if !lot.secondChanceOpen() {
			return errTransition
		}
		if _, err := t.ExecContext(ctx, `UPDATE lots SET decided = true WHERE id = $1`, id); err != nil {
			return fmt.Errorf("record decision: %w", err)
		}
		t.lotChanged(id, "offer")
		lot.Decided = true
		now, err := dbNow(ctx, t)
		if err != nil {
			return err
		}
		out = lot.consignor(now, nil)
		return nil
	})
	if err != nil {
		return err
	}
	return c.json(200, map[string]any{"lot": out})
}

// expireOffer turns an open offer past its expiry into a lapsed lot and tells the consignor.
func (a *App) expireOffer(ctx context.Context, t *Tx, o *offerRow) error {
	if err := a.answer(ctx, t, o, "expire"); err != nil {
		return err
	}
	return a.lapseLot(ctx, t, o)
}

// answer moves an offer by one of its events.
func (a *App) answer(ctx context.Context, t *Tx, o *offerRow, event string) error {
	to, ok := offerFlow.next(o.Status, event)
	if !ok {
		return errTransition
	}
	if _, err := t.ExecContext(ctx, `UPDATE offers SET status = $2 WHERE id = $1`, o.ID, to); err != nil {
		return fmt.Errorf("%s offer: %w", event, err)
	}
	o.Status = to
	return nil
}

// moveLot moves a locked lot by one of its events and returns its new state.
func moveLot(ctx context.Context, t *Tx, lotID, event string) (string, error) {
	var state string
	if err := t.QueryRowContext(ctx, `SELECT state FROM lots WHERE id = $1 FOR UPDATE`, lotID).Scan(&state); err != nil {
		return "", fmt.Errorf("lock lot: %w", err)
	}
	to, ok := lotFlow.next(state, event)
	if !ok {
		return "", errTransition
	}
	if _, err := t.ExecContext(ctx, `UPDATE lots SET state = $2 WHERE id = $1`, lotID, to); err != nil {
		return "", fmt.Errorf("%s lot: %w", event, err)
	}
	return to, nil
}

func (a *App) lapseLot(ctx context.Context, t *Tx, o *offerRow) error {
	if _, err := moveLot(ctx, t, o.LotID, "lapse"); err != nil {
		return err
	}
	var consignor string
	if err := t.QueryRowContext(ctx, `SELECT consignor_id FROM lots WHERE id = $1`, o.LotID).Scan(&consignor); err != nil {
		return fmt.Errorf("lapse lot: %w", err)
	}
	text := fmt.Sprintf("The offer on your lot %d has lapsed.", o.LotNumber)
	if err := notify(ctx, t, consignor, "offer_lapsed", text, o.LotID); err != nil {
		return err
	}
	t.lotChanged(o.LotID, "offer")
	return nil
}

// answerOffer locks the viewer's offer and its lot and checks it is still open at the server's time.
func (a *App) answerOffer(ctx context.Context, t *Tx, v *Viewer, id string) (*offerRow, time.Time, error) {
	if _, err := t.ExecContext(ctx, `SELECT 1 FROM offers WHERE id = $1 AND person_id = $2 FOR UPDATE`, id, v.PersonID); err != nil {
		return nil, time.Time{}, fmt.Errorf("lock offer: %w", err)
	}
	list, err := loadOffers(ctx, t, "WHERE o.id = $1 AND o.person_id = $2", id, v.PersonID)
	if err != nil {
		return nil, time.Time{}, err
	}
	if len(list) == 0 {
		return nil, time.Time{}, errNotFound
	}
	o := list[0]
	if _, err := t.ExecContext(ctx, `SELECT 1 FROM lots WHERE id = $1 FOR UPDATE`, o.LotID); err != nil {
		return nil, time.Time{}, fmt.Errorf("lock offered lot: %w", err)
	}
	now, err := dbNow(ctx, t)
	if err != nil {
		return nil, now, err
	}
	expire, refusal := offerAnswer(o.Status, o.ExpiresAt, now)
	if expire {
		if err := a.expireOffer(ctx, t, o); err != nil {
			return nil, now, err
		}
		return nil, now, &afterCommit{err: refusal}
	}
	if refusal != nil {
		return nil, now, refusal
	}
	return o, now, nil
}

func (a *App) handleAcceptOffer(c *reqCtx) error {
	ctx := c.r.Context()
	var offer, invoice map[string]any
	err := a.tx(ctx, func(t *Tx) error {
		o, now, err := a.answerOffer(ctx, t, c.viewer, c.r.PathValue("id"))
		if err != nil {
			return err
		}
		if _, err := moveLot(ctx, t, o.LotID, "accept"); err != nil {
			return err
		}
		var saleID, consignor string
		if err := t.QueryRowContext(ctx, `
			UPDATE lots SET hammer = $2, winner_id = $3 WHERE id = $1 RETURNING sale_id, consignor_id`,
			o.LotID, o.Amount, o.PersonID).Scan(&saleID, &consignor); err != nil {
			return fmt.Errorf("sell lot by offer: %w", err)
		}
		if err := a.answer(ctx, t, o, "accept"); err != nil {
			return err
		}
		source := "second_chance"
		if o.Kind == "default" {
			source = "default_offer"
		}
		_, invoiceID, err := a.issueInvoice(ctx, t, saleID, o.PersonID, now, now.Add(a.cfg.paymentDue), []invoiceLot{{lotID: o.LotID, hammer: o.Amount, source: source}})
		if err != nil {
			return err
		}
		text := fmt.Sprintf("Your lot %d sold by offer for %s.", o.LotNumber, euros(o.Amount))
		if err := notify(ctx, t, consignor, "offer_accepted", text, o.LotID); err != nil {
			return err
		}
		t.lotChanged(o.LotID, "offer")
		offer = o.json()
		list, err := loadInvoices(ctx, t, "WHERE i.id = $1", invoiceID)
		if err != nil || len(list) == 0 {
			return fmt.Errorf("reload invoice: %w", err)
		}
		invoice = list[0].json(false)
		return nil
	})
	if err != nil {
		return err
	}
	return c.json(200, map[string]any{"offer": offer, "invoice": invoice})
}

func (a *App) handleDeclineOffer(c *reqCtx) error {
	ctx := c.r.Context()
	var offer map[string]any
	err := a.tx(ctx, func(t *Tx) error {
		o, _, err := a.answerOffer(ctx, t, c.viewer, c.r.PathValue("id"))
		if err != nil {
			return err
		}
		if err := a.answer(ctx, t, o, "decline"); err != nil {
			return err
		}
		if err := a.lapseLot(ctx, t, o); err != nil {
			return err
		}
		offer = o.json()
		return nil
	})
	if err != nil {
		return err
	}
	return c.json(200, map[string]any{"offer": offer})
}

// underbidder is the leader resolve finds once the winner's bids are set aside: the other bidder with the highest
// maximum, the earlier bid on a tie. The default offer is made at that maximum.
func underbidder(ctx context.Context, q querier, lotID, winner string) (string, int, error) {
	bids, err := remainingBids(ctx, q, lotID)
	if err != nil {
		return "", 0, fmt.Errorf("find underbidder: %w", err)
	}
	var others []bidRecord
	for _, b := range bids {
		if b.PersonID != winner {
			others = append(others, b)
		}
	}
	s := resolve(others, 0, 0)
	return s.LeaderID, s.LeaderMax, nil
}

// defaultInvoice carries out one invoice's default at its due time.
func (a *App) defaultInvoice(ctx context.Context, id string) error {
	return a.tx(ctx, func(t *Tx) error {
		var number, buyer, status string
		var due time.Time
		err := t.QueryRowContext(ctx, `SELECT number, person_id, status, due_at FROM invoices WHERE id = $1 FOR UPDATE`, id).Scan(&number, &buyer, &status, &due)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("lock invoice: %w", err)
		}
		now, err := dbNow(ctx, t)
		if err != nil {
			return err
		}
		if !invoiceDefaults(status, due, now) {
			return nil
		}
		defaulted, _ := invoiceFlow.next(status, "default")
		if _, err := t.ExecContext(ctx, `UPDATE invoices SET status = $2, defaulted_at = clock_timestamp() WHERE id = $1`, id, defaulted); err != nil {
			return fmt.Errorf("default invoice: %w", err)
		}
		rows, err := t.QueryContext(ctx, `SELECT lot_id, source FROM invoice_lines WHERE invoice_id = $1 ORDER BY lot_id`, id)
		if err != nil {
			return fmt.Errorf("load default lines: %w", err)
		}
		type line struct{ lot, source string }
		var lines []line
		for rows.Next() {
			var l line
			if err := rows.Scan(&l.lot, &l.source); err != nil {
				rows.Close()
				return fmt.Errorf("scan default line: %w", err)
			}
			lines = append(lines, l)
		}
		rows.Close()
		if err := readErr(rows, "default lines"); err != nil {
			return err
		}
		if err := notify(ctx, t, buyer, "invoice_defaulted", fmt.Sprintf("Invoice %s was not paid in time and has defaulted.", number), ""); err != nil {
			return err
		}
		for _, l := range lines {
			if _, err := moveLot(ctx, t, l.lot, "default"); err != nil {
				return err
			}
			if l.source == "hammer" {
				if err := a.offerToUnderbidder(ctx, t, l.lot, buyer, now); err != nil {
					return err
				}
			}
			t.lotChanged(l.lot, "offer")
		}
		return nil
	})
}

func (a *App) offerToUnderbidder(ctx context.Context, t *Tx, lotID, winner string, now time.Time) error {
	person, maximum, err := underbidder(ctx, t, lotID, winner)
	if err != nil || person == "" {
		return err
	}
	if _, err := moveLot(ctx, t, lotID, "reoffer"); err != nil {
		return err
	}
	var number int
	if err := t.QueryRowContext(ctx, `SELECT lot_number FROM lots WHERE id = $1`, lotID).Scan(&number); err != nil {
		return fmt.Errorf("offer lot to underbidder: %w", err)
	}
	expires := now.Add(a.cfg.offerWindow)
	if _, err := t.ExecContext(ctx, `INSERT INTO offers (id, lot_id, person_id, kind, amount, status, created_at, expires_at) VALUES ($1, $2, $3, 'default', $4, $5, $6, $7)`,
		newID("off_"), lotID, person, maximum, offerFlow.start, now, expires); err != nil {
		return fmt.Errorf("write default offer: %w", err)
	}
	text := fmt.Sprintf("Lot %d is offered to you for %s until %s.", number, euros(maximum), rotterdamTime(expires))
	return notify(ctx, t, person, "default_offer", text, lotID)
}
