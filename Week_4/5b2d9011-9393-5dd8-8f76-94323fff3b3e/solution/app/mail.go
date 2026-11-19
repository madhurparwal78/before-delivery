package main

import (
	"context"
	"log"
	"mime"
	"net"
	"net/mail"
	"net/smtp"
	"strings"
	"sync/atomic"
	"time"
)

type outboxRow struct {
	ID, SignupID, Kind, To, Subject, Body string
	CreatedAt                             time.Time
}

const (
	kindConfirmation = "confirmation"
	kindReminder     = "reminder"
	reminderLead     = 60 * time.Minute
)

// mailer renders, queues and sends the confirmation and reminder emails through the outbox.
type mailer struct {
	cfg    config
	store  *store
	deps   *dependencies
	clock  *wallClock
	queued atomic.Int64
}

func insertOutbox(ctx context.Context, tx execer, row outboxRow) error {
	_, err := tx.ExecContext(ctx,
		`INSERT INTO outbox (id, signup_id, kind, to_email, subject, body, status, created_at)
		 VALUES ($1,$2,$3,$4,$5,$6,'pending',$7) ON CONFLICT (signup_id, kind) DO NOTHING`,
		row.ID, row.SignupID, row.Kind, row.To, row.Subject, row.Body, row.CreatedAt)
	return err
}

func nightLines(night nightRow, viewerZone string, viewerLoc *time.Location) string {
	return "Studio time: " + mailTime(night.StartsAt, studioZone, studioLoc) + "\r\n" +
		"Your time: " + mailTime(night.StartsAt, viewerZone, viewerLoc) + "\r\n"
}

func (m *mailer) confirmation(night nightRow, g signupRow, viewerLoc *time.Location, now time.Time) outboxRow {
	body := "Hi " + g.Name + ",\r\n" +
		"You're on the list for " + night.Title + ".\r\n" +
		nightLines(night, g.ViewerZone, viewerLoc) +
		"Sign-ups close: " + mailTime(night.signupsCloseAt(), studioZone, studioLoc) + "\r\n"
	return outboxRow{ID: newID("mx_"), SignupID: g.ID, Kind: kindConfirmation, To: g.Email,
		Subject: "Signed up: " + night.Title + " · " + dayLabel(night.StartsAt, studioLoc), Body: body, CreatedAt: now}
}

func (m *mailer) reminder(night nightRow, g signupRow, viewerLoc *time.Location, now time.Time) outboxRow {
	body := "Hi " + g.Name + ",\r\n" +
		night.Title + " starts in one hour.\r\n" +
		nightLines(night, g.ViewerZone, viewerLoc)
	return outboxRow{ID: newID("mx_"), SignupID: g.ID, Kind: kindReminder, To: g.Email,
		Subject: "Starts in 1 hour: " + night.Title, Body: body, CreatedAt: now}
}

func (m *mailer) address() string {
	if a, err := mail.ParseAddress(m.cfg.mailFrom); err == nil {
		return a.Address
	}
	return strings.TrimSpace(m.cfg.mailFrom)
}

func (m *mailer) send(to, subject, body string) error {
	addr := net.JoinHostPort(m.cfg.smtpHost, m.cfg.smtpPort)
	conn, err := net.DialTimeout("tcp", addr, 3*time.Second)
	if err != nil {
		return err
	}
	defer conn.Close()
	if err := conn.SetDeadline(time.Now().Add(8 * time.Second)); err != nil {
		return err
	}
	client, err := smtp.NewClient(conn, m.cfg.smtpHost)
	if err != nil {
		return err
	}
	defer client.Close()
	if err := client.Mail(m.address()); err != nil {
		return err
	}
	if err := client.Rcpt(to); err != nil {
		return err
	}
	w, err := client.Data()
	if err != nil {
		return err
	}
	message := "From: " + m.cfg.mailFrom + "\r\n" +
		"To: " + to + "\r\n" +
		"Subject: " + mime.QEncoding.Encode("utf-8", subject) + "\r\n" +
		"Date: " + m.clock.Now().Format(time.RFC1123Z) + "\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: text/plain; charset=utf-8\r\n" +
		"Content-Transfer-Encoding: 8bit\r\n\r\n" + body
	if _, err := w.Write([]byte(message)); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return client.Quit()
}

// probe reports whether the SMTP service greets a connection.
func (m *mailer) probe() bool {
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(m.cfg.smtpHost, m.cfg.smtpPort), 1500*time.Millisecond)
	if err != nil {
		return false
	}
	defer conn.Close()
	if err := conn.SetDeadline(time.Now().Add(1500 * time.Millisecond)); err != nil {
		return false
	}
	buf := make([]byte, 3)
	_, err = conn.Read(buf)
	return err == nil && string(buf) == "220"
}

// deliver sends one queued email now and reports "sent" or "queued".
func (m *mailer) deliver(id string) string {
	if !m.deps.mail.Load() {
		return "queued"
	}
	if m.sendQueued(id) {
		return "sent"
	}
	return "queued"
}

// sendQueued claims a pending outbox row, sends it and marks it sent. It is the only place an
// email leaves the outbox, so each one is sent exactly once.
func (m *mailer) sendQueued(id string) bool {
	ctx, cancel := ctxTimeout(15)
	defer cancel()
	var to, subject, body string
	err := m.store.db.QueryRowContext(ctx,
		`UPDATE outbox SET status = 'sending', claimed_at = now(), attempts = attempts + 1
		 WHERE id = $1 AND status = 'pending' RETURNING to_email, subject, body`, id).Scan(&to, &subject, &body)
	if err != nil {
		return false
	}
	if err := m.send(to, subject, body); err != nil {
		m.release(id)
		return false
	}
	if _, err := m.store.db.ExecContext(ctx, `UPDATE outbox SET status = 'sent', sent_at = now() WHERE id = $1`, id); err != nil {
		log.Printf("outbox: marking %s sent: %v", id, err)
	}
	return true
}

func (m *mailer) release(id string) {
	ctx, cancel := ctxTimeout(5)
	defer cancel()
	if _, err := m.store.db.ExecContext(ctx, `UPDATE outbox SET status = 'pending' WHERE id = $1 AND status = 'sending'`, id); err != nil {
		log.Printf("outbox: releasing %s: %v", id, err)
	}
}

// drain retries every pending email, oldest first, and refreshes the queued count.
func (m *mailer) drain(ctx context.Context) {
	if _, err := m.store.db.ExecContext(ctx,
		`UPDATE outbox SET status = 'pending' WHERE status = 'sending' AND claimed_at < now() - interval '30 seconds'`); err != nil {
		log.Printf("outbox: reclaiming: %v", err)
		return
	}
	rows, err := m.store.db.QueryContext(ctx, `SELECT id FROM outbox WHERE status = 'pending' ORDER BY created_at, id LIMIT 200`)
	if err != nil {
		log.Printf("outbox: listing: %v", err)
		return
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	for _, id := range ids {
		if !m.sendQueued(id) {
			break
		}
	}
	m.refreshQueued(ctx)
}

func (m *mailer) refreshQueued(ctx context.Context) {
	var n int64
	if err := m.store.db.QueryRowContext(ctx, `SELECT count(*) FROM outbox WHERE status <> 'sent'`).Scan(&n); err == nil {
		m.queued.Store(n)
	}
}

// queueDueReminders queues the reminder of every sign-up whose night starts within the lead time.
func (m *mailer) queueDueReminders(ctx context.Context) {
	now := m.clock.Now()
	rows, err := m.store.db.QueryContext(ctx,
		`SELECT `+nightColumns+`, s.id, s.name, s.email, s.viewer_zone, s.created_at
		 FROM signups s JOIN nights n ON n.id = s.night_id
		 WHERE n.starts_at - ($2 * interval '1 second') <= $1 AND n.starts_at > $1
		   AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.signup_id = s.id AND o.kind = 'reminder')`, now, reminderLead.Seconds())
	if err != nil {
		log.Printf("outbox: due reminders: %v", err)
		return
	}
	type due struct {
		night  nightRow
		signup signupRow
	}
	var list []due
	for rows.Next() {
		var d due
		if err := rows.Scan(&d.night.ID, &d.night.SeriesID, &d.night.Title, &d.night.Mode, &d.night.Date,
			&d.night.ScheduledLocalTime, &d.night.StartsAt, &d.night.Capacity, &d.night.DstNote, &d.night.SignedUp,
			&d.signup.ID, &d.signup.Name, &d.signup.Email, &d.signup.ViewerZone, &d.signup.CreatedAt); err == nil {
			d.signup.NightID = d.night.ID
			list = append(list, d)
		}
	}
	rows.Close()
	for _, d := range list {
		loc, err := time.LoadLocation(d.signup.ViewerZone)
		if err != nil {
			log.Printf("outbox: reminder zone %q: %v", d.signup.ViewerZone, err)
			continue
		}
		row := m.reminder(d.night, d.signup, loc, now)
		if err := insertOutbox(ctx, m.store.db, row); err != nil {
			log.Printf("outbox: queueing reminder: %v", err)
			continue
		}
		m.deliver(row.ID)
	}
}

// run is the mail loop: probe, queue due reminders, retry the queue.
func (m *mailer) run(ctx context.Context) {
	probeTick := time.NewTicker(time.Second)
	defer probeTick.Stop()
	n := 0
	for {
		select {
		case <-ctx.Done():
			return
		case <-probeTick.C:
		}
		n++
		if n%2 == 0 {
			m.deps.mail.Store(m.probe())
		}
		if !m.deps.postgres.Load() {
			continue
		}
		loopCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		m.queueDueReminders(loopCtx)
		if m.deps.mail.Load() || n%5 == 0 {
			m.drain(loopCtx)
		}
		cancel()
	}
}
