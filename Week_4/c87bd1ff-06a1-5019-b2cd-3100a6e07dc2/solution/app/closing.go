package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// settleDue closes every lot whose close moment has passed.
func (a *App) settleDue(ctx context.Context) error {
	rows, err := a.db.QueryContext(ctx, `SELECT id FROM lots WHERE state = ANY($1) AND closes_at <= clock_timestamp()`, pqStrings(lotsRunning))
	if err != nil {
		return fmt.Errorf("find due lots: %w", err)
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return fmt.Errorf("scan due lot: %w", err)
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read due lots: %w", err)
	}
	for _, id := range ids {
		if err := a.closeLot(ctx, id); err != nil {
			return err
		}
	}
	return nil
}

// closeLot carries out a lot's close, with all its effects, once. It does nothing if the lot is not due.
func (a *App) closeLot(ctx context.Context, lotID string) error {
	var saleID sql.NullString
	err := a.db.QueryRowContext(ctx, `SELECT sale_id FROM lots WHERE id = $1`, lotID).Scan(&saleID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("find lot sale: %w", err)
	}
	return a.tx(ctx, func(t *Tx) error {
		if _, err := t.ExecContext(ctx, `SELECT 1 FROM sales WHERE id = $1 FOR UPDATE`, saleID.String); err != nil {
			return fmt.Errorf("lock sale: %w", err)
		}
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
		if !lot.isRunning() || now.Before(lot.ClosesAt.Time) {
			return nil
		}
		s, _, err := lotStanding(ctx, t, lotID, int(lot.Opening.Int64), int(lot.Reserve.Int64))
		if err != nil {
			return err
		}
		sold := s.sold()
		state, result, ok := closeOutcome(lot.State, sold)
		if !ok {
			return errTransition
		}
		var hammer, winner any
		if sold {
			hammer, winner = s.Price, s.LeaderID
		}
		_, err = t.ExecContext(ctx, `UPDATE lots SET state = $2, result = $3, hammer = $4, winner_id = $5 WHERE id = $1`, lotID, state, result, hammer, winner)
		if err != nil {
			return fmt.Errorf("close lot: %w", err)
		}
		if err := a.closeNotices(ctx, t, lot, s); err != nil {
			return err
		}
		t.lotChanged(lotID, "close")
		var running int
		if err := t.QueryRowContext(ctx, `SELECT count(*) FROM lots WHERE sale_id = $1 AND state = ANY($2)`, saleID.String, pqStrings(lotsRunning)).Scan(&running); err != nil {
			return fmt.Errorf("count running lots: %w", err)
		}
		if running > 0 {
			return nil
		}
		return a.finishSale(ctx, t, saleID.String, now)
	})
}

func (a *App) closeNotices(ctx context.Context, t *Tx, lot *lotRow, s standing) error {
	n, sold := lot.LotNumber.Int64, s.sold()
	rows, err := t.QueryContext(ctx, `
		SELECT person_id FROM bids WHERE lot_id = $1 AND removed_at IS NULL
		UNION SELECT person_id FROM watches WHERE lot_id = $1`, lot.ID)
	if err != nil {
		return fmt.Errorf("find lot audience: %w", err)
	}
	var audience []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return fmt.Errorf("scan audience: %w", err)
		}
		audience = append(audience, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read lot audience: %w", err)
	}
	closed := fmt.Sprintf("Lot %d closed unsold.", n)
	result := fmt.Sprintf("Your lot %d closed unsold.", n)
	if sold {
		closed = fmt.Sprintf("Lot %d sold for %s.", n, euros(s.Price))
		result = fmt.Sprintf("Your lot %d sold for %s.", n, euros(s.Price))
	} else if len(s.PriceAfter) > 0 {
		result = fmt.Sprintf("Your lot %d closed unsold. You can offer it to the top bidder.", n)
	}
	if sold {
		won := fmt.Sprintf("You won lot %d at %s.", n, euros(s.Price))
		if err := notify(ctx, t, s.LeaderID, "won", won, lot.ID); err != nil {
			return err
		}
	}
	for _, id := range audience {
		if sold && id == s.LeaderID {
			continue
		}
		if err := notify(ctx, t, id, "lot_closed", closed, lot.ID); err != nil {
			return err
		}
	}
	return notify(ctx, t, lot.ConsignorID, "lot_result", result, lot.ID)
}

type invoiceLot struct {
	lotID  string
	hammer int
	source string
}

// issueInvoice writes one invoice with its lines and tells the buyer. It returns the invoice number and id.
func (a *App) issueInvoice(ctx context.Context, t *Tx, saleID, personID string, issued, due time.Time, lots []invoiceLot) (string, string, error) {
	n, err := nextCounter(ctx, t, "invoice")
	if err != nil {
		return "", "", err
	}
	id, number := newID("inv_"), fmt.Sprintf("INV-%05d", n)
	if _, err := t.ExecContext(ctx, `INSERT INTO invoices (id, number, sale_id, person_id, status, issued_at, due_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		id, number, saleID, personID, invoiceFlow.start, issued, due); err != nil {
		return "", "", fmt.Errorf("write invoice: %w", err)
	}
	var total int64
	for _, l := range lots {
		premium := premiumCents(l.hammer)
		vat := vatCents(premium)
		total += int64(l.hammer)*100 + premium + vat
		if _, err := t.ExecContext(ctx, `INSERT INTO invoice_lines (invoice_id, lot_id, source, hammer_cents, premium_cents, vat_cents) VALUES ($1, $2, $3, $4, $5, $6)`,
			id, l.lotID, l.source, int64(l.hammer)*100, premium, vat); err != nil {
			return "", "", fmt.Errorf("write invoice line: %w", err)
		}
	}
	text := fmt.Sprintf("Invoice %s for %s is ready. Payment is due by %s.", number, amountText(total), rotterdamTime(due))
	return number, id, notify(ctx, t, personID, "invoice_issued", text, "")
}

// finishSale closes the sale, invoices each winner once and drafts each consignor's statement.
func (a *App) finishSale(ctx context.Context, t *Tx, saleID string, now time.Time) error {
	var state string
	if err := t.QueryRowContext(ctx, `SELECT state FROM sales WHERE id = $1 FOR UPDATE`, saleID).Scan(&state); err != nil {
		return fmt.Errorf("lock sale: %w", err)
	}
	closed, ok := saleFlow.next(state, "close")
	if !ok {
		return errTransition
	}
	if _, err := t.ExecContext(ctx, `UPDATE sales SET state = $2 WHERE id = $1`, saleID, closed); err != nil {
		return fmt.Errorf("close sale: %w", err)
	}
	var lastClose time.Time
	if err := t.QueryRowContext(ctx, `SELECT max(closes_at) FROM lots WHERE sale_id = $1`, saleID).Scan(&lastClose); err != nil {
		return fmt.Errorf("find last close: %w", err)
	}
	rows, err := t.QueryContext(ctx, `SELECT id, state, winner_id, hammer FROM lots WHERE sale_id = $1 AND state = ANY($2) ORDER BY winner_id, lot_number`, saleID, pqStrings(lotsHammer))
	if err != nil {
		return fmt.Errorf("find hammer lots: %w", err)
	}
	type won struct {
		winner string
		lots   []invoiceLot
	}
	var buyers []*won
	invoiced := map[string]string{}
	for rows.Next() {
		var lotID, state, winner string
		var hammer int
		if err := rows.Scan(&lotID, &state, &winner, &hammer); err != nil {
			rows.Close()
			return fmt.Errorf("scan hammer lot: %w", err)
		}
		to, ok := lotFlow.next(state, "invoice")
		if !ok {
			rows.Close()
			return errTransition
		}
		invoiced[lotID] = to
		if len(buyers) == 0 || buyers[len(buyers)-1].winner != winner {
			buyers = append(buyers, &won{winner: winner})
		}
		last := buyers[len(buyers)-1]
		last.lots = append(last.lots, invoiceLot{lotID: lotID, hammer: hammer, source: "hammer"})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read hammer lots: %w", err)
	}
	for _, b := range buyers {
		if _, _, err := a.issueInvoice(ctx, t, saleID, b.winner, now, lastClose.Add(a.cfg.paymentDue), b.lots); err != nil {
			return err
		}
		for _, l := range b.lots {
			if _, err := t.ExecContext(ctx, `UPDATE lots SET state = $2 WHERE id = $1`, l.lotID, invoiced[l.lotID]); err != nil {
				return fmt.Errorf("invoice lot: %w", err)
			}
			t.lotChanged(l.lotID, "close")
		}
	}
	return a.draftStatements(ctx, t, saleID)
}
