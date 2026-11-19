package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// Night is a stored night.
type Night struct {
	ID            string
	SeriesID      string
	Title         string
	Mode          string
	Date          string
	LocalTime     string
	LocalStart    string
	UTCOffset     string
	ZoneAbbr      string
	StartsAt      time.Time
	SignupsOpenAt time.Time
	SignupsCloseAt time.Time
	EndsAt        time.Time
	DstNote       any
	Capacity      int
}

// ErrNotFound is returned when a row does not exist.
var ErrNotFound = errors.New("store: not found")

// CreateSeries stores a series and its nights.
func (s *Store) CreateSeries(ctx context.Context, id, title, mode, weekday, localTime, firstDate string, weeks, capacity int, nights []Night) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO series (id, title, mode, weekday, local_time, first_date, weeks, capacity, seeded, created_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,$9)`,
		id, title, mode, weekday, localTime, firstDate, weeks, capacity, time.Now().UTC()); err != nil {
		return err
	}
	for _, n := range nights {
		if err := insertNightTx(ctx, tx, n); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func insertNightTx(ctx context.Context, tx *sql.Tx, n Night) error {
	_, err := tx.ExecContext(ctx,
		`INSERT INTO nights (id, series_id, title, mode, date, scheduled_local_time, local_start,
			utc_offset, zone_abbr, starts_at, signups_open_at, signups_close_at, ends_at, dst_note, capacity)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
		 ON CONFLICT (series_id, date) DO NOTHING`,
		n.ID, n.SeriesID, n.Title, n.Mode, n.Date, n.LocalTime, n.LocalStart, n.UTCOffset, n.ZoneAbbr,
		n.StartsAt, n.SignupsOpenAt, n.SignupsCloseAt, n.EndsAt, dstNoteValue(n.DstNote), n.Capacity)
	return err
}

func dstNoteValue(v any) any {
	if v == nil {
		return nil
	}
	return v
}
