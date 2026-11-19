package store

import (
	"context"
	"time"
)

// PriceChange is one row of the ammo-station price schedule.
type PriceChange struct {
	ID             string
	Item           string
	Price          int
	EffectiveLocal string
	EffectiveAt    time.Time
}

// PriceSchedule reads the whole price schedule, oldest effective instant first.
func (s *Store) PriceSchedule(ctx context.Context) ([]PriceChange, error) {
	c, cancel, err := s.call(ctx)
	if err != nil {
		return nil, err
	}
	defer cancel()

	rows, err := s.pool.Query(c,
		`SELECT id, item, price, effective_local, effective_at FROM price_changes
		 ORDER BY effective_at ASC, item ASC`)
	if err != nil {
		return nil, s.down(c, err)
	}
	defer rows.Close()

	var out []PriceChange
	for rows.Next() {
		var pc PriceChange
		if err := rows.Scan(&pc.ID, &pc.Item, &pc.Price, &pc.EffectiveLocal, &pc.EffectiveAt); err != nil {
			return nil, s.down(c, err)
		}
		pc.EffectiveAt = pc.EffectiveAt.UTC()
		out = append(out, pc)
	}
	return out, s.down(c, rows.Err())
}

// ErrPriceChangeExists reports a row with the same item and instant.
var ErrPriceChangeExists = errPriceChangeExists{}

type errPriceChangeExists struct{}

func (errPriceChangeExists) Error() string { return "price change exists" }

// InsertPriceChange adds a schedule row.
func (s *Store) InsertPriceChange(ctx context.Context, pc PriceChange) (PriceChange, error) {
	c, cancel, err := s.call(ctx)
	if err != nil {
		return PriceChange{}, err
	}
	defer cancel()

	pc.ID = NewID()
	tag, err := s.pool.Exec(c,
		`INSERT INTO price_changes (id, item, price, effective_local, effective_at, created_at)
		 VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (item, effective_at) DO NOTHING`,
		pc.ID, pc.Item, pc.Price, pc.EffectiveLocal, pc.EffectiveAt, time.Now().UTC())
	if err != nil {
		return PriceChange{}, s.down(c, err)
	}
	if tag.RowsAffected() == 0 {
		return PriceChange{}, ErrPriceChangeExists
	}
	return pc, nil
}

// PriceChangeByID reads one schedule row.
func (s *Store) PriceChangeByID(ctx context.Context, id string) (PriceChange, bool, error) {
	c, cancel, err := s.call(ctx)
	if err != nil {
		return PriceChange{}, false, err
	}
	defer cancel()

	var pc PriceChange
	err = s.pool.QueryRow(c,
		`SELECT id, item, price, effective_local, effective_at FROM price_changes WHERE id = $1`, id).
		Scan(&pc.ID, &pc.Item, &pc.Price, &pc.EffectiveLocal, &pc.EffectiveAt)
	if isNoRows(err) {
		return PriceChange{}, false, nil
	}
	if err != nil {
		return PriceChange{}, false, s.down(c, err)
	}
	pc.EffectiveAt = pc.EffectiveAt.UTC()
	return pc, true, nil
}

// DeletePriceChange removes a schedule row.
func (s *Store) DeletePriceChange(ctx context.Context, id string) error {
	c, cancel, err := s.call(ctx)
	if err != nil {
		return err
	}
	defer cancel()
	_, err = s.pool.Exec(c, `DELETE FROM price_changes WHERE id = $1`, id)
	return s.down(c, err)
}
