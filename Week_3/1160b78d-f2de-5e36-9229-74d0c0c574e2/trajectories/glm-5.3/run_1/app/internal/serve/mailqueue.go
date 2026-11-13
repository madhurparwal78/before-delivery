package serve

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"switchlamp/internal/cache"
	"switchlamp/internal/mailer"
	"switchlamp/internal/store"
)

// MailQueue keeps queued mail in Postgres and retries every few real seconds
// with the host and port read for each attempt. Each message arrives exactly
// once, in due order for one person.
type MailQueue struct {
	store     *store.Store
	sender    *mailer.Sender
	cache     *cache.Cache
	clock     clockReader
	publicURL string
}

// clockReader is the server clock, so due steps never depend on the device.
type clockReader interface {
	Now() time.Time
}

// NewMailQueue builds the queue worker.
func NewMailQueue(st *store.Store, sender *mailer.Sender, c *cache.Cache, clk clockReader, publicURL string) *MailQueue {
	return &MailQueue{store: st, sender: sender, cache: c, clock: clk, publicURL: publicURL}
}

// Run polls the queue and the due notification steps.
func (q *MailQueue) Run(ctx context.Context) {
	tick := time.NewTicker(2 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			_ = q.pass(ctx)
			_ = q.dispatchSteps(ctx)
		}
	}
}

// pass sends everything due and leaves the rest queued. The comparison uses
// the server clock, never the database's.
func (q *MailQueue) pass(ctx context.Context) error {
	now := q.clock.Now()
	rows, err := q.store.Pool().Query(ctx, `SELECT id, to_addr, subject, body FROM mail_queue
		WHERE due_at <= $1 ORDER BY due_at, id`, now)
	if err != nil {
		return err
	}
	type mail struct {
		ID, To, Subject, Body string
	}
	var due []mail
	for rows.Next() {
		var m mail
		if err := rows.Scan(&m.ID, &m.To, &m.Subject, &m.Body); err != nil {
			rows.Close()
			return err
		}
		due = append(due, m)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	anySent := false
	for _, m := range due {
		if err := q.sender.Send(ctx, m.To, m.Subject, m.Body); err != nil {
			// Mail that cannot go stays queued.
			continue
		}
		anySent = true
		if _, err := q.store.Pool().Exec(ctx, `DELETE FROM mail_queue WHERE id = $1`, m.ID); err != nil {
			return err
		}
	}
	q.cache.NoteMail(anySent || len(due) == 0)
	return nil
}

// Enqueue queues one mail.
func (q *MailQueue) Enqueue(ctx context.Context, to, subject, body string, due time.Time) error {
	_, err := q.store.Pool().Exec(ctx, `INSERT INTO mail_queue (id, to_addr, subject, body, due_at)
		VALUES ($1,$2,$3,$4,$5)`, genID(), to, subject, body, due)
	return err
}

// QueuedCount counts unsent mail for the published notices.
func (q *MailQueue) QueuedCount(ctx context.Context) int {
	var n int
	q.store.Pool().QueryRow(ctx, `SELECT count(*) FROM mail_queue`).Scan(&n)
	return n
}

// dispatchSteps turns due notification steps into mail. A step becomes queued
// when due and sent only once the mail server accepted it. Quiet hours hold a
// low-urgency notice through the holder's quiet hours in their own zone.
func (q *MailQueue) dispatchSteps(ctx context.Context) error {
	now := q.clock.Now().Truncate(time.Second)
	rows, err := q.store.Pool().Query(ctx, `SELECT st.id, st.incident_id, st.person_id, st.kind, st.due_at, st.status,
		i.number, i.title, u.email, u.timezone, u.quiet_start, u.quiet_end
		FROM steps st
		JOIN incidents i ON i.id = st.incident_id
		JOIN users u ON u.id = st.person_id
		WHERE st.status IN ('scheduled','held') AND st.due_at <= $1
		ORDER BY st.due_at`, now)
	if err != nil {
		return err
	}
	type step struct {
		ID, IncidentID, PersonID, Kind, Status string
		Due                                   time.Time
		Number                                int64
		Title                                 string
		Email                                 string
		Timezone                              string
		QuietStart, QuietEnd                  *string
	}
	var due []step
	for rows.Next() {
		var s step
		if err := rows.Scan(&s.ID, &s.IncidentID, &s.PersonID, &s.Kind, &s.Due, &s.Status,
			&s.Number, &s.Title, &s.Email, &s.Timezone, &s.QuietStart, &s.QuietEnd); err != nil {
			rows.Close()
			return err
		}
		due = append(due, s)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	anySent := false
	anyFailed := false
	for _, s := range due {
		if s.Kind == "low_urgency" && inQuietHours(now, s.Timezone, s.QuietStart, s.QuietEnd) {
			// Held until the quiet hours end in that person's own zone.
			q.store.Pool().Exec(ctx, `UPDATE steps SET status = 'held' WHERE id = $1`, s.ID)
			continue
		}
		// A held step whose quiet hours have ended goes out now.
		q.store.Pool().Exec(ctx, `UPDATE steps SET status = 'queued' WHERE id = $1`, s.ID)
		var token string
		if s.Kind != "low_urgency" {
			// The link is signed for one person, one incident and one
			// assignment: the step id.
			token = q.sign(ctx, s.PersonID, s.IncidentID, s.ID)
		}
		subject := fmt.Sprintf("[Switchlamp] Incident #%d needs you: %s", s.Number, s.Title)
		body := fmt.Sprintf("Incident #%d needs you: %s\n\nAcknowledge: %s/ack/%s\n",
			s.Number, s.Title, q.publicURL, token)
		if s.Kind == "low_urgency" {
			subject = fmt.Sprintf("[Switchlamp] Low urgency incident #%d: %s", s.Number, s.Title)
			body = fmt.Sprintf("Low urgency incident #%d: %s\n", s.Number, s.Title)
		}
		if err := q.sender.Send(ctx, s.Email, subject, body); err != nil {
			// Mail that cannot go stays queued and is retried on the next pass.
			anyFailed = true
			continue
		}
		anySent = true
		if token != "" {
			// A link is signed for one person, one incident and one assignment,
			// and expires 30 minutes after its mail's due second.
			q.store.Pool().Exec(ctx, `UPDATE steps SET status = 'sent', sent_at = $2, token = $3,
				token_expires = $4 WHERE id = $1`, s.ID, now, token, s.Due.Add(30*time.Minute))
		} else {
			q.store.Pool().Exec(ctx, `UPDATE steps SET status = 'sent', sent_at = $2 WHERE id = $1`, s.ID, now)
		}
	}
	// Mail health follows whether the last batch of due steps could go out.
	// Held quiet-hours steps are a normal state, not an outage.
	if len(due) > 0 {
		q.cache.NoteMail(!anyFailed || anySent)
	}
	return nil
}

// inQuietHours reports whether now falls inside quiet_start to quiet_end, read
// in the person's own zone and possibly crossing midnight.
func inQuietHours(now time.Time, zone string, start, end *string) bool {
	if start == nil || end == nil || *start == "" || *end == "" {
		return false
	}
	loc, err := time.LoadLocation(zone)
	if err != nil {
		loc = time.UTC
	}
	lt := now.In(loc)
	var sh, sm, eh, em int
	fmt.Sscanf(*start, "%d:%d", &sh, &sm)
	fmt.Sscanf(*end, "%d:%d", &eh, &em)
	minutes := lt.Hour()*60 + lt.Minute()
	startM := sh*60 + sm
	endM := eh*60 + em
	if startM == endM {
		return false
	}
	if startM < endM {
		return minutes >= startM && minutes < endM
	}
	// Crossing midnight: the quiet hours run from start to midnight, and from
	// midnight to end.
	return minutes >= startM || minutes < endM
}

// signToken signs an acknowledge link token in the published form:
// person.incident.assignment.signature.
func (q *MailQueue) sign(ctx context.Context, personID, incidentID, assignment string) string {
mac := hmac.New(sha256.New, q.signingSecret(ctx))
mac.Write([]byte(strings.Join([]string{personID, incidentID, assignment}, "|")))
sig := hex.EncodeToString(mac.Sum(nil))
return personID + "." + incidentID + "." + assignment + "." + sig
}

func (q *MailQueue) signingSecret(ctx context.Context) []byte {
v, err := q.store.MetaGet(ctx, "signing_secret")
if err != nil || v == "" {
return []byte("switchlamp")
}
return []byte(v)
}
