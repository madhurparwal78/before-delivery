package store

import (
	"context"
	"fmt"
)

// Read methods run inside one transaction and close any due lots first.

// CurrentSale returns the open sale with the earliest last close, or the most
// recently closed sale.
func (s *Store) CurrentSale(ctx context.Context) (*Sale, error) {
	var sale *Sale
	err := s.db.WithTx(ctx, func(ctx context.Context, tx Tx) error {
		if err := s.closeDueLots(ctx, tx); err != nil {
			return err
		}
		sale, _ = tx.CurrentSale(ctx)
		return nil
	})
	return sale, err
}

// Catalogue returns a sale's lots in closing order, with the feed sequence the
// response already reflects.
func (s *Store) Catalogue(ctx context.Context, viewer Person, saleID string) (Sale, []LotFull, []map[string]any, int64, error) {
	var sale Sale
	var lots []LotFull
	var views []map[string]any
	var seq int64
	err := s.db.WithTx(ctx, func(ctx context.Context, tx Tx) error {
		now, err := tx.Now(ctx)
		if err != nil {
			return fmt.Errorf("reading the clock: %w", err)
		}
		if err := s.closeDueLots(ctx, tx); err != nil {
			return err
		}
		sl, err := tx.GetSale(ctx, saleID)
		if err != nil {
			return fmt.Errorf("reading the sale: %w", err)
		}
		if sl == nil {
			return NotFound()
		}
		sale = *sl
		lotRows, err := tx.SaleLots(ctx, saleID)
		if err != nil {
			return fmt.Errorf("reading the sale's lots: %w", err)
		}
		lots = make([]LotFull, 0, len(lotRows))
		for i := range lotRows {
			lf, err := s.loadLotFull(ctx, tx, lotRows[i].ID)
			if err != nil {
				return err
			}
			lots = append(lots, *lf)
		}
		sortLotsByClosingOrder(lots)
		views = make([]map[string]any, 0, len(lots))
		for i := range lots {
			if !lotAccess(viewer, &lots[i].Lot) {
				continue
			}
			v, err := s.viewerLotView(ctx, tx, viewer, &lots[i], nil, now)
			if err != nil {
				return err
			}
			views = append(views, v)
		}
		seq, err = tx.LatestSeq(ctx)
		if err != nil {
			return fmt.Errorf("reading the feed: %w", err)
		}
		return nil
	})
	return sale, lots, views, seq, err
}

// LotWithHistory returns one lot and its bid history.
func (s *Store) LotWithHistory(ctx context.Context, viewer Person, lotID string) (map[string]any, []map[string]any, int64, error) {
	var view map[string]any
	var history []map[string]any
	var seq int64
	err := s.db.WithTx(ctx, func(ctx context.Context, tx Tx) error {
		now, err := tx.Now(ctx)
		if err != nil {
			return fmt.Errorf("reading the clock: %w", err)
		}
		if err := s.closeDueLots(ctx, tx); err != nil {
			return err
		}
		lf, err := s.loadLotFull(ctx, tx, lotID)
		if err != nil {
			return err
		}
		if lf == nil || !lotAccess(viewer, &lf.Lot) {
			return NotFound()
		}
		audience := "public"
		if isStaff(viewer.Roles) {
			audience = "admin"
		} else if hasRole(viewer.Roles, "consignor") && lf.ConsignorID == viewer.ID {
			audience = "consignor"
		} else if hasRole(viewer.Roles, "bidder") {
			audience = "bidder"
		}
		var offer *Offer
		if audience == "consignor" || isStaff(viewer.Roles) {
			o, err := tx.OpenOfferForLot(ctx, lotID)
			if err != nil {
				return fmt.Errorf("reading the offer: %w", err)
			}
			offer = o
		}
		view, err = s.viewerLotView(ctx, tx, viewer, lf, offer, now)
		if err != nil {
			return err
		}
		history = historyView(lf.Bids, audience)
		seq, err = tx.LatestSeq(ctx)
		if err != nil {
			return fmt.Errorf("reading the feed: %w", err)
		}
		return nil
	})
	return view, history, seq, err
}

// BidderDashboard assembles everything the bidder desk shows.
func (s *Store) BidderDashboard(ctx context.Context, viewer Person) (map[string]any, error) {
	var out map[string]any
	err := s.db.WithTx(ctx, func(ctx context.Context, tx Tx) error {
		now, err := tx.Now(ctx)
		if err != nil {
			return fmt.Errorf("reading the clock: %w", err)
		}
		if err := s.closeDueLots(ctx, tx); err != nil {
			return err
		}
		reg, err := tx.GetRegistrationByPerson(ctx, viewer.ID)
		if err != nil {
			return fmt.Errorf("reading the registration: %w", err)
		}
		if reg == nil || reg.Role != "bidder" {
			return Forbidden()
		}
		var leading, watching, won []map[string]any
		err = tx.ForEachLeadingLot(ctx, viewer.ID, func(lf *LotFull) error {
			v, err := s.viewerLotView(ctx, tx, viewer, lf, nil, now)
			if err != nil {
				return err
			}
			leading = append(leading, v)
			return nil
		})
		if err != nil {
			return err
		}
		watched, err := tx.WatchedLots(ctx, viewer.ID)
		if err != nil {
			return fmt.Errorf("reading the watched lots: %w", err)
		}
		for i := range watched {
			lf, err := s.loadLotFull(ctx, tx, watched[i].ID)
			if err != nil {
				return err
			}
			if lf == nil {
				continue
			}
			v, err := s.viewerLotView(ctx, tx, viewer, lf, nil, now)
			if err != nil {
				return err
			}
			watching = append(watching, v)
		}
		err = tx.ForEachWonLot(ctx, viewer.ID, func(lf *LotFull) error {
			v, err := s.viewerLotView(ctx, tx, viewer, lf, nil, now)
			if err != nil {
				return err
			}
			won = append(won, v)
			return nil
		})
		if err != nil {
			return err
		}
		offers, err := tx.PersonOffers(ctx, viewer.ID, true)
		if err != nil {
			return fmt.Errorf("reading the offers: %w", err)
		}
		offerViews := make([]map[string]any, 0, len(offers))
		for i := range offers {
			lf, err := s.loadLotFull(ctx, tx, offers[i].LotID)
			if err != nil {
				return err
			}
			offerViews = append(offerViews, s.offerView(&offers[i], lf))
		}
		invoices, err := tx.BidderInvoices(ctx, viewer.ID)
		if err != nil {
			return fmt.Errorf("reading the invoices: %w", err)
		}
		invoiceViews := make([]map[string]any, 0, len(invoices))
		for i := range invoices {
			invoiceViews = append(invoiceViews, invoiceView(invoices[i]))
		}
		committed, err := tx.Committed(ctx, viewer.ID)
		if err != nil {
			return fmt.Errorf("working out the committed amount: %w", err)
		}
		seq, err := tx.LatestSeq(ctx)
		if err != nil {
			return fmt.Errorf("reading the feed: %w", err)
		}
		limit := 0
		if reg.SpendingLimit != nil {
			limit = *reg.SpendingLimit
		}
		out = map[string]any{
			"paddle":         intOpt(reg.Paddle),
			"status":         reg.Status,
			"spending_limit": limit,
			"committed":      committed,
			"leading":        leading,
			"watching":       watching,
			"won":            won,
			"offers":         offerViews,
			"invoices":       invoiceViews,
			"seq":            seq,
		}
		return nil
	})
	return out, err
}

// closeDueLots carries out every close whose moment has passed, exactly once.
func (s *Store) closeDueLots(ctx context.Context, tx Tx) error {
	now, err := tx.Now(ctx)
	if err != nil {
		return fmt.Errorf("reading the clock: %w", err)
	}
	ids, err := tx.OpenLotsPastClose(ctx, now)
	if err != nil {
		return fmt.Errorf("finding due closes: %w", err)
	}
	for _, id := range ids {
		lf, err := s.loadLotFull(ctx, tx, id)
		if err != nil {
			return err
		}
		if lf == nil || !lf.IsOpenish() {
			continue
		}
		if err := s.closeLot(ctx, tx, lf, now); err != nil {
			return err
		}
	}
	return nil
}
