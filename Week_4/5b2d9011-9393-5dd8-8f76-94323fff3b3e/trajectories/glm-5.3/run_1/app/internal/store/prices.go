package store

import (
	"context"
	"database/sql"
	"time"
)

// PriceChange is one schedule row.
type PriceChange struct {
	ID            string
	Item          string
	Price         int
	EffectiveLocal string
	EffectiveAt   time.Time
}

// PriceChanges lists the whole schedule.
func (s *Store) PriceChanges(ctx context.Context) ([]PriceChange, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT id, item, price, effective_local, effective_at FROM price_changes ORDER BY effective_at, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PriceChange
	for rows.Next() {
		var pc PriceChange
		if err := rows.Scan(&pc.ID, &pc.Item, &pc.Price, &pc.EffectiveLocal, &pc.EffectiveAt); err != nil {
			return nil, err
		}
		out = append(out, pc)
	}
	return out, rows.Err()
}

// CreatePriceChange stores a schedule row. ErrPriceExists marks a duplicate
// item and instant.
func (s *Store) CreatePriceChange(ctx context.Context, id, item string, price int, effectiveLocal string, effectiveAt time.Time) (PriceChange, error) {
	_, err := s.DB.ExecContext(ctx,
		`INSERT INTO price_changes (id, item, price, effective_local, effective_at)
		 VALUES ($1,$2,$3,$4,$5)`, id, item, price, effectiveLocal, effectiveAt)
	if err != nil {
		if isUniqueErr(err, "price_item_at_idx") {
			return PriceChange{}, ErrPriceExists
		}
		return PriceChange{}, err
	}
	return PriceChange{ID: id, Item: item, Price: price, EffectiveLocal: effectiveLocal, EffectiveAt: effectiveAt}, nil
}

// ErrPriceExists marks a duplicate schedule row.
var ErrPriceExists = errPriceExists{}

type errPriceExists struct{}

func (errPriceExists) Error() string { return "store: price change exists" }

// PriceChangeByID loads one row.
func (s *Store) PriceChangeByID(ctx context.Context, id string) (PriceChange, bool, error) {
	var pc PriceChange
	err := s.DB.QueryRowContext(ctx,
		`SELECT id, item, price, effective_local, effective_at FROM price_changes WHERE id=$1`, id).
		Scan(&pc.ID, &pc.Item, &pc.Price, &pc.EffectiveLocal, &pc.EffectiveAt)
	if err == sql.ErrNoRows {
		return pc, false, nil
	}
	return pc, true, err
}

// DeletePriceChange removes a pending row.
func (s *Store) DeletePriceChange(ctx context.Context, id string) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM price_changes WHERE id=$1`, id)
	return err
}

func isUniqueErr(err error, constraint string) bool {
	return err != nil && containsStr(err.Error(), constraint)
}

func containsStr(hay, needle string) bool {
	return len(hay) >= len(needle) && (func() bool {
		for i := 0; i+len(needle) <= len(hay); i++ {
			if hay[i:i+len(needle)] == needle {
				return true
			}
		}
		return false
	})()
}
