package mailer

import (
	"context"
	"sync/atomic"
	"time"

	"github.com/cinderlatch/holdfast/internal/calendar"
	"github.com/cinderlatch/holdfast/internal/clockx"
	"github.com/cinderlatch/holdfast/internal/store"
)

// EmailStatus values the sign-up response publishes.
const (
	StatusSent            = "sent"
	StatusQueued          = "queued"
	StatusAlreadySignedUp = "already_signed_up"
)

// Outbox queues every email in Postgres and drains it, so a queued email sends
// exactly once once mail returns.
type Outbox struct {
	st    *store.Store
	mail  *Mailer
	clock *clockx.Clock

	queued atomic.Int64
}

// NewOutbox builds the outbox worker.
func NewOutbox(st *store.Store, m *Mailer, clock *clockx.Clock) *Outbox {
	return &Outbox{st: st, mail: m, clock: clock}
}

// QueuedCount reports how many emails are still waiting.
func (o *Outbox) QueuedCount() int { return int(o.queued.Load()) }

// QueueAndSend stores an email and tries to send it at once. It reports the
// status the sign-up response publishes.
func (o *Outbox) QueueAndSend(ctx context.Context, c Composed) string {
	id, created, err := o.st.QueueEmail(ctx, store.OutboxEmail{
		DedupeKey: c.DedupeKey, Kind: c.Kind, To: c.To,
		Subject: c.Subject, Body: c.Body, DueAt: o.clock.Now(),
	})
	if err != nil || !created {
		return StatusQueued
	}
	if !o.mail.Up() {
		o.refreshCount(ctx)
		return StatusQueued
	}
	if err := o.mail.Send(c.To, c.Subject, c.Body); err != nil {
		o.refreshCount(ctx)
		return StatusQueued
	}
	if _, err := o.st.MarkEmailSent(ctx, id, o.clock.Now()); err != nil {
		return StatusQueued
	}
	return StatusSent
}

// Run drives the reminder schedule and drains the queue until the context ends.
func (o *Outbox) Run(ctx context.Context, zone *time.Location) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			o.scheduleReminders(ctx, zone)
			o.drain(ctx)
			o.refreshCount(ctx)
		}
	}
}

// scheduleReminders queues the reminder for every sign-up whose reminder has
// fallen due on the wall clock.
func (o *Outbox) scheduleReminders(ctx context.Context, zone *time.Location) {
	now := o.clock.Now()
	candidates, err := o.st.SignupsAwaitingReminder(ctx)
	if err != nil {
		return
	}
	for _, candidate := range candidates {
		night := calendar.Build(candidate.Night, zone, now)
		due := night.StartsAtTime().Add(-ReminderLead)
		if now.Before(due) {
			continue
		}
		composed := Reminder(candidate.Signup, night, zone.String())
		if _, _, err := o.st.QueueEmail(ctx, store.OutboxEmail{
			DedupeKey: composed.DedupeKey, Kind: composed.Kind, To: composed.To,
			Subject: composed.Subject, Body: composed.Body, DueAt: due,
		}); err != nil {
			return
		}
	}
}

// drain sends every due email. A row is marked sent only after mail accepted it,
// and only the first marking wins, so nothing sends twice.
func (o *Outbox) drain(ctx context.Context) {
	if !o.mail.Up() {
		return
	}
	due, err := o.st.DueEmails(ctx, o.clock.Now(), 50)
	if err != nil {
		return
	}
	for _, email := range due {
		if err := o.mail.Send(email.To, email.Subject, email.Body); err != nil {
			return
		}
		if _, err := o.st.MarkEmailSent(ctx, email.ID, o.clock.Now()); err != nil {
			return
		}
	}
}

func (o *Outbox) refreshCount(ctx context.Context) {
	if n, err := o.st.QueuedEmailCount(ctx); err == nil {
		o.queued.Store(int64(n))
	}
}
