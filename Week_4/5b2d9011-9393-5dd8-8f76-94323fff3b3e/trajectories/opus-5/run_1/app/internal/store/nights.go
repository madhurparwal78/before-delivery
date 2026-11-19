package store

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Series is a weekly night series, stored as a weekday and a local wall time.
type Series struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Mode      string    `json:"mode"`
	Weekday   string    `json:"weekday"`
	LocalTime string    `json:"local_time"`
	FirstDate time.Time `json:"-"`
	Weeks     int       `json:"weeks"`
	Capacity  int       `json:"capacity"`
}

// Night is one stored night. Its instant is derived from the date and wall time,
// so a stored night never moves.
type Night struct {
	ID                 string
	SeriesID           string
	Title              string
	Mode               string
	Date               time.Time
	ScheduledLocalTime string
	Capacity           int
	SignedUp           int
}

// Signup is one spectator sign-up for a night.
type Signup struct {
	ID         string    `json:"id"`
	NightID    string    `json:"night_id"`
	Name       string    `json:"name"`
	Email      string    `json:"email"`
	ViewerZone string    `json:"viewer_zone"`
	CreatedAt  time.Time `json:"created_at"`
}

// ErrNightFull reports that a night has reached its capacity.
var ErrNightFull = errors.New("night full")

const nightSelect = `SELECT n.id, COALESCE(n.series_id, ''), n.title, n.mode, n.night_date,
  n.scheduled_local_time, n.capacity,
  (SELECT count(*) FROM signups s WHERE s.night_id = n.id)::int
 FROM nights n`

// NightsBetween reads the nights whose studio date falls in an inclusive window.
func (s *Store) NightsBetween(ctx context.Context, from, to time.Time) ([]Night, error) {
	c, cancel, err := s.call(ctx)
	if err != nil {
		return nil, err
	}
	defer cancel()

	rows, err := s.pool.Query(c, nightSelect+` WHERE n.night_date >= $1 AND n.night_date <= $2`, from, to)
	if err != nil {
		return nil, s.down(c, err)
	}
	defer rows.Close()
	return s.scanNights(c, rows)
}

// NightByID reads one night.
func (s *Store) NightByID(ctx context.Context, id string) (Night, bool, error) {
	c, cancel, err := s.call(ctx)
	if err != nil {
		return Night{}, false, err
	}
	defer cancel()

	rows, err := s.pool.Query(c, nightSelect+` WHERE n.id = $1`, id)
	if err != nil {
		return Night{}, false, s.down(c, err)
	}
	defer rows.Close()
	list, err := s.scanNights(c, rows)
	if err != nil || len(list) == 0 {
		return Night{}, false, err
	}
	return list[0], true, nil
}

func (s *Store) scanNights(ctx context.Context, rows pgx.Rows) ([]Night, error) {
	var out []Night
	for rows.Next() {
		var n Night
		if err := rows.Scan(&n.ID, &n.SeriesID, &n.Title, &n.Mode, &n.Date,
			&n.ScheduledLocalTime, &n.Capacity, &n.SignedUp); err != nil {
			return nil, s.down(ctx, err)
		}
		n.Date = time.Date(n.Date.Year(), n.Date.Month(), n.Date.Day(), 0, 0, 0, 0, time.UTC)
		out = append(out, n)
	}
	return out, s.down(ctx, rows.Err())
}

// NightsOnDates reads a mode's nights across a studio-date window. The caller
// decides which of them its clock makes live.
func (s *Store) NightsOnDates(ctx context.Context, mode string, from, to time.Time) ([]Night, error) {
	c, cancel, err := s.call(ctx)
	if err != nil {
		return nil, err
	}
	defer cancel()

	rows, err := s.pool.Query(c, nightSelect+` WHERE n.mode = $1 AND n.night_date >= $2 AND n.night_date <= $3`,
		mode, from, to)
	if err != nil {
		return nil, s.down(c, err)
	}
	defer rows.Close()
	return s.scanNights(c, rows)
}

// CreateSeries stores a series and expands it into one night per week.
func (s *Store) CreateSeries(ctx context.Context, in Series, dates []time.Time) (Series, []Night, error) {
	c, cancel, err := s.call(ctx)
	if err != nil {
		return Series{}, nil, err
	}
	defer cancel()

	in.ID = NewID()
	now := time.Now().UTC()

	tx, err := s.pool.Begin(c)
	if err != nil {
		return Series{}, nil, s.down(c, err)
	}
	defer func() { _ = tx.Rollback(c) }()

	if _, err := tx.Exec(c,
		`INSERT INTO series (id, title, mode, weekday, local_time, first_date, weeks, capacity, seed_key, created_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9)`,
		in.ID, in.Title, in.Mode, in.Weekday, in.LocalTime, in.FirstDate, in.Weeks, in.Capacity, now); err != nil {
		return Series{}, nil, s.down(c, err)
	}

	nights := make([]Night, 0, len(dates))
	for _, date := range dates {
		night := Night{
			ID: NewID(), SeriesID: in.ID, Title: in.Title, Mode: in.Mode,
			Date: date, ScheduledLocalTime: in.LocalTime, Capacity: in.Capacity,
		}
		if _, err := tx.Exec(c,
			`INSERT INTO nights (id, series_id, title, mode, night_date, scheduled_local_time, capacity, created_at)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
			night.ID, night.SeriesID, night.Title, night.Mode, night.Date,
			night.ScheduledLocalTime, night.Capacity, now); err != nil {
			return Series{}, nil, s.down(c, err)
		}
		nights = append(nights, night)
	}
	if err := tx.Commit(c); err != nil {
		return Series{}, nil, s.down(c, err)
	}
	return in, nights, nil
}

// SignupByEmail finds a night's sign-up for an email, compared case-insensitively.
func (s *Store) SignupByEmail(ctx context.Context, nightID, email string) (Signup, bool, error) {
	c, cancel, err := s.call(ctx)
	if err != nil {
		return Signup{}, false, err
	}
	defer cancel()
	return s.signupByEmail(c, nightID, email)
}

func (s *Store) signupByEmail(ctx context.Context, nightID, email string) (Signup, bool, error) {
	var su Signup
	err := s.pool.QueryRow(ctx,
		`SELECT id, night_id, name, email, viewer_zone, created_at FROM signups
		 WHERE night_id = $1 AND email_key = $2`, nightID, EmailKey(email)).
		Scan(&su.ID, &su.NightID, &su.Name, &su.Email, &su.ViewerZone, &su.CreatedAt)
	if isNoRows(err) {
		return Signup{}, false, nil
	}
	if err != nil {
		return Signup{}, false, s.down(ctx, err)
	}
	su.CreatedAt = su.CreatedAt.UTC().Truncate(time.Second)
	return su, true, nil
}

// EmailKey normalises an email for the one-sign-up-per-night rule.
func EmailKey(email string) string { return strings.ToLower(strings.TrimSpace(email)) }

// CreateSignup takes a seat on a night, holding the night row so that under
// contention exactly the free seats succeed. The caller passes the server's wall
// clock, since every calendar question reads that clock.
func (s *Store) CreateSignup(ctx context.Context, nightID, name, email, zone string, now time.Time) (Signup, bool, error) {
	c, cancel, err := s.call(ctx)
	if err != nil {
		return Signup{}, false, err
	}
	defer cancel()

	tx, err := s.pool.Begin(c)
	if err != nil {
		return Signup{}, false, s.down(c, err)
	}
	defer func() { _ = tx.Rollback(c) }()

	var capacity, taken int
	if err := tx.QueryRow(c, `SELECT capacity FROM nights WHERE id = $1 FOR UPDATE`, nightID).Scan(&capacity); err != nil {
		return Signup{}, false, s.down(c, err)
	}
	if err := tx.QueryRow(c, `SELECT count(*)::int FROM signups WHERE night_id = $1`, nightID).Scan(&taken); err != nil {
		return Signup{}, false, s.down(c, err)
	}

	var existing Signup
	err = tx.QueryRow(c,
		`SELECT id, night_id, name, email, viewer_zone, created_at FROM signups
		 WHERE night_id = $1 AND email_key = $2`, nightID, EmailKey(email)).
		Scan(&existing.ID, &existing.NightID, &existing.Name, &existing.Email, &existing.ViewerZone, &existing.CreatedAt)
	if err == nil {
		existing.CreatedAt = existing.CreatedAt.UTC().Truncate(time.Second)
		return existing, false, nil
	}
	if !isNoRows(err) {
		return Signup{}, false, s.down(c, err)
	}
	if taken >= capacity {
		return Signup{}, false, ErrNightFull
	}

	su := Signup{
		ID: NewID(), NightID: nightID, Name: name, Email: email,
		ViewerZone: zone, CreatedAt: now.UTC().Truncate(time.Second),
	}
	if _, err := tx.Exec(c,
		`INSERT INTO signups (id, night_id, name, email, email_key, viewer_zone, created_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		su.ID, su.NightID, su.Name, su.Email, EmailKey(su.Email), su.ViewerZone, su.CreatedAt); err != nil {
		return Signup{}, false, s.down(c, err)
	}
	if err := tx.Commit(c); err != nil {
		return Signup{}, false, s.down(c, err)
	}
	return su, true, nil
}

// SignupsForNight lists a night's sign-ups, oldest first.
func (s *Store) SignupsForNight(ctx context.Context, nightID string) ([]Signup, error) {
	c, cancel, err := s.call(ctx)
	if err != nil {
		return nil, err
	}
	defer cancel()

	rows, err := s.pool.Query(c,
		`SELECT id, night_id, name, email, viewer_zone, created_at FROM signups
		 WHERE night_id = $1 ORDER BY created_at ASC`, nightID)
	if err != nil {
		return nil, s.down(c, err)
	}
	defer rows.Close()

	out := []Signup{}
	for rows.Next() {
		var su Signup
		if err := rows.Scan(&su.ID, &su.NightID, &su.Name, &su.Email, &su.ViewerZone, &su.CreatedAt); err != nil {
			return nil, s.down(c, err)
		}
		su.CreatedAt = su.CreatedAt.UTC().Truncate(time.Second)
		out = append(out, su)
	}
	return out, s.down(c, rows.Err())
}

// ReminderCandidate pairs a sign-up with its night.
type ReminderCandidate struct {
	Signup Signup
	Night  Night
}

// SignupsAwaitingReminder lists sign-ups with no reminder outbox row yet,
// together with their nights. The caller decides which reminders have fallen due.
func (s *Store) SignupsAwaitingReminder(ctx context.Context) ([]ReminderCandidate, error) {
	c, cancel, err := s.call(ctx)
	if err != nil {
		return nil, err
	}
	defer cancel()

	rows, err := s.pool.Query(c,
		`SELECT s.id, s.night_id, s.name, s.email, s.viewer_zone, s.created_at,
		        n.id, COALESCE(n.series_id,''), n.title, n.mode, n.night_date,
		        n.scheduled_local_time, n.capacity
		 FROM signups s JOIN nights n ON n.id = s.night_id
		 WHERE NOT EXISTS (SELECT 1 FROM outbox o WHERE o.dedupe_key = 'reminder:' || s.id)`)
	if err != nil {
		return nil, s.down(c, err)
	}
	defer rows.Close()

	out := []ReminderCandidate{}
	for rows.Next() {
		var rc ReminderCandidate
		if err := rows.Scan(&rc.Signup.ID, &rc.Signup.NightID, &rc.Signup.Name, &rc.Signup.Email,
			&rc.Signup.ViewerZone, &rc.Signup.CreatedAt,
			&rc.Night.ID, &rc.Night.SeriesID, &rc.Night.Title, &rc.Night.Mode, &rc.Night.Date,
			&rc.Night.ScheduledLocalTime, &rc.Night.Capacity); err != nil {
			return nil, s.down(c, err)
		}
		rc.Signup.CreatedAt = rc.Signup.CreatedAt.UTC().Truncate(time.Second)
		rc.Night.Date = time.Date(rc.Night.Date.Year(), rc.Night.Date.Month(), rc.Night.Date.Day(), 0, 0, 0, 0, time.UTC)
		out = append(out, rc)
	}
	return out, s.down(c, rows.Err())
}
