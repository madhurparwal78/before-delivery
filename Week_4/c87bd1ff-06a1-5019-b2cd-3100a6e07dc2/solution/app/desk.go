package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
)

var portraits = map[string]bool{"chronograph": true, "rangefinder": true, "diver": true, "twin_lens": true, "dress": true, "bellows": true}

const amountProblem = "Enter a whole number of euros from €1 to €1,000,000."

// ---- consignor ----

func (a *App) handleConsignCreate(c *reqCtx) error {
	body, ae := c.decode()
	if ae != nil {
		return c.fail(ae)
	}
	category, _ := body["category"].(string)
	title, _ := body["title"].(string)
	description, _ := body["description"].(string)
	title, description = strings.TrimSpace(title), strings.TrimSpace(description)
	fields := map[string]string{}
	if category != "wristwatch" && category != "camera" {
		fields["category"] = "Choose wristwatch or film camera."
	}
	if n := len([]rune(title)); n < 1 || n > 120 {
		fields["title"] = "Enter a title of up to 120 characters."
	}
	if n := len([]rune(description)); n < 1 || n > 2000 {
		fields["description"] = "Describe the item in up to 2,000 characters."
	}
	if len(fields) > 0 {
		return c.fail(invalidFields(fields))
	}
	id := newID("lot_")
	if _, err := a.db.ExecContext(c.r.Context(), `INSERT INTO lots (id, consignor_id, category, title, description, state) VALUES ($1, $2, $3, $4, $5, $6)`,
		id, c.viewer.PersonID, category, title, description, lotFlow.start); err != nil {
		return fmt.Errorf("record consignment: %w", err)
	}
	var lot map[string]any
	err := a.snapshot(c.r.Context(), func(q *sql.Tx) error {
		l, err := loadLot(c.r.Context(), q, c.viewer.PersonID, id)
		if err != nil || l == nil {
			return fmt.Errorf("reload lot: %w", err)
		}
		now, err := dbNow(c.r.Context(), q)
		lot = l.consignor(now, nil)
		return err
	})
	if err != nil {
		return err
	}
	return c.json(201, map[string]any{"lot": lot, "landing": "/consign"})
}

func (a *App) handleConsignLots(c *reqCtx) error {
	var lots []map[string]any
	var seq int64
	err := a.read(c.r.Context(), func(q *sql.Tx, now time.Time, s int64) error {
		seq = s
		rows, err := loadLots(c.r.Context(), q, c.viewer.PersonID, "WHERE l.consignor_id = $2 ORDER BY l.created_at DESC, l.id", c.viewer.PersonID)
		if err != nil {
			return err
		}
		ids := make([]string, len(rows))
		for i, l := range rows {
			ids[i] = l.ID
		}
		offers, err := latestOffers(c.r.Context(), q, ids)
		if err != nil {
			return err
		}
		lots = []map[string]any{}
		for _, l := range rows {
			lots = append(lots, l.consignor(now, offers[l.ID]))
		}
		return nil
	})
	if err != nil {
		return err
	}
	return c.json(200, map[string]any{"lots": lots, "seq": seq})
}

func (a *App) handleConsignLot(c *reqCtx) error {
	var lot map[string]any
	var history []map[string]any
	var seq int64
	err := a.read(c.r.Context(), func(q *sql.Tx, now time.Time, s int64) error {
		seq = s
		l, err := a.ownLot(c.r.Context(), q, c.viewer, c.r.PathValue("id"))
		if err != nil || l == nil {
			lot = nil
			return err
		}
		offers, err := latestOffers(c.r.Context(), q, []string{l.ID})
		if err != nil {
			return err
		}
		h, err := loadHistory(c.r.Context(), q, l)
		if err != nil {
			return err
		}
		lot, history = l.consignor(now, offers[l.ID]), historyRows(h, "consignor")
		return nil
	})
	if err != nil {
		return err
	}
	if lot == nil {
		return c.fail(errNotFound)
	}
	return c.json(200, map[string]any{"lot": lot, "history": history, "seq": seq})
}

// ---- specialist ----

func (a *App) handleDeskLots(c *reqCtx) error {
	state := c.r.URL.Query().Get("state")
	if !slices.Contains(lotsOnDesk, state) {
		return c.fail(invalid("state", "Choose intake, estimated or placed."))
	}
	var lots []map[string]any
	err := a.read(c.r.Context(), func(q *sql.Tx, now time.Time, seq int64) error {
		rows, err := loadLots(c.r.Context(), q, "", "WHERE l.state = $2 ORDER BY l.created_at, l.id", state)
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

func (a *App) handleEstimate(c *reqCtx) error {
	ctx := c.r.Context()
	id := c.r.PathValue("id")
	var exists bool
	if err := a.db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM lots WHERE id = $1)`, id).Scan(&exists); err != nil {
		return fmt.Errorf("find lot: %w", err)
	}
	if !exists {
		return c.fail(errNotFound)
	}
	body, ae := c.decode()
	if ae != nil {
		return c.fail(ae)
	}
	var out map[string]any
	err := a.tx(ctx, func(t *Tx) error {
		var state string
		if err := t.QueryRowContext(ctx, `SELECT state FROM lots WHERE id = $1 FOR UPDATE`, id).Scan(&state); err != nil {
			return fmt.Errorf("lock lot: %w", err)
		}
		next, ok := lotFlow.next(state, "estimate")
		if !ok {
			return errTransition
		}
		e, fields := checkEstimate(body)
		if len(fields) > 0 {
			return invalidFields(fields)
		}
		_, err := t.ExecContext(ctx, `
			UPDATE lots SET estimate_low = $2, estimate_high = $3, opening_bid = $4, reserve = $5, condition = $6, portrait = $7, state = $8 WHERE id = $1`,
			id, e.low, e.high, e.opening, e.reserve, e.condition, e.portrait, next)
		if err != nil {
			return fmt.Errorf("store estimate: %w", err)
		}
		l, err := loadLot(ctx, t, "", id)
		if err != nil || l == nil {
			return fmt.Errorf("reload lot: %w", err)
		}
		now, err := dbNow(ctx, t)
		out = l.staff(now, nil)
		return err
	})
	if err != nil {
		return err
	}
	return c.json(200, map[string]any{"lot": out})
}

type estimate struct {
	low, high, opening, reserve int
	condition, portrait         string
}

// checkEstimate applies the per-field checks, then the three comparisons in order.
func checkEstimate(body map[string]any) (estimate, map[string]string) {
	var e estimate
	fields := map[string]string{}
	amount := func(key string, dst *int) {
		n, ok := wholeNumber(body[key])
		if !ok || n < 1 || n > ceiling {
			fields[key] = amountProblem
			return
		}
		*dst = n
	}
	amount("estimate_low", &e.low)
	amount("estimate_high", &e.high)
	amount("opening_bid", &e.opening)
	amount("reserve", &e.reserve)
	cond, present := body["condition"]
	switch s, isString := cond.(string); {
	case !present:
	case !isString || len([]rune(s)) > 2000:
		fields["condition"] = "Condition notes can be up to 2,000 characters."
	default:
		e.condition = s
	}
	if p, _ := body["portrait"].(string); portraits[p] {
		e.portrait = p
	} else {
		fields["portrait"] = "Choose a portrait."
	}
	has := func(keys ...string) bool {
		for _, k := range keys {
			if _, bad := fields[k]; bad {
				return true
			}
		}
		return false
	}
	if !has("estimate_low", "estimate_high") && e.low > e.high {
		fields["estimate_high"] = "The low estimate must not be above the high estimate."
	}
	if !has("opening_bid", "estimate_low") && e.opening > e.low {
		fields["opening_bid"] = "The opening bid must not be above the low estimate."
	}
	if !has("reserve", "opening_bid", "estimate_low") && (e.reserve < e.opening || e.reserve > e.low) {
		fields["reserve"] = "The reserve must be between the opening bid and the low estimate."
	}
	return e, fields
}

type saleRow struct {
	ID, Title, State string
	EndsAt           time.Time
	First            int
}

func loadSale(ctx context.Context, q querier, id string) (*saleRow, error) {
	s := &saleRow{ID: id}
	err := q.QueryRowContext(ctx, `SELECT title, ends_at, state, first_lot_number FROM sales WHERE id = $1`, id).Scan(&s.Title, &s.EndsAt, &s.State, &s.First)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load sale: %w", err)
	}
	return s, nil
}

func (s *saleRow) json() map[string]any { return saleJSON(s.ID, s.Title, s.EndsAt, s.State, s.First) }

func saleLots(ctx context.Context, q querier, saleID string, now time.Time) ([]map[string]any, error) {
	rows, err := loadLots(ctx, q, "", "WHERE l.sale_id = $2 ORDER BY l.position", saleID)
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	for _, l := range rows {
		out = append(out, l.staff(now, nil))
	}
	return out, nil
}

func (a *App) handleCreateSale(c *reqCtx) error {
	body, ae := c.decode()
	if ae != nil {
		return c.fail(ae)
	}
	title, _ := body["title"].(string)
	title = strings.TrimSpace(title)
	endsRaw, _ := body["ends_at"].(string)
	first, firstOK := wholeNumber(body["first_lot_number"])
	ends, endsErr := time.Parse(time.RFC3339, endsRaw)
	fields := map[string]string{}
	if n := len([]rune(title)); n < 1 || n > 80 {
		fields["title"] = "Enter a title of up to 80 characters."
	}
	if endsErr != nil {
		fields["ends_at"] = "Enter the end as YYYY-MM-DD HH:MM, Rotterdam time."
	}
	if !firstOK || first < 1 || first > 9999 {
		fields["first_lot_number"] = "Enter a first lot number from 1 to 9999."
	}
	if len(fields) > 0 {
		return c.fail(invalidFields(fields))
	}
	s := &saleRow{ID: newID("sal_"), Title: title, State: saleFlow.start, EndsAt: ends.UTC(), First: first}
	if _, err := a.db.ExecContext(c.r.Context(), `INSERT INTO sales (id, title, ends_at, first_lot_number, state) VALUES ($1, $2, $3, $4, $5)`,
		s.ID, s.Title, s.EndsAt, s.First, s.State); err != nil {
		return fmt.Errorf("create sale: %w", err)
	}
	return c.json(201, map[string]any{"sale": s.json()})
}

func (a *App) handleSales(c *reqCtx) error {
	var sales []map[string]any
	err := a.read(c.r.Context(), func(q *sql.Tx, now time.Time, seq int64) error {
		rows, err := q.QueryContext(c.r.Context(), `SELECT id FROM sales ORDER BY created_at DESC, id`)
		if err != nil {
			return fmt.Errorf("list sales: %w", err)
		}
		var ids []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return fmt.Errorf("scan sale: %w", err)
			}
			ids = append(ids, id)
		}
		rows.Close()
		sales = []map[string]any{}
		for _, id := range ids {
			s, err := loadSale(c.r.Context(), q, id)
			if err != nil || s == nil {
				return err
			}
			lots, err := saleLots(c.r.Context(), q, id, now)
			if err != nil {
				return err
			}
			m := s.json()
			m["lots"] = lots
			sales = append(sales, m)
		}
		return nil
	})
	if err != nil {
		return err
	}
	return c.json(200, map[string]any{"sales": sales})
}

func (a *App) handleOrderLots(c *reqCtx) error {
	ctx := c.r.Context()
	saleID := c.r.PathValue("id")
	sale, err := loadSale(ctx, a.db, saleID)
	if err != nil {
		return err
	}
	if sale == nil {
		return c.fail(errNotFound)
	}
	body, ae := c.decode()
	if ae != nil {
		return c.fail(ae)
	}
	raw, _ := body["lot_ids"].([]any)
	var ids []string
	seen := map[string]bool{}
	for _, v := range raw {
		id, ok := v.(string)
		if !ok || seen[id] {
			return c.fail(invalid("lot_ids", "List each lot once."))
		}
		seen[id] = true
		ids = append(ids, id)
	}
	for _, id := range ids {
		var exists bool
		if err := a.db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM lots WHERE id = $1)`, id).Scan(&exists); err != nil {
			return fmt.Errorf("find lot: %w", err)
		}
		if !exists {
			return c.fail(errNotFound)
		}
	}
	var lots []map[string]any
	err = a.tx(ctx, func(t *Tx) error {
		var state string
		if err := t.QueryRowContext(ctx, `SELECT state FROM sales WHERE id = $1 FOR UPDATE`, saleID).Scan(&state); err != nil {
			return fmt.Errorf("lock sale: %w", err)
		}
		if !saleFlow.can(state, "publish") {
			return failure(409, "sale_published", "That sale is already published.")
		}
		placed := map[string]string{}
		for _, id := range ids {
			var lotState string
			var lotSale sql.NullString
			if err := t.QueryRowContext(ctx, `SELECT state, sale_id FROM lots WHERE id = $1 FOR UPDATE`, id).Scan(&lotState, &lotSale); err != nil {
				return fmt.Errorf("lock lot: %w", err)
			}
			if !canPlace(lotState, lotSale.String, saleID) {
				return errTransition
			}
			placed[id], _ = lotFlow.next(lotState, "place")
		}
		dropped, err := t.QueryContext(ctx, `SELECT id, state FROM lots WHERE sale_id = $1 AND NOT (id = ANY($2)) ORDER BY id FOR UPDATE`, saleID, pqStrings(ids))
		if err != nil {
			return fmt.Errorf("find lots leaving sale: %w", err)
		}
		unplaced := map[string]string{}
		for dropped.Next() {
			var id, state string
			if err := dropped.Scan(&id, &state); err != nil {
				dropped.Close()
				return fmt.Errorf("scan lot leaving sale: %w", err)
			}
			if to, ok := lotFlow.next(state, "unplace"); ok {
				unplaced[id] = to
			}
		}
		dropped.Close()
		if err := readErr(dropped, "lots leaving sale"); err != nil {
			return err
		}
		for id, to := range unplaced {
			if _, err := t.ExecContext(ctx, `UPDATE lots SET state = $2, sale_id = NULL, position = NULL WHERE id = $1`, id, to); err != nil {
				return fmt.Errorf("remove lots from sale: %w", err)
			}
		}
		for i, id := range ids {
			if _, err := t.ExecContext(ctx, `UPDATE lots SET state = $4, sale_id = $2, position = $3 WHERE id = $1`, id, saleID, i, placed[id]); err != nil {
				return fmt.Errorf("place lot: %w", err)
			}
		}
		now, err := dbNow(ctx, t)
		if err != nil {
			return err
		}
		lots, err = saleLots(ctx, t, saleID, now)
		return err
	})
	if err != nil {
		return err
	}
	if lots == nil {
		lots = []map[string]any{}
	}
	return c.json(200, map[string]any{"sale": sale.json(), "lots": lots})
}

func (a *App) handlePublish(c *reqCtx) error {
	ctx := c.r.Context()
	saleID := c.r.PathValue("id")
	sale, err := loadSale(ctx, a.db, saleID)
	if err != nil {
		return err
	}
	if sale == nil {
		return c.fail(errNotFound)
	}
	var out map[string]any
	var lots []map[string]any
	err = a.tx(ctx, func(t *Tx) error {
		s := &saleRow{ID: saleID}
		if err := t.QueryRowContext(ctx, `SELECT title, ends_at, state, first_lot_number FROM sales WHERE id = $1 FOR UPDATE`, saleID).Scan(&s.Title, &s.EndsAt, &s.State, &s.First); err != nil {
			return fmt.Errorf("lock sale: %w", err)
		}
		published, ok := saleFlow.next(s.State, "publish")
		if !ok {
			return failure(409, "sale_published", "That sale is already published.")
		}
		now, err := dbNow(ctx, t)
		if err != nil {
			return err
		}
		if !s.EndsAt.After(now) {
			return invalid("ends_at", "The sale must end in the future.")
		}
		var count int
		if err := t.QueryRowContext(ctx, `SELECT count(*) FROM lots WHERE sale_id = $1`, saleID).Scan(&count); err != nil {
			return fmt.Errorf("count sale lots: %w", err)
		}
		if count == 0 {
			return invalid("lots", "Add at least one lot before publishing.")
		}
		opening, err := t.QueryContext(ctx, `SELECT id, state FROM lots WHERE sale_id = $1 ORDER BY id FOR UPDATE`, saleID)
		if err != nil {
			return fmt.Errorf("find sale lots: %w", err)
		}
		opened := map[string]string{}
		for opening.Next() {
			var id, state string
			if err := opening.Scan(&id, &state); err != nil {
				opening.Close()
				return fmt.Errorf("scan sale lot: %w", err)
			}
			to, ok := lotFlow.next(state, "publish")
			if !ok {
				opening.Close()
				return errTransition
			}
			opened[id] = to
		}
		opening.Close()
		if err := readErr(opening, "sale lots"); err != nil {
			return err
		}
		for id, to := range opened {
			_, err = t.ExecContext(ctx, `
				UPDATE lots SET state = $5, lot_number = $2 + position, closes_at = $3::timestamptz + position * make_interval(secs => $4)
				WHERE id = $1`, id, s.First, s.EndsAt, a.cfg.lotGap.Seconds(), to)
			if err != nil {
				return fmt.Errorf("open lots: %w", err)
			}
		}
		if _, err := t.ExecContext(ctx, `UPDATE sales SET state = $2 WHERE id = $1`, saleID, published); err != nil {
			return fmt.Errorf("publish sale: %w", err)
		}
		s.State = published
		out = s.json()
		lots, err = saleLots(ctx, t, saleID, now)
		return err
	})
	if err != nil {
		return err
	}
	return c.json(200, map[string]any{"sale": out, "lots": lots})
}

// ---- cashier ----

func (a *App) handleInvoices(c *reqCtx) error {
	status := c.r.URL.Query().Get("status")
	clause, args := "ORDER BY i.issued_at DESC, i.number DESC", []any(nil)
	if status != "" {
		if !invoiceFlow.known(status) {
			return c.fail(invalid("status", "Choose issued, paid or defaulted."))
		}
		clause, args = "WHERE i.status = $1 "+clause, []any{status}
	}
	var out []map[string]any
	err := a.read(c.r.Context(), func(q *sql.Tx, now time.Time, seq int64) error {
		list, err := loadInvoices(c.r.Context(), q, clause, args...)
		out = invoiceJSONs(list, true)
		return err
	})
	if err != nil {
		return err
	}
	return c.json(200, map[string]any{"invoices": out})
}

func (a *App) handleInvoice(c *reqCtx) error {
	var out map[string]any
	err := a.snapshot(c.r.Context(), func(q *sql.Tx) error {
		list, err := loadInvoices(c.r.Context(), q, "WHERE i.id = $1", c.r.PathValue("id"))
		if err != nil || len(list) == 0 {
			return err
		}
		out = list[0].json(true)
		return nil
	})
	if err != nil {
		return err
	}
	if out == nil {
		return c.fail(errNotFound)
	}
	return c.json(200, map[string]any{"invoice": out})
}

var paymentMethods = map[string]bool{"bank_transfer": true, "card": true, "cash": true}

func (a *App) handlePayment(c *reqCtx) error {
	ctx := c.r.Context()
	id := c.r.PathValue("id")
	var exists bool
	if err := a.db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM invoices WHERE id = $1)`, id).Scan(&exists); err != nil {
		return fmt.Errorf("find invoice: %w", err)
	}
	if !exists {
		return c.fail(errNotFound)
	}
	body, ae := c.decode()
	if ae != nil {
		return c.fail(ae)
	}
	raw, _ := body["amount"].(string)
	method, _ := body["method"].(string)
	var payment, invoice map[string]any
	err := a.tx(ctx, func(t *Tx) error {
		if _, err := t.ExecContext(ctx, `SELECT 1 FROM invoices WHERE id = $1 FOR UPDATE`, id); err != nil {
			return fmt.Errorf("lock invoice: %w", err)
		}
		list, err := loadInvoices(ctx, t, "WHERE i.id = $1", id)
		if err != nil || len(list) == 0 {
			return fmt.Errorf("load invoice: %w", err)
		}
		inv := list[0]
		now, err := dbNow(ctx, t)
		if err != nil {
			return err
		}
		if err := paymentRefusal(inv.Status, inv.Number, inv.DueAt, now); err != nil {
			return err
		}
		cents, ok := parseCents(raw)
		if !ok || cents <= 0 {
			return invalid("amount", "Enter an amount in euros and cents, for example 125.50.")
		}
		if cents > inv.outstanding() {
			return invalid("amount", fmt.Sprintf("That is more than the %s still owed.", amountText(inv.outstanding())))
		}
		if !paymentMethods[method] {
			return invalid("method", "Choose bank transfer, card or cash.")
		}
		if _, err := t.ExecContext(ctx, `INSERT INTO payments (invoice_id, amount_cents, method, recorded_at) VALUES ($1, $2, $3, $4)`, id, cents, method, now); err != nil {
			return fmt.Errorf("record payment: %w", err)
		}
		if cents == inv.outstanding() {
			paid, _ := invoiceFlow.next(inv.Status, "pay")
			if _, err := t.ExecContext(ctx, `UPDATE invoices SET status = $2 WHERE id = $1`, id, paid); err != nil {
				return fmt.Errorf("mark invoice paid: %w", err)
			}
			for _, l := range inv.Lines {
				if _, err := moveLot(ctx, t, l.LotID, "pay"); err != nil {
					return err
				}
				t.lotChanged(l.LotID, "close")
			}
		}
		payment = map[string]any{"amount": decimalText(cents), "method": method, "recorded_at": apiTime(now)}
		list, err = loadInvoices(ctx, t, "WHERE i.id = $1", id)
		if err != nil || len(list) == 0 {
			return fmt.Errorf("reload invoice: %w", err)
		}
		invoice = list[0].json(true)
		return nil
	})
	if err != nil {
		return err
	}
	return c.json(201, map[string]any{"payment": payment, "invoice": invoice})
}

// ---- admin ----

func (a *App) handleRegistrations(c *reqCtx) error {
	status := c.r.URL.Query().Get("status")
	if status == "" {
		status = registrationFlow.start
	}
	rows, err := a.db.QueryContext(c.r.Context(), `
		SELECT id, full_name, phone, address, status, created_at FROM registrations
		WHERE role = 'bidder' AND status = $1 ORDER BY created_at, id`, status)
	if err != nil {
		return fmt.Errorf("list registrations: %w", err)
	}
	defer rows.Close()
	list := []map[string]any{}
	for rows.Next() {
		var id, name, phone, address, st string
		var at time.Time
		if err := rows.Scan(&id, &name, &phone, &address, &st, &at); err != nil {
			return fmt.Errorf("scan registration: %w", err)
		}
		list = append(list, map[string]any{"id": id, "full_name": name, "phone": phone, "address": address, "status": st, "created_at": apiTime(at)})
	}
	if err := readErr(rows, "registrations"); err != nil {
		return err
	}
	return c.json(200, map[string]any{"registrations": list})
}

func (a *App) handleApprove(c *reqCtx) error {
	ctx := c.r.Context()
	id := c.r.PathValue("id")
	var exists bool
	if err := a.db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM registrations WHERE id = $1)`, id).Scan(&exists); err != nil {
		return fmt.Errorf("find registration: %w", err)
	}
	if !exists {
		return c.fail(errNotFound)
	}
	body, ae := c.decode()
	if ae != nil {
		return c.fail(ae)
	}
	var out map[string]any
	err := a.tx(ctx, func(t *Tx) error {
		var person, role, status, name string
		if err := t.QueryRowContext(ctx, `SELECT person_id, role, status, full_name FROM registrations WHERE id = $1 FOR UPDATE`, id).Scan(&person, &role, &status, &name); err != nil {
			return fmt.Errorf("lock registration: %w", err)
		}
		active, ok := registrationFlow.next(status, "approve")
		if !ok {
			return errTransition
		}
		limit, ok := wholeNumber(body["spending_limit"])
		if !ok || limit < 100 || limit > ceiling {
			return invalid("spending_limit", "Enter a spending limit between €100 and €1,000,000.")
		}
		paddle, err := nextCounter(ctx, t, "paddle")
		if err != nil {
			return err
		}
		if _, err := t.ExecContext(ctx, `UPDATE registrations SET status = $4, paddle = $2, spending_limit = $3 WHERE id = $1`, id, paddle, limit, active); err != nil {
			return fmt.Errorf("approve registration: %w", err)
		}
		text := fmt.Sprintf("Your spending limit of %s is approved. You can bid now.", euros(limit))
		if err := notify(ctx, t, person, "limit_approved", text, ""); err != nil {
			return err
		}
		out = map[string]any{"id": id, "role": role, "status": active, "paddle": int(paddle), "spending_limit": limit, "full_name": name}
		return nil
	})
	if err != nil {
		return err
	}
	return c.json(200, map[string]any{"registration": out})
}
