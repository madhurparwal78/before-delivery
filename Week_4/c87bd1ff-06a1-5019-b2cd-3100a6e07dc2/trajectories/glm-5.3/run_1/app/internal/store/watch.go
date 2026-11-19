package store

import (
	"context"
	"fmt"
	"time"
)

// scheduleClosingNotices writes a due event for each watcher whose closing-soon
// notice is still ahead of the lot's (possibly moved) close.
func (s *Store) scheduleClosingNotices(ctx context.Context, tx Tx, lot *LotFull, closesAt time.Time) error {
	if !lot.IsOpenish() {
		return nil
	}
	due := closesAt.Add(-s.cfg.WatchNotice)
	watchers, err := tx.Watchers(ctx, lot.ID)
	if err != nil {
		return fmt.Errorf("reading the watchers: %w", err)
	}
	now, err := tx.Now(ctx)
	if err != nil {
		return fmt.Errorf("reading the clock: %w", err)
	}
	for _, w := range watchers {
		sent, err := tx.ClosingNoticeSent(ctx, lot.ID, w)
		if err != nil {
			return fmt.Errorf("checking the closing notice: %w", err)
		}
		if sent || !now.Before(due) {
			continue
		}
		if err := tx.InsertDueEvent(ctx, "closing_notice", &lot.ID, &w, nil, nil, due); err != nil {
			return fmt.Errorf("scheduling the closing notice: %w", err)
		}
	}
	return nil
}
