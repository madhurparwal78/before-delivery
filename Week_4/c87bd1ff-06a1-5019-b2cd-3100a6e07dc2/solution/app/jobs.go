package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// runJobs carries out every timed event within a second of its due moment. Any number of
// processes may run it: each step claims its row inside a transaction, so an event happens once.
func (a *App) runJobs(ctx context.Context) {
	tick := time.NewTicker(250 * time.Millisecond)
	defer tick.Stop()
	purge := time.NewTicker(10 * time.Minute)
	defer purge.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-purge.C:
			a.purgeAttempts(ctx)
		case <-tick.C:
			for name, step := range map[string]func(context.Context) error{
				"close lots": a.settleDue, "closing-soon notices": a.sendClosingSoon,
				"defaults": a.runDefaults, "offer expiry": a.expireOffers,
			} {
				if err := step(ctx); err != nil && ctx.Err() == nil {
					logf("timed job %s: %v", name, err)
				}
			}
		}
	}
}

func (a *App) ids(ctx context.Context, query string, args ...any) ([]string, error) {
	rows, err := a.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("find due rows: %w", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan due row: %w", err)
		}
		out = append(out, id)
	}
	return out, readErr(rows, "due rows")
}

func (a *App) runDefaults(ctx context.Context) error {
	ids, err := a.ids(ctx, `SELECT id FROM invoices WHERE status = ANY($1) AND due_at <= clock_timestamp()`, pqStrings(invoicesDue))
	if err != nil {
		return fmt.Errorf("find due invoices: %w", err)
	}
	for _, id := range ids {
		if err := a.defaultInvoice(ctx, id); err != nil {
			return err
		}
	}
	return nil
}

func (a *App) expireOffers(ctx context.Context) error {
	ids, err := a.ids(ctx, `SELECT id FROM offers WHERE status = ANY($1) AND expires_at <= clock_timestamp()`, pqStrings(offersOpen))
	if err != nil {
		return fmt.Errorf("find expired offers: %w", err)
	}
	for _, id := range ids {
		err := a.tx(ctx, func(t *Tx) error {
			if _, err := t.ExecContext(ctx, `SELECT 1 FROM offers WHERE id = $1 FOR UPDATE`, id); err != nil {
				return fmt.Errorf("lock offer: %w", err)
			}
			list, err := loadOffers(ctx, t, "WHERE o.id = $1", id)
			if err != nil || len(list) == 0 {
				return wrap("load expired offer", err)
			}
			now, err := dbNow(ctx, t)
			if err != nil {
				return err
			}
			if !offerLapses(list[0].Status, list[0].ExpiresAt, now) {
				return nil
			}
			if _, err := t.ExecContext(ctx, `SELECT 1 FROM lots WHERE id = $1 FOR UPDATE`, list[0].LotID); err != nil {
				return fmt.Errorf("lock offered lot: %w", err)
			}
			return a.expireOffer(ctx, t, list[0])
		})
		if err != nil {
			return err
		}
	}
	return nil
}

// sendClosingSoon sends each watcher one notice ahead of the lot's current close.
func (a *App) sendClosingSoon(ctx context.Context) error {
	rows, err := a.db.QueryContext(ctx, `
		SELECT DISTINCT w.lot_id FROM watches w JOIN lots l ON l.id = w.lot_id
		WHERE NOT w.notified AND l.state = ANY($2) AND l.closes_at > clock_timestamp()
		  AND l.closes_at - make_interval(secs => $1) <= clock_timestamp()`, a.cfg.watchNotice.Seconds(), pqStrings(lotsRunning))
	if err != nil {
		return fmt.Errorf("find closing-soon lots: %w", err)
	}
	var lots []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return fmt.Errorf("scan closing-soon lot: %w", err)
		}
		lots = append(lots, id)
	}
	rows.Close()
	if err := readErr(rows, "closing-soon lots"); err != nil {
		return err
	}
	for _, id := range lots {
		err := a.tx(ctx, func(t *Tx) error {
			var number int
			var closes time.Time
			err := t.QueryRowContext(ctx, `
				SELECT lot_number, closes_at FROM lots
				WHERE id = $1 AND state = ANY($3) AND closes_at > clock_timestamp()
				  AND closes_at - make_interval(secs => $2) <= clock_timestamp() FOR UPDATE`, id, a.cfg.watchNotice.Seconds(), pqStrings(lotsRunning)).Scan(&number, &closes)
			if errors.Is(err, sql.ErrNoRows) {
				return nil
			}
			if err != nil {
				return fmt.Errorf("lock closing lot: %w", err)
			}
			watchers, err := t.QueryContext(ctx, `UPDATE watches SET notified = true WHERE lot_id = $1 AND NOT notified RETURNING person_id`, id)
			if err != nil {
				return fmt.Errorf("claim watchers: %w", err)
			}
			var people []string
			for watchers.Next() {
				var p string
				if err := watchers.Scan(&p); err != nil {
					watchers.Close()
					return fmt.Errorf("scan watcher: %w", err)
				}
				people = append(people, p)
			}
			watchers.Close()
			for _, p := range people {
				text := fmt.Sprintf("Lot %d closes soon, at %s.", number, rotterdamTime(closes))
				if err := notify(ctx, t, p, "closing_soon", text, id); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			return err
		}
	}
	return nil
}
