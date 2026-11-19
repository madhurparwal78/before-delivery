// Package timing carries out every timed event within one second of its due
// moment, exactly once, across several app processes.
package timing

import (
	"context"
	"time"

	"gavelhouse/internal/live"
	"gavelhouse/internal/store"
)

type Worker struct {
	db  *store.Store
	hub *live.Hub
}

func New(db *store.Store, hub *live.Hub) *Worker {
	return &Worker{db: db, hub: hub}
}

// Run ticks until the context ends. Every second it closes due lots, sends due
// closing-soon notices, defaults due invoices and expires due offers, then
// tells the hub to deliver what changed.
func (w *Worker) Run(ctx context.Context) {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			w.tick(ctx)
		}
	}
}

func (w *Worker) tick(ctx context.Context) {
	changed := false
	if ids, err := w.db.LotsDueToClose(ctx); err == nil {
		for _, id := range ids {
			if err := w.db.CloseOneLot(ctx, id); err == nil {
				changed = true
			}
		}
	}
	if err := w.db.ClosingNoticesDue(ctx); err == nil {
		changed = true
	}
	if _, err := w.db.InvoiceDueNow(ctx); err == nil {
		changed = true
	}
	if _, err := w.db.ExpireOffers(ctx); err == nil {
		changed = true
	}
	var latest int64
	err := w.db.WithTx(ctx, func(ctx context.Context, tx store.Tx) error {
		var err error
		latest, err = tx.LatestSeq(ctx)
		return err
	})
	if err == nil {
		w.hub.Advance(latest)
		_ = changed
	}
}
