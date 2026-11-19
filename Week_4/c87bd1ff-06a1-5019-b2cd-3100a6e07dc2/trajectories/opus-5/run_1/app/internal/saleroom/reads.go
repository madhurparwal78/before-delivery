package saleroom

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"gavelhouse/internal/domain"
)

// saleRow is a sale as the catalogue shows it.
type saleRow struct {
	ID             string
	Title          string
	EndsAt         time.Time
	State          string
	FirstLotNumber int
}

func (s saleRow) project() map[string]any {
	return map[string]any{
		"id":               s.ID,
		"title":            s.Title,
		"ends_at":          s.EndsAt.UTC().Format(time.RFC3339),
		"state":            s.State,
		"first_lot_number": s.FirstLotNumber,
	}
}

const saleColumns = `id, title, ends_at, state, first_lot_number`

func scanSale(row pgx.Row) (saleRow, error) {
	var s saleRow
	err := row.Scan(&s.ID, &s.Title, &s.EndsAt, &s.State, &s.FirstLotNumber)
	if errors.Is(err, pgx.ErrNoRows) {
		return s, ErrNotFound
	}
	if err != nil {
		return s, fmt.Errorf("scan sale: %w", err)
	}
	return s, nil
}

// currentSale is the open sale with the earliest last close, or, if none is
// open, the most recently closed sale.
func currentSale(ctx context.Context, tx pgx.Tx) (saleRow, error) {
	s, err := scanSale(tx.QueryRow(ctx,
		`SELECT `+saleColumns+` FROM sales WHERE state = 'open'
		  ORDER BY (SELECT max(closes_at) FROM lots WHERE sale_id = sales.id) LIMIT 1`))
	if err == nil || !errors.Is(err, ErrNotFound) {
		return s, err
	}
	return scanSale(tx.QueryRow(ctx,
		`SELECT `+saleColumns+` FROM sales WHERE state = 'closed'
		  ORDER BY closed_at DESC LIMIT 1`))
}

// CurrentSale answers the catalogue's question of which sale is on.
func (s *Saleroom) CurrentSale(ctx context.Context) (map[string]any, error) {
	var out map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		serverNow, err := now(ctx, tx)
		if err != nil {
			return err
		}
		if err := s.settle(ctx, tx, serverNow); err != nil {
			return err
		}
		sale, err := currentSale(ctx, tx)
		if err != nil {
			return err
		}
		out = sale.project()
		return nil
	})
	return out, err
}

// Catalogue reads a whole sale in catalogue-grid order: open lots first,
// soonest-closing first, then closed lots in lot-number order. It arrives
// complete, with the sequence number the page's socket resumes from.
func (s *Saleroom) Catalogue(ctx context.Context, v Viewer, saleID string) (map[string]any, error) {
	var out map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		serverNow, err := now(ctx, tx)
		if err != nil {
			return err
		}
		if err := s.settle(ctx, tx, serverNow); err != nil {
			return err
		}
		var sale saleRow
		if saleID == "" {
			sale, err = currentSale(ctx, tx)
		} else {
			sale, err = scanSale(tx.QueryRow(ctx, `SELECT `+saleColumns+` FROM sales WHERE id = $1`, saleID))
		}
		if err != nil {
			return err
		}
		if sale.State == domain.SaleDraft && !v.HasRole["specialist"] {
			return ErrNotFound
		}
		lots, err := loadLots(ctx, tx,
			`WHERE l.sale_id = $1
			  ORDER BY (l.state NOT IN ('open','extended')), l.closes_at, l.lot_number`, sale.ID)
		if err != nil {
			return err
		}
		projected := make([]map[string]any, 0, len(lots))
		histories := map[string][]map[string]any{}
		for _, l := range lots {
			bids, err := loadBids(ctx, tx, l.ID)
			if err != nil {
				return err
			}
			st := standing(l, bids)
			shown, err := s.project(ctx, tx, l, st, bids, v, serverNow)
			if err != nil {
				return err
			}
			projected = append(projected, shown)
			histories[l.ID] = s.history(l, bids, v)
		}
		seq, err := latestSeqTx(ctx, tx)
		if err != nil {
			return err
		}
		out = map[string]any{"sale": sale.project(), "lots": projected, "histories": histories, "seq": seq}
		return nil
	})
	return out, err
}

// Lot reads one lot with its complete bid history and the resume sequence.
func (s *Saleroom) Lot(ctx context.Context, v Viewer, lotID string) (map[string]any, error) {
	var out map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		serverNow, err := now(ctx, tx)
		if err != nil {
			return err
		}
		if err := s.settle(ctx, tx, serverNow); err != nil {
			return err
		}
		l, err := visibleLot(ctx, tx, lotID, v)
		if err != nil {
			return err
		}
		bids, err := loadBids(ctx, tx, l.ID)
		if err != nil {
			return err
		}
		st := standing(l, bids)
		seq, err := latestSeqTx(ctx, tx)
		if err != nil {
			return err
		}
		shown, err := s.project(ctx, tx, l, st, bids, v, serverNow)
		if err != nil {
			return err
		}
		out = map[string]any{"lot": shown, "history": s.history(l, bids, v), "seq": seq}
		return nil
	})
	return out, err
}

// project chooses the viewer's lot projection: the consignor's own lots carry
// no bidder detail, a bidder sees their own maximum, and everyone else sees
// the public keys.
func (s *Saleroom) project(ctx context.Context, tx pgx.Tx, l lotRow, st domain.Standing,
	bids []bidRow, v Viewer, serverNow time.Time) (map[string]any, error) {
	if v.SignedIn && l.ConsignorID == v.PersonID {
		offer, err := openOfferFor(ctx, tx, l)
		if err != nil {
			return nil, err
		}
		return consignorLot(l, st, serverNow, offer), nil
	}
	if v.IsBidder() {
		watching, err := isWatching(ctx, tx, l.ID, v.PersonID)
		if err != nil {
			return nil, err
		}
		return bidderLot(l, st, bids, serverNow, v.PersonID, watching), nil
	}
	return publicLot(l, st, serverNow), nil
}

func (s *Saleroom) history(l lotRow, bids []bidRow, v Viewer) []map[string]any {
	if v.SignedIn && l.ConsignorID == v.PersonID {
		return consignorHistory(bids)
	}
	return publicHistory(bids)
}

// offerRecord is a second-chance or default offer.
type offerRecord struct {
	ID        string
	LotID     string
	LotNumber int
	Title     string
	PersonID  string
	Kind      string
	Amount    int
	ExpiresAt time.Time
	Status    string
}

func (o offerRecord) project() map[string]any {
	return map[string]any{
		"id":         o.ID,
		"lot_id":     o.LotID,
		"lot_number": o.LotNumber,
		"title":      o.Title,
		"kind":       o.Kind,
		"amount":     o.Amount,
		"expires_at": o.ExpiresAt.UTC().Format(time.RFC3339),
		"status":     o.Status,
	}
}

const offerSelect = `SELECT o.id, o.lot_id, coalesce(l.lot_number, 0), l.title, o.person_id,
	o.kind, o.amount, o.expires_at, o.status
	FROM offers o JOIN lots l ON l.id = o.lot_id`

func scanOffers(rows pgx.Rows) ([]offerRecord, error) {
	defer rows.Close()
	var out []offerRecord
	for rows.Next() {
		var o offerRecord
		if err := rows.Scan(&o.ID, &o.LotID, &o.LotNumber, &o.Title, &o.PersonID,
			&o.Kind, &o.Amount, &o.ExpiresAt, &o.Status); err != nil {
			return nil, fmt.Errorf("scan offer: %w", err)
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func openOfferFor(ctx context.Context, tx pgx.Tx, l lotRow) (map[string]any, error) {
	rows, err := tx.Query(ctx, offerSelect+` WHERE o.lot_id = $1 ORDER BY o.created_at DESC LIMIT 1`, l.ID)
	if err != nil {
		return nil, fmt.Errorf("query offer on lot %s: %w", l.ID, err)
	}
	offers, err := scanOffers(rows)
	if err != nil || len(offers) == 0 {
		return nil, err
	}
	return offers[0].project(), nil
}

// Notices lists one person's notices, newest first.
func (s *Saleroom) Notices(ctx context.Context, v Viewer) (map[string]any, error) {
	var out map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		notices, err := loadNotices(ctx, tx, v.PersonID)
		if err != nil {
			return err
		}
		seq, err := latestSeqTx(ctx, tx)
		if err != nil {
			return err
		}
		out = map[string]any{"notices": notices, "seq": seq}
		return nil
	})
	return out, err
}

func loadNotices(ctx context.Context, tx pgx.Tx, personID string) ([]map[string]any, error) {
	rows, err := tx.Query(ctx,
		`SELECT id, kind, body, lot_id, created_at FROM notices
		  WHERE person_id = $1 ORDER BY created_at DESC, id DESC LIMIT 200`, personID)
	if err != nil {
		return nil, fmt.Errorf("query notices: %w", err)
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, kind, body string
		var lotID *string
		var createdAt time.Time
		if err := rows.Scan(&id, &kind, &body, &lotID, &createdAt); err != nil {
			return nil, fmt.Errorf("scan notice: %w", err)
		}
		out = append(out, map[string]any{
			"id":         id,
			"kind":       kind,
			"text":       body,
			"lot_id":     strOrNil(lotID),
			"created_at": createdAt.UTC().Format(time.RFC3339),
		})
	}
	return out, rows.Err()
}

// Notice reads one notice for a socket frame.
func (s *Saleroom) Notice(ctx context.Context, id string) (map[string]any, error) {
	var kind, body string
	var lotID *string
	var createdAt time.Time
	err := s.pool.QueryRow(ctx,
		`SELECT kind, body, lot_id, created_at FROM notices WHERE id = $1`, id).
		Scan(&kind, &body, &lotID, &createdAt)
	if err != nil {
		return nil, fmt.Errorf("read notice %s: %w", id, err)
	}
	return map[string]any{
		"id":         id,
		"kind":       kind,
		"text":       body,
		"lot_id":     strOrNil(lotID),
		"created_at": createdAt.UTC().Format(time.RFC3339),
	}, nil
}

// LotFrame projects one lot for a socket frame in the viewer's projection.
func (s *Saleroom) LotFrame(ctx context.Context, v Viewer, lotID string) (map[string]any, []map[string]any, error) {
	var lot map[string]any
	var history []map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		serverNow, err := now(ctx, tx)
		if err != nil {
			return err
		}
		l, err := visibleLot(ctx, tx, lotID, v)
		if err != nil {
			return err
		}
		bids, err := loadBids(ctx, tx, l.ID)
		if err != nil {
			return err
		}
		st := standing(l, bids)
		shown, err := s.project(ctx, tx, l, st, bids, v, serverNow)
		if err != nil {
			return err
		}
		lot = shown
		history = s.history(l, bids, v)
		return nil
	})
	return lot, history, err
}
