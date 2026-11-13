package core

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/smtp"
	"time"

	"github.com/jackc/pgx/v5"
)

// Tick applies every due timer. Every read and action runs it first, so no
// answer is ever stale.
func (a *App) Tick(ctx context.Context) error {
	if !a.Ready() {
		return nil
	}
	a.Lock()
	defer a.Unlock()
	return a.applyDueTimers(ctx)
}

// applyDueTimers walks each due timer in deadline order, stamping each with its
// own deadline, so a jump of the clock walks every step in turn. The caller
// holds the domain lock.
func (a *App) applyDueTimers(ctx context.Context) error {
	now := a.Clock.Now()
	for i := 0; i < 2000; i++ {
		inc, kind, deadline, err := a.nextDueTimer(ctx, now)
		if err != nil {
			return err
		}
		if inc == nil {
			break
		}
		switch kind {
		case "escalation":
			if err := a.escalateDue(ctx, inc, deadline); err != nil {
				return err
			}
		case "ack_timeout":
			if err := a.returnToTriggered(ctx, inc, deadline, "ack_timed_out", txtAckTimedOut(inc.Number)); err != nil {
				return err
			}
		case "snooze":
			if err := a.returnToTriggered(ctx, inc, deadline, "snooze_ended", txtSnoozeEnded(inc.Number)); err != nil {
				return err
			}
		case "auto_resolve":
			if err := a.closeIncident(ctx, inc, deadline, "Auto-resolved", "Switchlamp", "auto_resolved",
				txtAutoResolved(inc.Number)); err != nil {
				return err
			}
			a.afterIncidentChange(ctx, inc, txtAutoResolved(inc.Number), "incident.resolved")
		}
	}
	if err := a.applyHandoffs(ctx); err != nil {
		return err
	}
	return a.sendDueSteps(ctx, now)
}

// nextDueTimer answers the earliest timer that has already fired.
func (a *App) nextDueTimer(ctx context.Context, now time.Time) (*incidentRow, string, time.Time, error) {
	row := a.pool.QueryRow(ctx, `SELECT `+incidentColumns+`, kind, deadline FROM (
		SELECT i.*, 'escalation' AS kind, i.escalation_due_at AS deadline FROM incidents i
			WHERE i.status='triggered' AND i.urgency='high' AND i.escalation_finished = false AND i.escalation_due_at <= $1
		UNION ALL
		SELECT i.*, 'ack_timeout', i.ack_deadline_at FROM incidents i
			WHERE i.status='acknowledged' AND i.ack_deadline_at <= $1
		UNION ALL
		SELECT i.*, 'snooze', i.snoozed_until FROM incidents i
			WHERE i.status='snoozed' AND i.snoozed_until <= $1
		UNION ALL
		SELECT i.*, 'auto_resolve', i.auto_resolve_at FROM incidents i
			WHERE i.status <> 'resolved' AND i.auto_resolve_at <= $1
	) due ORDER BY deadline, number LIMIT 1`, now)
	var kind string
	var deadline time.Time
	inc, err := scanIncidentWithExtras(row, &kind, &deadline)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", time.Time{}, nil
	}
	if err != nil {
		return nil, "", time.Time{}, fmt.Errorf("read due timer: %w", err)
	}
	return inc, kind, deadline.UTC(), nil
}

func scanIncidentWithExtras(row pgx.Row, kind *string, deadline *time.Time) (*incidentRow, error) {
	var r incidentRow
	var snapshot []byte
	if err := row.Scan(&r.ID, &r.Number, &r.ServiceID, &r.Title, &r.Status, &r.Urgency, &r.Level, &r.Cycle,
		&snapshot, &r.EscalationDueAt, &r.EscalationFinished, &r.AckDeadlineAt, &r.SnoozedUntil, &r.SnoozedBy,
		&r.AutoResolveMinutes, &r.AutoResolveAt, &r.OpenedAt, &r.AcknowledgedAt, &r.AcknowledgedBy, &r.DecidedBy,
		&r.DecidedAt, &r.ResolvedAt, &r.ResolveReason, &r.ResolvedBy, &r.MergedInto, &r.GroupingUntil,
		&r.HoldersPinned, &r.Version,
		kind, deadline); err != nil {
		return nil, err
	}
	if err := jsonInto(snapshot, &r.Snapshot); err != nil {
		return nil, err
	}
	r.OpenedAt = r.OpenedAt.UTC()
	return &r, nil
}

// escalateDue moves an incident on at its level's timeout.
func (a *App) escalateDue(ctx context.Context, inc *incidentRow, at time.Time) error {
	if !advanceLevel(inc) {
		inc.EscalationFinished = true
		inc.EscalationDueAt = nil
		if err := a.saveIncident(ctx, inc); err != nil {
			return err
		}
		a.announceIncident(ctx, inc, "")
		return nil
	}
	if err := a.runEscalation(ctx, inc, at, false); err != nil {
		return err
	}
	if err := a.saveIncident(ctx, inc); err != nil {
		return err
	}
	names, err := a.holderNames(ctx, inc.ID)
	if err != nil {
		return err
	}
	a.afterIncidentChange(ctx, inc, txtEscalated(inc.Number, names), "incident.escalated")
	return nil
}

// returnToTriggered brings an incident back from acknowledged or snoozed,
// restarting the current level's full timeout and notifying the holders again.
func (a *App) returnToTriggered(ctx context.Context, inc *incidentRow, at time.Time, kind, text string) error {
	inc.Status = "triggered"
	inc.AckDeadlineAt = nil
	inc.SnoozedUntil = nil
	inc.SnoozedBy = nil
	inc.AcknowledgedAt = nil
	inc.AcknowledgedBy = nil
	if inc.Urgency == "high" && !inc.EscalationFinished {
		inc.EscalationDueAt = ptr(at.Add(levelTimeout(inc.Snapshot, inc.Level)))
	}
	if err := a.renotifyHolders(ctx, inc, at); err != nil {
		return err
	}
	if _, err := a.addEntry(ctx, inc.ID, at, kind, "Switchlamp", text, nil); err != nil {
		return err
	}
	if err := a.saveIncident(ctx, inc); err != nil {
		return err
	}
	a.afterIncidentChange(ctx, inc, text, "incident.unacknowledged")
	return nil
}

func (a *App) renotifyHolders(ctx context.Context, inc *incidentRow, at time.Time) error {
	if err := a.cancelSteps(ctx, inc.ID, nil); err != nil {
		return err
	}
	holders, err := a.holderRefs(ctx, inc.ID)
	if err != nil {
		return err
	}
	for _, holder := range holders {
		assignment := newID()
		if _, err := a.pool.Exec(ctx, `UPDATE incident_holders SET assignment_id=$1, assigned_at=$2
			WHERE incident_id=$3 AND person_id=$4`, assignment, at, inc.ID, holder.ID); err != nil {
			return fmt.Errorf("refresh assignment: %w", err)
		}
		if err := a.scheduleSteps(ctx, inc, holder.ID, assignment, at); err != nil {
			return err
		}
	}
	return nil
}

func (a *App) timerLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(250 * time.Millisecond):
		}
		if err := a.Tick(ctx); err != nil {
			log.Printf("timers: %v", err)
		}
	}
}

// countdownLoop sends the server's own countdown values at least once a second.
func (a *App) countdownLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Second):
		}
		now := a.Clock.Now()
		data := map[string]any{"now": now}
		rows, err := a.pool.Query(ctx, `SELECT `+incidentColumns+` FROM incidents WHERE status <> 'resolved'`)
		if err != nil {
			continue
		}
		var open []*incidentRow
		for rows.Next() {
			if inc, err := scanIncident(rows); err == nil {
				open = append(open, inc)
			}
		}
		rows.Close()
		incidents := []map[string]any{}
		for _, inc := range open {
			countdown := countdownFor(inc, now)
			holders, err := a.holderRefs(ctx, inc.ID)
			if err != nil {
				continue
			}
			names := make([]string, 0, len(holders))
			for _, h := range holders {
				names = append(names, h.Name)
			}
			incidents = append(incidents, map[string]any{
				"id": inc.ID, "number": inc.Number, "kind": countdown.Kind, "due_at": countdown.DueAt,
				"remaining_seconds": countdown.RemainingSeconds, "label": countdown.Label,
				"level": inc.Level, "cycle": inc.Cycle, "holder": joinNames(names), "status": inc.Status,
			})
		}
		data["incidents"] = incidents

		schedules, err := a.ListSchedules(ctx)
		if err == nil {
			oncall := []map[string]any{}
			for _, s := range schedules {
				state, err := a.OnCall(ctx, s.ID, now)
				if err != nil {
					continue
				}
				remaining := 0
				if state.Until != nil {
					remaining = int(state.Until.Sub(now) / time.Second)
				}
				holder := "Nobody"
				if state.Holder != nil {
					holder = state.Holder.Name
				}
				oncall = append(oncall, map[string]any{
					"schedule_id": s.ID, "holder": holder, "until": state.Until, "remaining_seconds": remaining,
				})
			}
			data["oncall"] = oncall
		}
		integrations, err := a.ListIntegrations(ctx)
		if err == nil {
			counters := []map[string]any{}
			for _, integration := range integrations {
				counter := a.Counter(ctx, integration.RoutingKey)
				counters = append(counters, map[string]any{
					"integration_id": integration.ID, "count": counter.Count,
					"retry_after": counter.RetryAfter, "available": counter.Available,
				})
			}
			data["integrations"] = counters
		}
		a.tick("countdown", data)
	}
}

// queueMail holds a message until the mail server accepts it.
func (a *App) queueMail(ctx context.Context, to, subject, body string, stepID *string, due time.Time) error {
	if _, err := a.pool.Exec(ctx, `INSERT INTO mail_outbox (id, to_email, subject, body, due_at, status, step_id, created_at)
		VALUES ($1,$2,$3,$4,$5,'queued',$6,$5)`, newID(), to, subject, body, due, stepID); err != nil {
		return fmt.Errorf("queue mail: %w", err)
	}
	return nil
}

// mailLoop sends what is queued. Mail that cannot go stays queued and is tried
// again every 5 real seconds.
func (a *App) mailLoop(ctx context.Context) {
	for {
		wait := time.Second
		if err := a.sendQueuedMail(ctx); err != nil {
			log.Printf("mail: %v", err)
		}
		if !a.mailUp.Load() {
			wait = 5 * time.Second
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
	}
}

func (a *App) sendQueuedMail(ctx context.Context) error {
	if !a.Ready() {
		return nil
	}
	rows, err := a.pool.Query(ctx, `SELECT id, to_email, subject, body, step_id FROM mail_outbox
		WHERE status='queued' ORDER BY due_at, created_at LIMIT 50`)
	if err != nil {
		return fmt.Errorf("read mail outbox: %w", err)
	}
	type queued struct {
		id, to, subject, body string
		stepID                *string
	}
	var messages []queued
	for rows.Next() {
		var m queued
		if err := rows.Scan(&m.id, &m.to, &m.subject, &m.body, &m.stepID); err != nil {
			rows.Close()
			return fmt.Errorf("read queued mail: %w", err)
		}
		messages = append(messages, m)
	}
	rows.Close()
	for _, m := range messages {
		if err := a.sendMail(m.to, m.subject, m.body); err != nil {
			a.mailUp.Store(false)
			return nil
		}
		a.mailUp.Store(true)
		now := a.Clock.Now()
		if _, err := a.pool.Exec(ctx, `UPDATE mail_outbox SET status='sent', sent_at=$1 WHERE id=$2`, now, m.id); err != nil {
			return fmt.Errorf("mark mail sent: %w", err)
		}
		if m.stepID != nil {
			if _, err := a.pool.Exec(ctx, `UPDATE notification_steps SET status='sent', sent_at=$1
				WHERE id=$2 AND status='queued'`, now, *m.stepID); err != nil {
				return fmt.Errorf("mark step sent: %w", err)
			}
			var incidentID string
			if err := a.pool.QueryRow(ctx, `SELECT incident_id FROM notification_steps WHERE id=$1`, *m.stepID).Scan(&incidentID); err == nil {
				a.publish(ctx, "incident", map[string]any{"incident_id": incidentID, "announce": ""})
			}
		}
	}
	return nil
}

func (a *App) sendMail(to, subject, body string) error {
	addr := net.JoinHostPort(a.Cfg.SMTPHost, fmt.Sprint(a.Cfg.SMTPPort))
	from := a.Cfg.MailFrom
	message := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n%s",
		from, to, subject, body)
	if err := smtp.SendMail(addr, nil, mailAddress(from), []string{to}, []byte(message)); err != nil {
		return fmt.Errorf("send mail: %w", err)
	}
	return nil
}

func mailAddress(from string) string {
	start := -1
	for i, r := range from {
		if r == '<' {
			start = i + 1
		}
		if r == '>' && start >= 0 {
			return from[start:i]
		}
	}
	return from
}

func (a *App) mailProbe(ctx context.Context) {
	for {
		conn, err := net.DialTimeout("tcp", net.JoinHostPort(a.Cfg.SMTPHost, fmt.Sprint(a.Cfg.SMTPPort)), 2*time.Second)
		if err == nil {
			a.mailUp.Store(true)
			_ = conn.Close()
		} else {
			a.mailUp.Store(false)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(5 * time.Second):
		}
	}
}

// QueuedStepCount counts notification steps waiting for mail to return.
func (a *App) QueuedStepCount(ctx context.Context) (int, error) {
	var n int
	if err := a.pool.QueryRow(ctx, `SELECT count(*) FROM mail_outbox WHERE status='queued' AND step_id IS NOT NULL`).Scan(&n); err != nil {
		return 0, fmt.Errorf("count queued steps: %w", err)
	}
	return n, nil
}

// QueuedSubscriberCount counts subscriber notices waiting for mail to return.
func (a *App) QueuedSubscriberCount(ctx context.Context) (int, error) {
	var n int
	if err := a.pool.QueryRow(ctx, `SELECT count(*) FROM mail_outbox WHERE status='queued' AND step_id IS NULL`).Scan(&n); err != nil {
		return 0, fmt.Errorf("count queued notices: %w", err)
	}
	return n, nil
}

func (a *App) MailUp() bool     { return a.mailUp.Load() }
func (a *App) QueueUp() bool    { return a.queueUp.Load() }
func (a *App) ReceiverUp() bool { return a.recvUp.Load() }
