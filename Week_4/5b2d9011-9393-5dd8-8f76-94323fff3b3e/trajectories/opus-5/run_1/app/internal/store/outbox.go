package store

import (
	"context"
	"time"
)

// OutboxEmail is one queued email. Its dedupe key makes each confirmation and
// each reminder exist at most once, however the clock moves.
type OutboxEmail struct {
	ID         string
	DedupeKey  string
	Kind       string
	To         string
	Subject    string
	Body       string
	DueAt      time.Time
	SentAt     *time.Time
	NightTitle string
}

// QueueEmail stores an email to send, ignoring a key that already exists.
// It reports the stored row and whether this call created it.
func (s *Store) QueueEmail(ctx context.Context, email OutboxEmail) (string, bool, error) {
	c, cancel, err := s.call(ctx)
	if err != nil {
		return "", false, err
	}
	defer cancel()

	id := NewID()
	tag, err := s.pool.Exec(c,
		`INSERT INTO outbox (id, dedupe_key, kind, to_addr, subject, body, due_at, sent_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,NULL) ON CONFLICT (dedupe_key) DO NOTHING`,
		id, email.DedupeKey, email.Kind, email.To, email.Subject, email.Body, email.DueAt)
	if err != nil {
		return "", false, s.down(c, err)
	}
	if tag.RowsAffected() == 0 {
		return "", false, nil
	}
	return id, true, nil
}

// DueEmails lists unsent emails whose due instant has passed, oldest first.
func (s *Store) DueEmails(ctx context.Context, now time.Time, limit int) ([]OutboxEmail, error) {
	c, cancel, err := s.call(ctx)
	if err != nil {
		return nil, err
	}
	defer cancel()

	rows, err := s.pool.Query(c,
		`SELECT id, dedupe_key, kind, to_addr, subject, body, due_at FROM outbox
		 WHERE sent_at IS NULL AND due_at <= $1 ORDER BY due_at ASC, id ASC LIMIT $2`, now, limit)
	if err != nil {
		return nil, s.down(c, err)
	}
	defer rows.Close()

	out := []OutboxEmail{}
	for rows.Next() {
		var e OutboxEmail
		if err := rows.Scan(&e.ID, &e.DedupeKey, &e.Kind, &e.To, &e.Subject, &e.Body, &e.DueAt); err != nil {
			return nil, s.down(c, err)
		}
		out = append(out, e)
	}
	return out, s.down(c, rows.Err())
}

// MarkEmailSent records an email as sent, which happens at most once per row.
func (s *Store) MarkEmailSent(ctx context.Context, id string, at time.Time) (bool, error) {
	c, cancel, err := s.call(ctx)
	if err != nil {
		return false, err
	}
	defer cancel()

	tag, err := s.pool.Exec(c, `UPDATE outbox SET sent_at = $2 WHERE id = $1 AND sent_at IS NULL`, id, at)
	if err != nil {
		return false, s.down(c, err)
	}
	return tag.RowsAffected() == 1, nil
}

// QueuedEmailCount counts the emails still waiting to send.
func (s *Store) QueuedEmailCount(ctx context.Context) (int, error) {
	c, cancel, err := s.call(ctx)
	if err != nil {
		return 0, err
	}
	defer cancel()

	var n int
	if err := s.pool.QueryRow(c, `SELECT count(*)::int FROM outbox WHERE sent_at IS NULL`).Scan(&n); err != nil {
		return 0, s.down(c, err)
	}
	return n, nil
}
