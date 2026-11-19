package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/lib/pq"
)

// pqStrings sends a string slice as a SQL array; a nil slice becomes an empty array, not NULL
// (`NOT (id = ANY(NULL))` is NULL, which would select nothing).
func pqStrings(s []string) any {
	if s == nil {
		s = []string{}
	}
	return pq.Array(s)
}

// read settles due lots, then runs fn in one consistent snapshot. fn is repeated if a lot
// slipped past its close between settling and reading, so no view shows a lot open at or past its close.
func (a *App) read(ctx context.Context, fn func(q *sql.Tx, now time.Time, seq int64) error) error {
	for attempt := 0; ; attempt++ {
		if err := a.settleDue(ctx); err != nil {
			return err
		}
		var stale bool
		err := a.snapshot(ctx, func(q *sql.Tx) error {
			var seq int64
			var now time.Time
			if err := q.QueryRowContext(ctx, `SELECT (SELECT n FROM counters WHERE name = 'event'), clock_timestamp()`).Scan(&seq, &now); err != nil {
				return fmt.Errorf("read sequence: %w", err)
			}
			if err := fn(q, now, seq); err != nil {
				return err
			}
			return q.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM lots WHERE state = ANY($2) AND closes_at <= $1)`, now, pqStrings(lotsRunning)).Scan(&stale)
		})
		if err != nil {
			return err
		}
		if !stale || attempt >= 4 {
			return nil
		}
	}
}

func saleJSON(id, title string, endsAt time.Time, state string, first int) map[string]any {
	return map[string]any{"id": id, "title": title, "ends_at": apiTime(endsAt), "state": state, "first_lot_number": first}
}

func (a *App) handleCurrentSale(c *reqCtx) error {
	var out map[string]any
	err := a.read(c.r.Context(), func(q *sql.Tx, now time.Time, seq int64) error {
		var id, title, state string
		var ends time.Time
		var first int
		err := q.QueryRowContext(c.r.Context(), `
			SELECT s.id, s.title, s.ends_at, s.state, s.first_lot_number FROM sales s
			WHERE s.state = ANY($1) ORDER BY (SELECT max(closes_at) FROM lots WHERE sale_id = s.id), s.created_at LIMIT 1`, pqStrings(salesLive)).
			Scan(&id, &title, &ends, &state, &first)
		if errors.Is(err, sql.ErrNoRows) {
			err = q.QueryRowContext(c.r.Context(), `
				SELECT s.id, s.title, s.ends_at, s.state, s.first_lot_number FROM sales s
				WHERE s.state = ANY($1) ORDER BY (SELECT max(closes_at) FROM lots WHERE sale_id = s.id) DESC, s.created_at DESC LIMIT 1`, pqStrings(salesEnded)).
				Scan(&id, &title, &ends, &state, &first)
		}
		if errors.Is(err, sql.ErrNoRows) {
			out = nil
			return nil
		}
		if err != nil {
			return fmt.Errorf("find current sale: %w", err)
		}
		out = saleJSON(id, title, ends, state, first)
		return nil
	})
	if err != nil {
		return err
	}
	if out == nil {
		return c.fail(failure(404, "not_found", "No sale has been published."))
	}
	return c.json(200, map[string]any{"sale": out})
}

func (a *App) handleCatalogue(c *reqCtx) error {
	saleID := c.r.PathValue("id")
	var sale map[string]any
	var lots []map[string]any
	var seq int64
	err := a.read(c.r.Context(), func(q *sql.Tx, now time.Time, s int64) error {
		seq = s
		var title, state string
		var ends time.Time
		var first int
		err := q.QueryRowContext(c.r.Context(), `SELECT title, ends_at, state, first_lot_number FROM sales WHERE id = $1`, saleID).Scan(&title, &ends, &state, &first)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && !salePublic(state) && !(c.viewer != nil && c.viewer.hasRole("specialist"))) {
			sale = nil
			return nil
		}
		if err != nil {
			return fmt.Errorf("load sale: %w", err)
		}
		sale = saleJSON(saleID, title, ends, state, first)
		rows, err := loadLots(c.r.Context(), q, viewerID(c.viewer), "WHERE l.sale_id = $2", saleID)
		if err != nil {
			return err
		}
		sort.SliceStable(rows, func(i, j int) bool { return catalogueLess(rows[i], rows[j]) })
		offers, err := a.offersFor(c.r.Context(), q, c.viewer, rows)
		if err != nil {
			return err
		}
		lots = lots[:0]
		for _, l := range rows {
			switch viewFor(c.viewer, l) {
			case viewBidder:
				lots = append(lots, l.bidder(now, c.viewer.PersonID))
			case viewConsignor:
				lots = append(lots, l.consignor(now, offers[l.ID]))
			default:
				lots = append(lots, l.public(now))
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	if sale == nil {
		return c.fail(errNotFound)
	}
	if lots == nil {
		lots = []map[string]any{}
	}
	return c.json(200, map[string]any{"sale": sale, "lots": lots, "seq": seq})
}

// offersFor loads latest offers only for a consignor looking at their own lots.
func (a *App) offersFor(ctx context.Context, q querier, v *Viewer, rows []*lotRow) (map[string]*offerRow, error) {
	var ids []string
	for _, l := range rows {
		if viewFor(v, l) == viewConsignor {
			ids = append(ids, l.ID)
		}
	}
	return latestOffers(ctx, q, ids)
}

func (a *App) handleLot(c *reqCtx) error {
	id := c.r.PathValue("id")
	var lot map[string]any
	var history []map[string]any
	var seq int64
	err := a.read(c.r.Context(), func(q *sql.Tx, now time.Time, s int64) error {
		seq = s
		l, err := loadLot(c.r.Context(), q, viewerID(c.viewer), id)
		if err != nil {
			return err
		}
		if l == nil || !l.published() {
			lot = nil
			return nil
		}
		offers, err := a.offersFor(c.r.Context(), q, c.viewer, []*lotRow{l})
		if err != nil {
			return err
		}
		lot, history, err = projectLot(c.r.Context(), q, c.viewer, l, now, offers)
		return err
	})
	if err != nil {
		return err
	}
	if lot == nil {
		return c.fail(errNotFound)
	}
	return c.json(200, map[string]any{"lot": lot, "history": history, "seq": seq})
}

func (a *App) handleWatch(c *reqCtx) error {
	id := c.r.PathValue("id")
	watching := c.r.Method == "PUT"
	err := a.tx(c.r.Context(), func(t *Tx) error {
		var state string
		var closes sql.NullTime
		err := t.QueryRowContext(c.r.Context(), `SELECT state, closes_at FROM lots WHERE id = $1 FOR SHARE`, id).Scan(&state, &closes)
		if errors.Is(err, sql.ErrNoRows) || !lotPublished(state) {
			return errNotFound
		}
		if err != nil {
			return fmt.Errorf("load lot: %w", err)
		}
		if !watching {
			if _, err = t.ExecContext(c.r.Context(), `DELETE FROM watches WHERE person_id = $1 AND lot_id = $2`, c.viewer.PersonID, id); err != nil {
				return fmt.Errorf("delete watch: %w", err)
			}
			t.watchChanged(id, c.viewer.PersonID)
			return nil
		}
		now, err := dbNow(c.r.Context(), t)
		if err != nil {
			return err
		}
		sent := !lotRunning(state) || !closes.Time.Add(-a.cfg.watchNotice).After(now)
		if _, err = t.ExecContext(c.r.Context(), `INSERT INTO watches (person_id, lot_id, notified) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, c.viewer.PersonID, id, sent); err != nil {
			return fmt.Errorf("insert watch: %w", err)
		}
		t.watchChanged(id, c.viewer.PersonID)
		return nil
	})
	if err != nil {
		return err
	}
	return c.json(200, map[string]any{"watching": watching})
}

func (a *App) handleDashboard(c *reqCtx) error {
	v := c.viewer
	var out map[string]any
	err := a.read(c.r.Context(), func(q *sql.Tx, now time.Time, seq int64) error {
		ctx := c.r.Context()
		all, err := loadLots(ctx, q, v.PersonID, `
			WHERE NOT (l.state = ANY($3)) AND (l.leader_id = $2 OR l.winner_id = $2 OR EXISTS (SELECT 1 FROM watches w WHERE w.lot_id = l.id AND w.person_id = $2))
			ORDER BY l.lot_number`, v.PersonID, pqStrings(lotsOnDesk))
		if err != nil {
			return err
		}
		leading, watching, won := []map[string]any{}, []map[string]any{}, []map[string]any{}
		committed := 0
		for _, l := range all {
			if l.isRunning() && l.LeaderID.String == v.PersonID {
				leading = append(leading, l.bidder(now, v.PersonID))
				committed += int(l.LeaderMax.Int64)
			}
			if l.Watching {
				watching = append(watching, l.bidder(now, v.PersonID))
			}
			if l.WinnerID.String == v.PersonID && lotSold(l.State) {
				won = append(won, l.bidder(now, v.PersonID))
			}
		}
		offers, err := loadOffers(ctx, q, "WHERE o.person_id = $1 ORDER BY o.created_at DESC", v.PersonID)
		if err != nil {
			return err
		}
		offerList := make([]map[string]any, 0, len(offers))
		for _, o := range offers {
			offerList = append(offerList, o.json())
		}
		invoices, err := loadInvoices(ctx, q, "WHERE i.person_id = $1 ORDER BY i.issued_at DESC, i.number DESC", v.PersonID)
		if err != nil {
			return err
		}
		out = map[string]any{
			"paddle": optIntPtr(v.Reg.Paddle), "status": v.Reg.Status, "spending_limit": optIntPtr(v.Reg.Limit),
			"committed": committed, "leading": leading, "watching": watching, "won": won,
			"offers": offerList, "invoices": invoiceJSONs(invoices, false), "seq": seq,
		}
		return nil
	})
	if err != nil {
		return err
	}
	return c.json(200, out)
}

func optIntPtr(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}

func (a *App) handleBidderInvoice(c *reqCtx) error {
	var invoice map[string]any
	err := a.read(c.r.Context(), func(q *sql.Tx, now time.Time, seq int64) error {
		list, err := loadInvoices(c.r.Context(), q, "WHERE i.id = $1 AND i.person_id = $2", c.r.PathValue("id"), c.viewer.PersonID)
		if err != nil || len(list) == 0 {
			invoice = nil
			return err
		}
		invoice = list[0].json(false)
		return nil
	})
	if err != nil {
		return err
	}
	if invoice == nil {
		return c.fail(errNotFound)
	}
	return c.json(200, map[string]any{"invoice": invoice})
}

func (a *App) handleNotices(c *reqCtx) error {
	var list []map[string]any
	var seq int64
	err := a.snapshot(c.r.Context(), func(q *sql.Tx) error {
		if err := q.QueryRowContext(c.r.Context(), `SELECT n FROM counters WHERE name = 'event'`).Scan(&seq); err != nil {
			return fmt.Errorf("read sequence: %w", err)
		}
		rows, err := q.QueryContext(c.r.Context(), `SELECT id, kind, text, lot_id, created_at FROM notices WHERE person_id = $1 ORDER BY created_at DESC, id DESC LIMIT 200`, c.viewer.PersonID)
		if err != nil {
			return fmt.Errorf("load notices: %w", err)
		}
		defer rows.Close()
		list = []map[string]any{}
		for rows.Next() {
			n, err := scanNotice(rows)
			if err != nil {
				return err
			}
			list = append(list, n)
		}
		return readErr(rows, "notices")
	})
	if err != nil {
		return err
	}
	return c.json(200, map[string]any{"notices": list, "seq": seq})
}

func scanNotice(rows interface{ Scan(...any) error }) (map[string]any, error) {
	var id int64
	var kind, text string
	var lot sql.NullString
	var at time.Time
	if err := rows.Scan(&id, &kind, &text, &lot, &at); err != nil {
		return nil, fmt.Errorf("scan notice: %w", err)
	}
	return map[string]any{"id": fmt.Sprint(id), "kind": kind, "text": text, "lot_id": optString(lot), "created_at": apiTime(at)}, nil
}

// notify writes one in-app notice and queues its change feed event.
func notify(ctx context.Context, t *Tx, personID, kind, text, lotID string) error {
	var id int64
	err := t.QueryRowContext(ctx, `INSERT INTO notices (person_id, kind, text, lot_id) VALUES ($1, $2, $3, NULLIF($4, '')) RETURNING id`,
		personID, kind, text, lotID).Scan(&id)
	if err != nil {
		return fmt.Errorf("write notice: %w", err)
	}
	t.pending = append(t.pending, pendingEvent{kind: "notice", noticeID: id})
	return nil
}
