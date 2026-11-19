package saleroom

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"gavelhouse/internal/domain"
)

// Registration is a person's standing in the saleroom.
type Registration struct {
	ID            string
	Role          string
	Status        string
	Paddle        *int
	SpendingLimit *int
	FullName      string
	Phone         string
	Address       string
	CreatedAt     time.Time
}

func (r Registration) project() map[string]any {
	return map[string]any{
		"id":             r.ID,
		"role":           r.Role,
		"status":         r.Status,
		"paddle":         intPtrOrNil(r.Paddle),
		"spending_limit": intPtrOrNil(r.SpendingLimit),
	}
}

// Register records a person's registration to bid or consign. A bidder starts
// pending approval; a consignor is active at once.
func (s *Saleroom) Register(ctx context.Context, v Viewer, role, fullName, phone, address string) (map[string]any, error) {
	var out map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		status := "active"
		if role == "bidder" {
			status = "pending"
		}
		id := newID()
		var claimed int
		err := tx.QueryRow(ctx,
			`INSERT INTO registrations (id, person_id, role, status, full_name, phone, address)
			 VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (person_id) DO NOTHING RETURNING 1`,
			id, v.PersonID, role, status, fullName, phone, address).Scan(&claimed)
		if errors.Is(err, pgx.ErrNoRows) {
			return conflict("already_registered", "You are already registered in this saleroom.")
		}
		if err != nil {
			return fmt.Errorf("insert registration: %w", err)
		}
		landing := "/consign"
		if role == "bidder" {
			landing = "/bidder"
		}
		out = map[string]any{
			"registration": Registration{ID: id, Role: role, Status: status}.project(),
			"landing":      landing,
		}
		return nil
	})
	return out, err
}

// LoadRegistration reads a person's registration, if they have one.
func (s *Saleroom) LoadRegistration(ctx context.Context, personID string) (*Registration, error) {
	r := &Registration{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, role, status, paddle, spending_limit, full_name, phone, address, created_at
		   FROM registrations WHERE person_id = $1`, personID).Scan(
		&r.ID, &r.Role, &r.Status, &r.Paddle, &r.SpendingLimit, &r.FullName, &r.Phone, &r.Address, &r.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read registration: %w", err)
	}
	return r, nil
}

// Dashboard reads everything the bidder's saleroom shows.
func (s *Saleroom) Dashboard(ctx context.Context, v Viewer) (map[string]any, error) {
	var out map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		serverNow, err := now(ctx, tx)
		if err != nil {
			return err
		}
		if err := s.settle(ctx, tx, serverNow); err != nil {
			return err
		}
		leading := []map[string]any{}
		open, err := loadLots(ctx, tx,
			`WHERE l.state IN ('open','extended')
			   AND EXISTS(SELECT 1 FROM bids b WHERE b.lot_id = l.id
			        AND b.bidder_id = $1 AND b.removed_at IS NULL)
			 ORDER BY l.closes_at`, v.PersonID)
		if err != nil {
			return err
		}
		committed := 0
		for _, l := range open {
			bids, err := loadBids(ctx, tx, l.ID)
			if err != nil {
				return err
			}
			st := standing(l, bids)
			if st.HasLeader && st.LeaderID == v.PersonID {
				committed += st.LeaderMax
				watching, err := isWatching(ctx, tx, l.ID, v.PersonID)
				if err != nil {
					return err
				}
				leading = append(leading, bidderLot(l, st, bids, serverNow, v.PersonID, watching))
			}
		}

		watched, err := s.bidderLots(ctx, tx, v, serverNow,
			`WHERE EXISTS(SELECT 1 FROM watches w WHERE w.lot_id = l.id AND w.person_id = $1)
			  ORDER BY l.closes_at, l.lot_number`)
		if err != nil {
			return err
		}
		won, err := s.wonLots(ctx, tx, v, serverNow)
		if err != nil {
			return err
		}
		rows, err := tx.Query(ctx, offerSelect+
			` WHERE o.person_id = $1 AND o.status = 'open' ORDER BY o.expires_at`, v.PersonID)
		if err != nil {
			return fmt.Errorf("query the bidder's offers: %w", err)
		}
		offers, err := scanOffers(rows)
		if err != nil {
			return err
		}
		projectedOffers := make([]map[string]any, 0, len(offers))
		for _, o := range offers {
			projectedOffers = append(projectedOffers, o.project())
		}
		invoices, err := loadInvoices(ctx, tx,
			`WHERE i.person_id = $1 ORDER BY i.issued_at DESC`, v.PersonID)
		if err != nil {
			return err
		}
		projectedInvoices := make([]map[string]any, 0, len(invoices))
		for _, inv := range invoices {
			projectedInvoices = append(projectedInvoices, inv.project(false))
		}
		seq, err := latestSeqTx(ctx, tx)
		if err != nil {
			return err
		}
		out = map[string]any{
			"paddle":         intPtrOrNil(v.Paddle),
			"status":         v.RegStatus,
			"spending_limit": intPtrOrNil(v.SpendLimit),
			"committed":      committed,
			"leading":        leading,
			"watching":       watched,
			"won":            won,
			"offers":         projectedOffers,
			"invoices":       projectedInvoices,
			"seq":            seq,
		}
		return nil
	})
	return out, err
}

func (s *Saleroom) bidderLots(ctx context.Context, tx pgx.Tx, v Viewer, serverNow time.Time,
	where string) ([]map[string]any, error) {
	lots, err := loadLots(ctx, tx, where, v.PersonID)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(lots))
	for _, l := range lots {
		bids, err := loadBids(ctx, tx, l.ID)
		if err != nil {
			return nil, err
		}
		st := standing(l, bids)
		watching, err := isWatching(ctx, tx, l.ID, v.PersonID)
		if err != nil {
			return nil, err
		}
		out = append(out, bidderLot(l, st, bids, serverNow, v.PersonID, watching))
	}
	return out, nil
}

// wonLots lists the lots the bidder took, by hammer or by accepting an offer.
func (s *Saleroom) wonLots(ctx context.Context, tx pgx.Tx, v Viewer, serverNow time.Time) ([]map[string]any, error) {
	lots, err := loadLots(ctx, tx,
		`WHERE l.state IN ('closed_sold','invoiced','paid','defaulted','sold_by_offer')
		   AND (EXISTS(SELECT 1 FROM bids b WHERE b.lot_id = l.id
		          AND b.bidder_id = $1 AND b.removed_at IS NULL)
		     OR EXISTS(SELECT 1 FROM offers o WHERE o.lot_id = l.id
		          AND o.person_id = $1 AND o.status = 'accepted'))
		 ORDER BY l.lot_number`, v.PersonID)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(lots))
	for _, l := range lots {
		mine, err := s.lotWonBy(ctx, tx, l, v.PersonID)
		if err != nil {
			return nil, err
		}
		if !mine {
			continue
		}
		bids, err := loadBids(ctx, tx, l.ID)
		if err != nil {
			return nil, err
		}
		st := standing(l, bids)
		watching, err := isWatching(ctx, tx, l.ID, v.PersonID)
		if err != nil {
			return nil, err
		}
		out = append(out, bidderLot(l, st, bids, serverNow, v.PersonID, watching))
	}
	return out, nil
}

func (s *Saleroom) lotWonBy(ctx context.Context, tx pgx.Tx, l lotRow, personID string) (bool, error) {
	if l.State == domain.LotSoldByOffer {
		var mine bool
		err := tx.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM offers WHERE lot_id = $1 AND person_id = $2
			          AND status = 'accepted')`, l.ID, personID).Scan(&mine)
		if err != nil {
			return false, fmt.Errorf("read accepted offer on lot %s: %w", l.ID, err)
		}
		return mine, nil
	}
	if !l.SoldAtHammer {
		return false, nil
	}
	bids, err := loadBids(ctx, tx, l.ID)
	if err != nil {
		return false, err
	}
	st := standing(l, bids)
	return st.HasLeader && st.LeaderID == personID, nil
}

// Invoice reads one invoice for the bidder who owes it.
func (s *Saleroom) Invoice(ctx context.Context, v Viewer, invoiceID string) (map[string]any, error) {
	var out map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		serverNow, err := now(ctx, tx)
		if err != nil {
			return err
		}
		if err := s.settle(ctx, tx, serverNow); err != nil {
			return err
		}
		invoices, err := loadInvoices(ctx, tx, `WHERE i.id = $1 AND i.person_id = $2`, invoiceID, v.PersonID)
		if err != nil {
			return err
		}
		if len(invoices) == 0 {
			return ErrNotFound
		}
		out = map[string]any{"invoice": invoices[0].project(false)}
		return nil
	})
	return out, err
}

// AnswerOffer accepts or declines one of the bidder's open offers. It is
// decided once, so two accepts sent together succeed exactly once.
func (s *Saleroom) AnswerOffer(ctx context.Context, v Viewer, offerID string, accept bool) (map[string]any, error) {
	var out map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		serverNow, err := now(ctx, tx)
		if err != nil {
			return err
		}
		var o offerRecord
		err = tx.QueryRow(ctx,
			`SELECT id, lot_id, person_id, kind, amount, expires_at, status FROM offers
			  WHERE id = $1 FOR UPDATE`, offerID).Scan(
			&o.ID, &o.LotID, &o.PersonID, &o.Kind, &o.Amount, &o.ExpiresAt, &o.Status)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("read offer %s: %w", offerID, err)
		}
		if o.PersonID != v.PersonID {
			return ErrNotFound
		}
		if !serverNow.Before(o.ExpiresAt) {
			if err := s.settle(ctx, tx, serverNow); err != nil {
				return err
			}
			return conflict("offer_expired", "This offer has expired.")
		}
		if o.Status != domain.OfferOpen {
			return conflict("offer_closed", "This offer has already been answered.")
		}
		l, err := loadLot(ctx, tx, o.LotID)
		if err != nil {
			return err
		}
		o.LotNumber = intOr(l.LotNumber, 0)
		o.Title = l.Title
		if !accept {
			if _, err := tx.Exec(ctx,
				`UPDATE offers SET status = $2, answered_at = $3 WHERE id = $1`,
				o.ID, domain.OfferDeclined, serverNow); err != nil {
				return fmt.Errorf("decline offer %s: %w", o.ID, err)
			}
			if err := lapseLot(ctx, tx, o.LotID, serverNow); err != nil {
				return err
			}
			o.Status = domain.OfferDeclined
			out = map[string]any{"offer": o.project()}
			return nil
		}
		if _, err := tx.Exec(ctx,
			`UPDATE offers SET status = $2, answered_at = $3 WHERE id = $1`,
			o.ID, domain.OfferAccepted, serverNow); err != nil {
			return fmt.Errorf("accept offer %s: %w", o.ID, err)
		}
		if _, err := tx.Exec(ctx,
			`UPDATE lots SET state = $2, hammer = $3 WHERE id = $1`,
			o.LotID, domain.LotSoldByOffer, o.Amount); err != nil {
			return fmt.Errorf("sell lot %s by offer: %w", o.LotID, err)
		}
		source := domain.SourceSecondChance
		if o.Kind == domain.OfferDefault {
			source = domain.SourceDefaultOffer
		}
		line := lineFor(o.LotID, o.LotNumber, o.Title, source, o.Amount)
		dueAt := serverNow.Add(s.cfg.PaymentDue)
		invoiceID, _, _, err := issueInvoice(ctx, tx, strOr(l.SaleID, ""), v.PersonID,
			[]invoiceLine{line}, serverNow, dueAt)
		if err != nil {
			return err
		}
		body := domain.NoticeOfferAcceptedText(o.LotNumber, o.Amount)
		if err := addNotice(ctx, tx, l.ConsignorID, domain.NoticeOfferAccepted, body, o.LotID, serverNow); err != nil {
			return err
		}
		if err := recordLotChange(ctx, tx, CauseOffer, o.LotID); err != nil {
			return err
		}
		invoices, err := loadInvoices(ctx, tx, `WHERE i.id = $1`, invoiceID)
		if err != nil {
			return err
		}
		o.Status = domain.OfferAccepted
		out = map[string]any{"offer": o.project(), "invoice": invoices[0].project(false)}
		return nil
	})
	return out, err
}

// ConsignLot takes in a watch or camera for estimate.
func (s *Saleroom) ConsignLot(ctx context.Context, v Viewer, category, title, description string) (map[string]any, error) {
	var out map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		serverNow, err := now(ctx, tx)
		if err != nil {
			return err
		}
		id := newID()
		_, err = tx.Exec(ctx,
			`INSERT INTO lots (id, consignor_id, title, category, description, state)
			 VALUES ($1,$2,$3,$4,$5,$6)`,
			id, v.PersonID, title, category, description, domain.LotIntake)
		if err != nil {
			return fmt.Errorf("insert consigned lot: %w", err)
		}
		l, err := loadLot(ctx, tx, id)
		if err != nil {
			return err
		}
		st := standing(l, nil)
		out = map[string]any{"lot": consignorLot(l, st, serverNow, nil), "landing": "/consign"}
		return nil
	})
	return out, err
}

// ConsignorLots lists the consignor's own lots, newest intake first and then
// the sale's lots in catalogue order.
func (s *Saleroom) ConsignorLots(ctx context.Context, v Viewer) (map[string]any, error) {
	var out map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		serverNow, err := now(ctx, tx)
		if err != nil {
			return err
		}
		if err := s.settle(ctx, tx, serverNow); err != nil {
			return err
		}
		lots, err := loadLots(ctx, tx,
			`WHERE l.consignor_id = $1 ORDER BY l.lot_number NULLS LAST, l.created_at`, v.PersonID)
		if err != nil {
			return err
		}
		projected := make([]map[string]any, 0, len(lots))
		for _, l := range lots {
			bids, err := loadBids(ctx, tx, l.ID)
			if err != nil {
				return err
			}
			offer, err := openOfferFor(ctx, tx, l)
			if err != nil {
				return err
			}
			projected = append(projected, consignorLot(l, standing(l, bids), serverNow, offer))
		}
		seq, err := latestSeqTx(ctx, tx)
		if err != nil {
			return err
		}
		out = map[string]any{"lots": projected, "seq": seq}
		return nil
	})
	return out, err
}

// ConsignorLot reads one of the consignor's own lots with its anonymous
// history.
func (s *Saleroom) ConsignorLot(ctx context.Context, v Viewer, lotID string) (map[string]any, error) {
	var out map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		serverNow, err := now(ctx, tx)
		if err != nil {
			return err
		}
		if err := s.settle(ctx, tx, serverNow); err != nil {
			return err
		}
		l, err := loadLot(ctx, tx, lotID)
		if err != nil {
			return err
		}
		if l.ConsignorID != v.PersonID {
			return ErrNotFound
		}
		bids, err := loadBids(ctx, tx, l.ID)
		if err != nil {
			return err
		}
		offer, err := openOfferFor(ctx, tx, l)
		if err != nil {
			return err
		}
		seq, err := latestSeqTx(ctx, tx)
		if err != nil {
			return err
		}
		out = map[string]any{
			"lot":     consignorLot(l, standing(l, bids), serverNow, offer),
			"history": consignorHistory(bids),
			"seq":     seq,
		}
		return nil
	})
	return out, err
}

// SecondChance offers an unsold lot to its top bidder, once, at an amount
// from the final price up to that bidder's maximum.
func (s *Saleroom) SecondChance(ctx context.Context, v Viewer, lotID string, amount *int) (map[string]any, error) {
	var out map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		serverNow, err := now(ctx, tx)
		if err != nil {
			return err
		}
		if err := s.settle(ctx, tx, serverNow); err != nil {
			return err
		}
		l, err := loadLot(ctx, tx, lotID)
		if err != nil {
			return err
		}
		if l.ConsignorID != v.PersonID {
			return ErrNotFound
		}
		bids, err := loadBids(ctx, tx, l.ID)
		if err != nil {
			return err
		}
		st := standing(l, bids)
		if !secondChanceOpen(l, st) {
			return conflict("invalid_transition", "The second-chance choice is not open on this lot.")
		}
		if amount == nil || *amount < 1 {
			return invalidField("amount", domain.MsgNotWholeEuros)
		}
		if *amount < st.Price {
			return invalidField("amount", domain.MsgOfferBelowFinal(st.Price))
		}
		if *amount > st.LeaderMax {
			return invalidField("amount", domain.MsgOfferAboveTopBid)
		}
		expiresAt := serverNow.Add(s.cfg.OfferWindow)
		if err := insertOffer(ctx, tx, l.ID, st.LeaderID, domain.OfferSecondChance,
			*amount, expiresAt, serverNow); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx,
			`UPDATE lots SET state = $2, second_chance_decided = true WHERE id = $1`,
			l.ID, domain.LotSecondChanceOffer); err != nil {
			return fmt.Errorf("offer lot %s a second chance: %w", l.ID, err)
		}
		lotNumber := intOr(l.LotNumber, 0)
		body := domain.NoticeSecondChanceText(lotNumber, *amount, expiresAt)
		if err := addNotice(ctx, tx, st.LeaderID, domain.NoticeSecondChance, body, l.ID, serverNow); err != nil {
			return err
		}
		if err := recordLotChange(ctx, tx, CauseOffer, l.ID); err != nil {
			return err
		}
		l, err = loadLot(ctx, tx, l.ID)
		if err != nil {
			return err
		}
		offer, err := openOfferFor(ctx, tx, l)
		if err != nil {
			return err
		}
		out = map[string]any{"offer": offer}
		return nil
	})
	return out, err
}

// LeaveUnsold records the consignor's decision not to offer the lot and
// closes the second-chance choice without changing the lot's state.
func (s *Saleroom) LeaveUnsold(ctx context.Context, v Viewer, lotID string) (map[string]any, error) {
	var out map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		serverNow, err := now(ctx, tx)
		if err != nil {
			return err
		}
		if err := s.settle(ctx, tx, serverNow); err != nil {
			return err
		}
		l, err := loadLot(ctx, tx, lotID)
		if err != nil {
			return err
		}
		if l.ConsignorID != v.PersonID {
			return ErrNotFound
		}
		bids, err := loadBids(ctx, tx, l.ID)
		if err != nil {
			return err
		}
		if !secondChanceOpen(l, standing(l, bids)) {
			return conflict("invalid_transition", "The second-chance choice is not open on this lot.")
		}
		if _, err := tx.Exec(ctx,
			`UPDATE lots SET second_chance_decided = true WHERE id = $1`, l.ID); err != nil {
			return fmt.Errorf("leave lot %s unsold: %w", l.ID, err)
		}
		if err := recordLotChange(ctx, tx, CauseOffer, l.ID); err != nil {
			return err
		}
		l, err = loadLot(ctx, tx, l.ID)
		if err != nil {
			return err
		}
		out = map[string]any{"lot": consignorLot(l, standing(l, bids), serverNow, nil)}
		return nil
	})
	return out, err
}

// ConsignorStatements lists the consignor's issued and superseded statements.
func (s *Saleroom) ConsignorStatements(ctx context.Context, v Viewer) ([]map[string]any, error) {
	var out []map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		statements, err := loadStatements(ctx, tx,
			`WHERE st.consignor_id = $1 AND st.status <> 'draft'
			  ORDER BY st.created_at DESC`, v.PersonID)
		if err != nil {
			return err
		}
		out = make([]map[string]any, 0, len(statements))
		for _, st := range statements {
			out = append(out, st.project())
		}
		return nil
	})
	return out, err
}

// ConsignorStatement reads one of the consignor's statements. A draft is
// unknown to them.
func (s *Saleroom) ConsignorStatement(ctx context.Context, v Viewer, id string) (map[string]any, error) {
	var out map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		statements, err := loadStatements(ctx, tx,
			`WHERE st.id = $1 AND st.consignor_id = $2 AND st.status <> 'draft'`, id, v.PersonID)
		if err != nil {
			return err
		}
		if len(statements) == 0 {
			return ErrNotFound
		}
		out = map[string]any{"statement": statements[0].project()}
		return nil
	})
	return out, err
}
