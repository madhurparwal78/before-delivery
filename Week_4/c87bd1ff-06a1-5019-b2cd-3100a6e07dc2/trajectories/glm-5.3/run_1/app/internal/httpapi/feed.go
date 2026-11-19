package httpapi

import (
	"context"
	"time"

	"gavelhouse/internal/store"
)

// feed implements live.Feed: it projects committed events for each viewer.
type feed struct {
	server *Server
}

func (f *feed) Latest(ctx context.Context) (int64, error) {
	var latest int64
	err := f.server.db.WithTx(ctx, func(ctx context.Context, tx store.Tx) error {
		var err error
		latest, err = tx.LatestSeq(ctx)
		return err
	})
	return latest, err
}

// Frame projects one event for one viewer, or nil when they cannot see it.
func (f *feed) Frame(ctx context.Context, seq int64, viewer *store.Person) (map[string]any, error) {
	var frame map[string]any
	err := f.server.db.WithTx(ctx, func(ctx context.Context, tx store.Tx) error {
		rows, err := tx.EventsAfter(ctx, seq-1)
		if err != nil {
			return err
		}
		for _, e := range rows {
			if e.Seq != seq {
				continue
			}
			frame, err = f.projectEvent(ctx, tx, e, viewer)
			if err != nil {
				return err
			}
			return nil
		}
		return nil
	})
	return frame, err
}

func (f *feed) projectEvent(ctx context.Context, tx store.Tx, e store.EventRow, viewer *store.Person) (map[string]any, error) {
	now, err := tx.Now(ctx)
	if err != nil {
		return nil, err
	}
	anonymous := viewer == nil
	switch e.Kind {
	case "notice":
		if anonymous || e.PersonID == nil || *e.PersonID != viewer.ID {
			return nil, nil
		}
		notices, err := tx.PersonNotices(ctx, viewer.ID)
		if err != nil {
			return nil, err
		}
		// The newest notice created by this event.
		for _, n := range notices {
			if n.PersonID == *e.PersonID {
				return map[string]any{"seq": e.Seq, "type": "notice", "notice": noticeView(n)}, nil
			}
		}
		return nil, nil
	case "watch":
		if anonymous || e.PersonID == nil || *e.PersonID != viewer.ID || e.LotID == nil {
			return nil, nil
		}
		lotFrame, err := f.lotChangedFrame(ctx, tx, *e.LotID, "watch", viewer, now)
		if err != nil {
			return nil, err
		}
		lotFrame["seq"] = e.Seq
		return lotFrame, nil
	default:
		if e.LotID == nil {
			// Invoice, payment, statement and approval events are carried to
			// the people they touch as notices; other pages refresh their own
			// panels from notice frames, or refetch when their data changes.
			return nil, nil
		}
		lotFrame, err := f.lotChangedFrame(ctx, tx, *e.LotID, causeOf(e.Kind), viewer, now)
		if err != nil {
			return nil, err
		}
		lotFrame["seq"] = e.Seq
		return lotFrame, nil
	}
}

func causeOf(kind string) string {
	switch kind {
	case "bid":
		return "bid"
	case "extension":
		return "extension"
	case "removal":
		return "removal"
	case "close":
		return "close"
	case "offer":
		return "offer"
	default:
		return "watch"
	}
}

// lotChangedFrame builds one lot_changed frame in the viewer's own projection.
func (f *feed) lotChangedFrame(ctx context.Context, tx store.Tx, lotID, cause string, viewer *store.Person, now time.Time) (map[string]any, error) {
	anonymous := viewer == nil
	lot, err := tx.GetLot(ctx, lotID)
	if err != nil || lot == nil {
		return nil, err
	}
	if anonymous {
		if !lotAnonymousVisible(lot) {
			return nil, nil
		}
	} else if !storeLotAccess(*viewer, lot) {
		return nil, nil
	}
	bids, err := tx.LotBids(ctx, lotID)
	if err != nil {
		return nil, err
	}
	lf := store.LotFull{Lot: *lot, Bids: bids}
	lf.Refresh()
	var view map[string]any
	if anonymous {
		view = f.server.db.PublicLotView(lf, now)
	} else {
		v, err := f.server.db.ViewerLotView(ctx, tx, *viewer, &lf, nil, now)
		if err != nil {
			return nil, err
		}
		view = v
	}
	var history []map[string]any
	if anonymous {
		history = f.server.db.PublicHistory(lf)
	} else {
		history = f.server.db.HistoryFor(lf, *viewer, lot)
	}
	return map[string]any{"type": "lot_changed", "cause": cause, "lot": view, "history": history}, nil
}

// lotAnonymousVisible keeps unestimated and draft-sale lots off public frames.
func lotAnonymousVisible(lot *store.Lot) bool {
	switch lot.State {
	case "intake", "estimated", "placed":
		return false
	default:
		return true
	}
}

// storeLotAccess mirrors store's access rule for the feed.
func storeLotAccess(viewer store.Person, lot *store.Lot) bool {
	return store.LotAccess(viewer, lot)
}
