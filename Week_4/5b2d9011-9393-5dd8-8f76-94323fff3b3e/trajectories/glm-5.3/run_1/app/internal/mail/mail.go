// Package mail sends emails over plain SMTP and drains the queued outbox
// while mail is down.
package mail

import (
"context"
"fmt"
"net"
"net/smtp"
"strings"
"time"

"holdfast/internal/store"
)

// Sender sends one email. Mail never fails a request: when the server is
// unreachable the email stays queued and the worker retries.
type Sender struct {
Host string
Port int
From string
}

// Up reports whether the SMTP server answers.
func (s *Sender) Up() bool {
conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", s.Host, s.Port), 2*time.Second)
if err != nil {
return false
}
conn.Close()
return true
}

// Send delivers one email. It returns an error when the server is
// unreachable; the caller keeps the message queued.
func (s *Sender) Send(to, subject, body string) error {
addr := fmt.Sprintf("%s:%d", s.Host, s.Port)
msg := buildMessage(s.From, to, subject, body)
var auth smtp.Auth
return smtp.SendMail(addr, auth, extractAddress(s.From), []string{to}, msg)
}

// buildMessage renders a plain-text email.
func buildMessage(from, to, subject, body string) []byte {
var b strings.Builder
fmt.Fprintf(&b, "From: %s\r\n", from)
fmt.Fprintf(&b, "To: %s\r\n", to)
fmt.Fprintf(&b, "Subject: %s\r\n", subject)
fmt.Fprintf(&b, "Content-Type: text/plain; charset=utf-8\r\n")
fmt.Fprintf(&b, "MIME-Version: 1.0\r\n")
fmt.Fprintf(&b, "Date: %s\r\n", time.Now().UTC().Format(time.RFC1123Z))
fmt.Fprintf(&b, "\r\n")
fmt.Fprintf(&b, "%s\r\n", body)
return []byte(b.String())
}

// extractAddress pulls the bare address out of a display-from header value.
func extractAddress(from string) string {
if start := strings.Index(from, "<"); start >= 0 {
if end := strings.Index(from, ">"); end > start {
return from[start+1 : end]
}
}
return strings.TrimSpace(from)
}

// Worker drains the outbox. It is the one place that decides when a queued
// email is sent.
type Worker struct {
Sender   *Sender
Store    *store.Store
Clock    Clock
OnQueued func(queued int)
OnUp     func(up bool)
// ReminderTime renders the reminder's Studio time and Your time lines.
ReminderTime func(n store.Night, viewerZone string) (string, string)
}

// Clock reads the wall clock.
type Clock interface {
Now() time.Time
}

// Run probes mail and drains the outbox until ctx is done.
func (w *Worker) Run(ctx context.Context) {
ticker := time.NewTicker(5 * time.Second)
defer ticker.Stop()
for {
select {
case <-ctx.Done():
return
case <-ticker.C:
w.drain(ctx)
}
}
}

// drain probes mail, queues due reminders and clears the queue.
func (w *Worker) drain(ctx context.Context) {
up := w.Sender.Up()
if w.OnUp != nil {
w.OnUp(up)
}
// Due reminders queue first, whether or not mail is up, so each is sent
// exactly once.
w.queueDueReminders(ctx)
pending, err := w.Store.PendingMail(ctx)
if err != nil {
return
}
if up {
for _, m := range pending {
if err := w.Sender.Send(m.To, m.Subject, m.Body); err != nil {
// Still down: leave it queued for the next drain.
break
}
w.Store.MarkMailSent(ctx, m.ID)
}
}
if queued, err := w.Store.CountQueuedMail(ctx); err == nil && w.OnQueued != nil {
w.OnQueued(queued)
}
}

// queueDueReminders writes reminder rows whose due instant has passed. Each
// reminder is queued exactly once, however the clock moves.
func (w *Worker) queueDueReminders(ctx context.Context) {
now := w.Clock.Now().UTC()
due, err := w.Store.DueReminders(ctx, now)
if err != nil {
return
}
for _, rd := range due {
su, err := w.Store.SignupByID(ctx, rd.SignupID)
if err != nil {
continue
}
n, err := w.Store.NightByID(ctx, rd.NightID)
if err != nil {
continue
}
subject := fmt.Sprintf("Starts in 1 hour: %s", n.Title)
studioTime, viewerTime := w.renderTimes(n, su.ViewerZone)
body := fmt.Sprintf(
"Hi %s,\n\n%s starts in 1 hour.\n\nStudio time: %s\nYour time: %s\n",
su.Name, n.Title, studioTime, viewerTime,
)
_ = w.Store.QueueReminder(ctx, rd, subject, body)
}
}

// renderTimes formats the reminder's two time lines.
func (w *Worker) renderTimes(n store.Night, viewerZone string) (string, string) {
if w.ReminderTime != nil {
return w.ReminderTime(n, viewerZone)
}
return formatTime(n.StartsAt, "UTC"), formatTime(n.StartsAt, viewerZone)
}
