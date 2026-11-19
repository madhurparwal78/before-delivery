package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

// Signup is a stored sign-up.
type Signup struct {
	ID         string
	NightID    string
	Name       string
	Email      string
	ViewerZone string
	CreatedAt  time.Time
}

// CreateSignup stores a sign-up, its confirmation outbox row and its reminder
// row in one transaction. It returns ErrEmailTaken when the email is already
// signed up for the night.
func (s *Store) CreateSignup(ctx context.Context, id, nightID, name, email, viewerZone string,
	confirmSubject, confirmBody string, startsAt time.Time) (Signup, error) {
	var su Signup
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return su, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO signups (id, night_id, name, email, viewer_zone, created_at)
		 VALUES ($1,$2,$3,$4,$5,$6)`,
		id, nightID, name, email, viewerZone, time.Now().UTC()); err != nil {
		if strings.Contains(err.Error(), "signup_night_email_idx") {
			return su, ErrEmailTaken
		}
		return su, err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO outbox (kind, signup_id, night_id, to_addr, subject, body, created_at)
		 VALUES ('confirmation', $1, $2, $3, $4, $5, $6)`,
		id, nightID, email, confirmSubject, confirmBody, time.Now().UTC()); err != nil {
		if strings.Contains(err.Error(), "outbox_signup_kind_idx") {
			return su, ErrEmailTaken
		}
		return su, err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO reminders (signup_id, night_id, due_at) VALUES ($1,$2,$3)
		 ON CONFLICT (signup_id, night_id) DO NOTHING`,
		id, nightID, startsAt.Add(-60*time.Minute)); err != nil {
		return su, err
	}
	if err := tx.Commit(); err != nil {
		return su, err
	}
	su = Signup{ID: id, NightID: nightID, Name: name, Email: email, ViewerZone: viewerZone, CreatedAt: time.Now().UTC()}
	return su, nil
}

// ErrEmailTaken marks a repeat sign-up.
var ErrEmailTaken = errors.New("store: email already signed up")

// SignupByEmail finds an existing sign-up by night and email.
func (s *Store) SignupByEmail(ctx context.Context, nightID, email string) (Signup, bool, error) {
	var su Signup
	err := s.DB.QueryRowContext(ctx,
		`SELECT id, night_id, name, email, viewer_zone, created_at FROM signups
		 WHERE night_id=$1 AND lower(email)=lower($2)`, nightID, email).
		Scan(&su.ID, &su.NightID, &su.Name, &su.Email, &su.ViewerZone, &su.CreatedAt)
	if err == sql.ErrNoRows {
		return su, false, nil
	}
	if err != nil {
		return su, false, err
	}
	return su, true, nil
}

// CountSignups counts a night's sign-ups.
func (s *Store) CountSignups(ctx context.Context, nightID string) (int, error) {
	var n int
	err := s.DB.QueryRowContext(ctx, `SELECT count(*) FROM signups WHERE night_id=$1`, nightID).Scan(&n)
	return n, err
}

// Signups lists a night's sign-ups.
func (s *Store) Signups(ctx context.Context, nightID string) ([]Signup, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT id, night_id, name, email, viewer_zone, created_at FROM signups
		 WHERE night_id=$1 ORDER BY created_at`, nightID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Signup
	for rows.Next() {
		var su Signup
		if err := rows.Scan(&su.ID, &su.NightID, &su.Name, &su.Email, &su.ViewerZone, &su.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, su)
	}
	return out, rows.Err()
}

// OutboxMail is one queued email.
type OutboxMail struct {
	ID      int64
	Kind    string
	To      string
	Subject string
	Body    string
}

// PendingMail lists unsent outbox rows, oldest first.
func (s *Store) PendingMail(ctx context.Context) ([]OutboxMail, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT id, kind, to_addr, subject, body FROM outbox WHERE sent_at IS NULL ORDER BY id LIMIT 200`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OutboxMail
	for rows.Next() {
		var m OutboxMail
		if err := rows.Scan(&m.ID, &m.Kind, &m.To, &m.Subject, &m.Body); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// MarkMailSent marks an outbox row sent.
func (s *Store) MarkMailSent(ctx context.Context, id int64) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE outbox SET sent_at=$2, attempts=attempts+1 WHERE id=$1`, id, time.Now().UTC())
	return err
}

// CountQueuedMail counts unsent outbox rows.
func (s *Store) CountQueuedMail(ctx context.Context) (int, error) {
	var n int
	err := s.DB.QueryRowContext(ctx, `SELECT count(*) FROM outbox WHERE sent_at IS NULL`).Scan(&n)
	return n, err
}

// DueReminders lists reminders that are due and not yet queued.
func (s *Store) DueReminders(ctx context.Context, now time.Time) ([]ReminderDue, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT r.signup_id, r.night_id, r.due_at, s.email
		 FROM reminders r JOIN signups s ON s.id=r.signup_id
		 WHERE r.due_at <= $1 AND r.queued=false`, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ReminderDue
	for rows.Next() {
		var rd ReminderDue
		if err := rows.Scan(&rd.SignupID, &rd.NightID, &rd.DueAt, &rd.Email); err != nil {
			return nil, err
		}
		out = append(out, rd)
	}
	return out, rows.Err()
}

// ReminderDue is a due reminder.
type ReminderDue struct {
	SignupID string
	NightID  string
	DueAt    time.Time
	Email    string
}

// QueueReminder writes the reminder outbox row and marks the reminder queued.
func (s *Store) QueueReminder(ctx context.Context, rd ReminderDue, subject, body string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO outbox (kind, signup_id, night_id, to_addr, subject, body, created_at)
		 VALUES ('reminder', $1, $2, $3, $4, $5, $6)`,
		rd.SignupID, rd.NightID, rd.Email, subject, body, time.Now().UTC()); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE reminders SET queued=true WHERE signup_id=$1 AND night_id=$2`, rd.SignupID, rd.NightID); err != nil {
		return err
	}
	return tx.Commit()
}

// SignupByID loads a sign-up by id.
func (s *Store) SignupByID(ctx context.Context, id string) (Signup, error) {
var su Signup
err := s.DB.QueryRowContext(ctx,
`SELECT id, night_id, name, email, viewer_zone, created_at FROM signups WHERE id=$1`, id).
Scan(&su.ID, &su.NightID, &su.Name, &su.Email, &su.ViewerZone, &su.CreatedAt)
if err == sql.ErrNoRows {
return su, ErrNotFound
}
return su, err
}
