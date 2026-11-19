package store

import (
	"context"
	"database/sql"
	"time"
)

type sqlTx interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// NightsWindow lists nights whose studio date falls in [from, from+days).
func (s *Store) NightsWindow(ctx context.Context, from string, days int) ([]Night, error) {
	until, err := shiftDate(from, days)
	if err != nil {
		return nil, err
	}
	rows, err := s.DB.QueryContext(ctx,
		`SELECT id, series_id, title, mode, date, scheduled_local_time, local_start,
			utc_offset, zone_abbr, starts_at, signups_open_at, signups_close_at, ends_at, dst_note, capacity
		 FROM nights WHERE date >= $1 AND date < $2 ORDER BY starts_at`, from, until)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanNights(rows)
}

// NightsBetween lists nights whose studio date falls in [from, until).
func (s *Store) NightsBetween(ctx context.Context, from, until string) ([]Night, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT id, series_id, title, mode, date, scheduled_local_time, local_start,
			utc_offset, zone_abbr, starts_at, signups_open_at, signups_close_at, ends_at, dst_note, capacity
		 FROM nights WHERE date >= $1 AND date < $2 ORDER BY starts_at`, from, until)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanNights(rows)
}

func scanNights(rows *sql.Rows) ([]Night, error) {
	var out []Night
	for rows.Next() {
		var n Night
		var dst sql.NullString
		if err := rows.Scan(&n.ID, &n.SeriesID, &n.Title, &n.Mode, &n.Date, &n.LocalTime, &n.LocalStart,
			&n.UTCOffset, &n.ZoneAbbr, &n.StartsAt, &n.SignupsOpenAt, &n.SignupsCloseAt, &n.EndsAt, &dst, &n.Capacity); err != nil {
			return nil, err
		}
		if dst.Valid {
			n.DstNote = dst.String
		} else {
			n.DstNote = nil
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// NightByID loads one night.
func (s *Store) NightByID(ctx context.Context, id string) (Night, error) {
	var n Night
	var dst sql.NullString
	err := s.DB.QueryRowContext(ctx,
		`SELECT id, series_id, title, mode, date, scheduled_local_time, local_start,
			utc_offset, zone_abbr, starts_at, signups_open_at, signups_close_at, ends_at, dst_note, capacity
		 FROM nights WHERE id=$1`, id).
		Scan(&n.ID, &n.SeriesID, &n.Title, &n.Mode, &n.Date, &n.LocalTime, &n.LocalStart,
			&n.UTCOffset, &n.ZoneAbbr, &n.StartsAt, &n.SignupsOpenAt, &n.SignupsCloseAt, &n.EndsAt, &dst, &n.Capacity)
	if err == sql.ErrNoRows {
		return n, ErrNotFound
	}
	if dst.Valid {
		n.DstNote = dst.String
	} else {
		n.DstNote = nil
	}
	return n, err
}

// NightSeries lists every night of a series.
func (s *Store) NightSeries(ctx context.Context, seriesID string) ([]Night, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT id, series_id, title, mode, date, scheduled_local_time, local_start,
			utc_offset, zone_abbr, starts_at, signups_open_at, signups_close_at, ends_at, dst_note, capacity
		 FROM nights WHERE series_id=$1 ORDER BY starts_at`, seriesID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanNights(rows)
}

func shiftDate(from string, days int) (string, error) {
	t, err := time.Parse("2006-01-02", from)
	if err != nil {
		return "", err
	}
	return t.AddDate(0, 0, days).Format("2006-01-02"), nil
}

// NightsLive lists nights that are live now (starts_at <= now < ends_at).
func (s *Store) NightsLive(ctx context.Context, now time.Time) ([]Night, error) {
rows, err := s.DB.QueryContext(ctx,
`SELECT id, series_id, title, mode, date, scheduled_local_time, local_start,
utc_offset, zone_abbr, starts_at, signups_open_at, signups_close_at, ends_at, dst_note, capacity
 FROM nights WHERE starts_at <= $1 AND ends_at > $1 ORDER BY starts_at`, now)
if err != nil {
return nil, err
}
defer rows.Close()
return scanNights(rows)
}
