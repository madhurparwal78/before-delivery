// Package engine applies due timers, runs escalation, and keeps incidents,
// alerts, steps and timelines consistent under the edge rule.
package engine

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"switchlamp/internal/clock"
	"switchlamp/internal/domain"
	"switchlamp/internal/store"
)

// Engine owns the domain rules that involve the clock. The serve layer sets
// the hooks so decisions reach sockets, mail and webhooks without the engine
// knowing about them.
type Engine struct {
	Store *store.Store
	Clock *clock.Clock

	OnTimeline    func(ctx context.Context, incidentID string, e domain.TimelineEntry)
	OnIncident     func(ctx context.Context, incident *domain.Incident)
	OnWebhook      func(ctx context.Context, incident *domain.Incident, kind string, at time.Time)
	OnOncallChange func(ctx context.Context)
}

// Now returns the server clock truncated to whole seconds.
func (e *Engine) Now() time.Time { return e.Clock.Now().Truncate(time.Second) }

// ApplyDue runs every due timer in deadline order, each stamped with its own
// deadline, so a two-hour jump walks each escalation step in turn.
func (e *Engine) ApplyDue(ctx context.Context, now time.Time) error {
	if err := e.endSnoozes(ctx, now); err != nil {
		return err
	}
	if err := e.ackTimeouts(ctx, now); err != nil {
		return err
	}
	if err := e.escalate(ctx, now); err != nil {
		return err
	}
	if err := e.autoResolve(ctx, now); err != nil {
		return err
	}
	return e.expireWaiting(ctx, now)
}

// RunTimerPass applies due timers once, for the serve loop's every-second tick.
func (e *Engine) RunTimerPass(ctx context.Context) error {
	return e.ApplyDue(ctx, e.Now())
}

// endSnoozes moves snoozed incidents whose snooze ended back to triggered.
func (e *Engine) endSnoozes(ctx context.Context, now time.Time) error {
	due, err := selectDue(ctx, e.Store, `SELECT id, snoozed_until FROM incidents
		WHERE status = 'snoozed' AND snoozed_until IS NOT NULL AND snoozed_until <= $1
		ORDER BY snoozed_until`, now)
	if err != nil {
		return err
	}
	for _, r := range due {
		deadline := r.At.Truncate(time.Second)
		if _, err := e.Store.Pool().Exec(ctx, `UPDATE incidents SET status = 'triggered', snoozed_until = NULL,
			version = version + 1 WHERE id = $1 AND status = 'snoozed'`, r.ID); err != nil {
			return err
		}
		inc, err := e.Store.Incident(ctx, r.ID)
		if err != nil {
			return err
		}
		if err := e.writeTimeline(ctx, inc, deadline, domain.KindSnoozeEnded, "Switchlamp",
			domain.TimelineText(domain.KindSnoozeEnded, inc)); err != nil {
			return err
		}
		// Returning to triggered restarts the current level's full timeout and
		// notifies the holders again.
		if err := e.notifyHolders(ctx, inc, deadline); err != nil {
			return err
		}
		if inc.Urgency == "high" {
			esc := deadline.Add(time.Duration(e.levelTimeout(inc, inc.Level)) * time.Minute)
			if _, err := e.Store.Pool().Exec(ctx, `UPDATE incidents SET escalate_at = $2 WHERE id = $1`, inc.ID, esc); err != nil {
				return err
			}
		}
		if err := e.sendWebhook(ctx, inc, "incident.unacknowledged", deadline); err != nil {
			return err
		}
	}
	return nil
}

// ackTimeouts returns acknowledged incidents whose acknowledge deadline passed.
func (e *Engine) ackTimeouts(ctx context.Context, now time.Time) error {
	due, err := selectDue(ctx, e.Store, `SELECT id, ack_deadline FROM incidents
		WHERE status = 'acknowledged' AND ack_deadline IS NOT NULL AND ack_deadline <= $1
		ORDER BY ack_deadline`, now)
	if err != nil {
		return err
	}
	for _, r := range due {
		deadline := r.At.Truncate(time.Second)
		if _, err := e.Store.Pool().Exec(ctx, `UPDATE incidents SET status = 'triggered', ack_deadline = NULL,
			version = version + 1 WHERE id = $1 AND status = 'acknowledged'`, r.ID); err != nil {
			return err
		}
		inc, err := e.Store.Incident(ctx, r.ID)
		if err != nil {
			return err
		}
		if err := e.writeTimeline(ctx, inc, deadline, domain.KindAckTimedOut, "Switchlamp",
			domain.TimelineText(domain.KindAckTimedOut, inc)); err != nil {
			return err
		}
		if err := e.notifyHolders(ctx, inc, deadline); err != nil {
			return err
		}
		if inc.Urgency == "high" {
			esc := deadline.Add(time.Duration(e.levelTimeout(inc, inc.Level)) * time.Minute)
			if _, err := e.Store.Pool().Exec(ctx, `UPDATE incidents SET escalate_at = $2 WHERE id = $1`, inc.ID, esc); err != nil {
				return err
			}
		}
		if err := e.sendWebhook(ctx, inc, "incident.unacknowledged", deadline); err != nil {
			return err
		}
	}
	return nil
}

type dueRow struct {
	ID string
	At time.Time
}

func selectDue(ctx context.Context, s *store.Store, q string, now time.Time) ([]dueRow, error) {
	rows, err := s.Pool().Query(ctx, q, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []dueRow
	for rows.Next() {
		var r dueRow
		if err := rows.Scan(&r.ID, &r.At); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// escalate moves incidents through their levels and repeats.
func (e *Engine) escalate(ctx context.Context, now time.Time) error {
	due, err := selectDue(ctx, e.Store, `SELECT id, escalate_at FROM incidents
		WHERE status = 'triggered' AND urgency = 'high' AND escalation_finished = false
		AND escalate_at IS NOT NULL AND escalate_at <= $1
		ORDER BY escalate_at`, now)
	if err != nil {
		return err
	}
	for _, r := range due {
		if err := e.escalateOne(ctx, r.ID, r.At.Truncate(time.Second)); err != nil {
			return err
		}
	}
	return nil
}

// escalateOne walks one incident forward one step, skipping empty levels in
// the same second.
func (e *Engine) escalateOne(ctx context.Context, id string, at time.Time) error {
	for {
		inc, err := e.Store.Incident(ctx, id)
		if err != nil {
			return err
		}
		if inc.Status != domain.StatusTriggered || inc.Urgency != "high" || inc.EscalationFinished {
			return nil
		}
		snap := inc.PolicySnapshot
		if len(snap.Levels) == 0 {
			return nil
		}
		next := inc.Level + 1
		cycle := inc.Cycle
		if next > len(snap.Levels) {
			if cycle >= snap.Repeats {
				// Escalation finished: it stays with the last level's holders.
				if _, err := e.Store.Pool().Exec(ctx, `UPDATE incidents SET escalation_finished = true, escalate_at = NULL WHERE id = $1`, id); err != nil {
					return err
				}
				if fin, err := e.Store.Incident(ctx, id); err == nil {
					e.emit(ctx, fin)
				}
				return nil
			}
			next = 1
			cycle++
		}
		holders, empty, err := e.levelHolders(ctx, snap.Levels[next-1], at)
		if err != nil {
			return err
		}
		if empty {
			// A level with nobody on call is skipped in the same second.
			if _, err := e.Store.Pool().Exec(ctx, `UPDATE incidents SET level = $2, cycle = $3, escalate_at = $4 WHERE id = $1`,
				id, next, cycle, at.Add(time.Duration(e.levelTimeout(inc, next))*time.Minute)); err != nil {
				return err
			}
			continue
		}
		esc := at.Add(time.Duration(e.levelTimeout(inc, next)) * time.Minute)
		holdersJSON, _ := json.Marshal(holders)
		if _, err := e.Store.Pool().Exec(ctx, `UPDATE incidents SET level = $2, cycle = $3, holders = $4, escalate_at = $5,
			version = version + 1 WHERE id = $1`, id, next, cycle, holdersJSON, esc); err != nil {
			return err
		}
		inc, err = e.Store.Incident(ctx, id)
		if err != nil {
			return err
		}
		if err := e.writeTimeline(ctx, inc, at, domain.KindEscalated, "Switchlamp",
			domain.TimelineText(domain.KindEscalated, inc, domain.HolderNames(holders))); err != nil {
			return err
		}
		if err := e.sendWebhook(ctx, inc, "incident.escalated", at); err != nil {
			return err
		}
		e.emit(ctx, inc)
		return nil
	}
}

// autoResolve closes incidents past their auto-resolve deadline.
func (e *Engine) autoResolve(ctx context.Context, now time.Time) error {
	due, err := selectDue(ctx, e.Store, `SELECT id, auto_resolve_at FROM incidents
		WHERE status IN ('triggered','acknowledged') AND auto_resolve_at IS NOT NULL AND auto_resolve_at <= $1
		ORDER BY auto_resolve_at`, now)
	if err != nil {
		return err
	}
	for _, r := range due {
		if err := e.closeAuto(ctx, r.ID, r.At.Truncate(time.Second)); err != nil {
			return err
		}
	}
	return nil
}

func (e *Engine) closeAuto(ctx context.Context, id string, at time.Time) error {
	tag, err := e.Store.Pool().Exec(ctx, `UPDATE incidents SET status = 'resolved', resolve_reason = 'Auto-resolved',
		closed_at = $2, snoozed_until = NULL, ack_deadline = NULL, escalate_at = NULL, version = version + 1
		WHERE id = $1 AND status IN ('triggered','acknowledged')`, id, at)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return nil
	}
	if _, err := e.Store.Pool().Exec(ctx, `UPDATE alerts SET status = 'resolved', resolved_at = $2
		WHERE incident_id = $1 AND status != 'resolved'`, id, at); err != nil {
		return err
	}
	inc, err := e.Store.Incident(ctx, id)
	if err != nil {
		return err
	}
	if err := e.writeTimeline(ctx, inc, at, domain.KindAutoResolved, "Switchlamp",
		domain.TimelineText(domain.KindAutoResolved, inc)); err != nil {
		return err
	}
	if err := e.cancelSteps(ctx, id); err != nil {
		return err
	}
	if err := e.sendWebhook(ctx, inc, "incident.resolved", at); err != nil {
		return err
	}
	e.emit(ctx, inc)
	return nil
}

// expireWaiting turns waiting events past 60 real seconds into dead letters
// and no longer blocks later numbers.
func (e *Engine) expireWaiting(ctx context.Context, now time.Time) error {
	rows, err := e.Store.Pool().Query(ctx, `SELECT routing_key, dedup_key, key_seq, event_id, body FROM waiting_events
		WHERE first_seen < $1 ORDER BY first_seen`, now.Add(-60*time.Second))
	if err != nil {
		return err
	}
	type waitRow struct {
		RoutingKey string
		DedupKey   string
		KeySeq     int
		EventID    string
		Body       string
	}
	var due []waitRow
	for rows.Next() {
		var r waitRow
		if err := rows.Scan(&r.RoutingKey, &r.DedupKey, &r.KeySeq, &r.EventID, &r.Body); err != nil {
			rows.Close()
			return err
		}
		due = append(due, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, r := range due {
		// The first absent key_seq for that key names the reason: the smallest
		// sequence number below this one that neither applied nor waits.
		missing := 1
		for k := 1; k < r.KeySeq; k++ {
			var present bool
			if err := e.Store.Pool().QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM applied_seqs
				WHERE routing_key = $1 AND dedup_key = $2 AND key_seq = $3)`,
				r.RoutingKey, r.DedupKey, k).Scan(&present); err != nil {
				return err
			}
			if !present {
				missing = k
				break
			}
			missing = k + 1
		}
		if err := e.deadLetter(ctx, r.EventID, r.RoutingKey,
			fmt.Sprintf("Earlier event never arrived: key_seq %d.", missing), r.Body); err != nil {
			return err
		}
		if _, err := e.Store.Pool().Exec(ctx, `DELETE FROM waiting_events WHERE routing_key = $1 AND dedup_key = $2 AND key_seq = $3`,
			r.RoutingKey, r.DedupKey, r.KeySeq); err != nil {
			return err
		}
	}
	return nil
}

// deadLetter records a dead letter and queues it on the dead-letter queue.
func (e *Engine) deadLetter(ctx context.Context, eventID, routingKey, reason, raw string) error {
	_, err := e.Store.Pool().Exec(ctx, `INSERT INTO dead_letters (id, event_id, routing_key, reason, raw, attempts, dead_at)
		VALUES ($1,$2,$3,$4,$5,3,now())`, newID(), eventID, routingKey, reason, raw)
	return err
}

// levelHolders resolves a level's targets at an instant. empty reports whether
// the level has nobody on call.
func (e *Engine) levelHolders(ctx context.Context, level domain.PolicyLevel, at time.Time) ([]domain.Holder, bool, error) {
	names, err := e.Store.UserNames(ctx)
	if err != nil {
		return nil, false, err
	}
	seen := map[string]bool{}
	var out []domain.Holder
	for _, t := range level.Targets {
		if t.Type == "person" {
			if name, ok := names[t.ID]; ok && !seen[t.ID] {
				out = append(out, domain.Holder{ID: t.ID, Name: name})
				seen[t.ID] = true
			}
			continue
		}
		// A schedule target resolves to whoever is on call at that second.
		holder, err := e.scheduleHolder(ctx, t.ID, at)
		if err != nil {
			return nil, false, err
		}
		if holder != nil && !seen[holder.ID] {
			out = append(out, *holder)
			seen[holder.ID] = true
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, len(out) == 0, nil
}

// levelTimeout reads a level's timeout from the snapshot.
func (e *Engine) levelTimeout(inc *domain.Incident, level int) int {
	if level < 1 || level > len(inc.PolicySnapshot.Levels) {
		return 30
	}
	t := inc.PolicySnapshot.Levels[level-1].TimeoutMinutes
	if t <= 0 {
		t = 30
	}
	return t
}

// scheduleHolder resolves who is on call for a schedule at an instant.
func (e *Engine) scheduleHolder(ctx context.Context, scheduleID string, at time.Time) (*domain.Holder, error) {
	sc, err := e.Store.Schedule(ctx, scheduleID)
	if err != nil {
		return nil, nil
	}
	names, err := e.Store.UserNames(ctx)
	if err != nil {
		return nil, err
	}
	layers, err := e.Store.Layers(ctx, scheduleID)
	if err != nil {
		return nil, err
	}
	for _, l := range layers {
		l.SetScheduleZone(sc.Zone)
		l.RecordFormat = sc.RecordFormat
	}
	overrides, err := e.Store.Overrides(ctx, scheduleID)
	if err != nil {
		return nil, err
	}
	blocks := domain.FinalSchedule(layers, overrides, at, at.Add(time.Second), names)
	if len(blocks) == 0 {
		return nil, nil
	}
	return blocks[0].Person, nil
}

// writeTimeline stores one entry and announces it.
func (e *Engine) writeTimeline(ctx context.Context, inc *domain.Incident, at time.Time, kind, actor, text string) error {
	id := newID()
	if _, err := e.Store.Pool().Exec(ctx, `INSERT INTO timelines (id, incident_id, at, kind, actor, text)
		VALUES ($1,$2,$3,$4,$5,$6)`, id, inc.ID, at, kind, actor, text); err != nil {
		return err
	}
	entry := domain.TimelineEntry{ID: id, At: at, Kind: kind, Actor: actor, Text: text}
	inc.Timeline = append(inc.Timeline, entry)
	if e.OnTimeline != nil {
		e.OnTimeline(ctx, inc.ID, entry)
	}
	return nil
}

// notifyHolders schedules steps for the current holders of a triggered incident.
func (e *Engine) notifyHolders(ctx context.Context, inc *domain.Incident, at time.Time) error {
	// A step becomes cancelled when the incident leaves triggered or the person
	// stops holding it.
	if err := e.cancelSteps(ctx, inc.ID); err != nil {
		return err
	}
	for _, h := range inc.Holders {
		u, err := e.Store.User(ctx, h.ID)
		if err != nil {
			continue
		}
		// Becoming a holder also writes one in-app step at that second.
		sentAt := at
		if err := e.insertStep(ctx, inc, h, "step", "in_app", at, domain.StepSent, &sentAt); err != nil {
			return err
		}
		if inc.Urgency == "high" {
			for _, d := range u.NotificationDelays {
				due := at.Add(time.Duration(d) * time.Minute)
				if err := e.insertStep(ctx, inc, h, "step", "email", due, domain.StepScheduled, nil); err != nil {
					return err
				}
			}
		} else {
			due := at.Add(time.Duration(u.LowUrgencyDelay) * time.Minute)
			if err := e.insertStep(ctx, inc, h, "low_urgency", "email", due, domain.StepScheduled, nil); err != nil {
				return err
			}
		}
	}
	return nil
}

func (e *Engine) insertStep(ctx context.Context, inc *domain.Incident, h domain.Holder, kind, channel string, due time.Time, status string, sent *time.Time) error {
	_, err := e.Store.Pool().Exec(ctx, `INSERT INTO steps (id, incident_id, person_id, kind, channel, due_at, status, sent_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, newID(), inc.ID, h.ID, kind, channel, due, status, sent)
	return err
}

// cancelSteps cancels every pending step on an incident.
func (e *Engine) cancelSteps(ctx context.Context, incidentID string) error {
	_, err := e.Store.Pool().Exec(ctx, `UPDATE steps SET status = 'cancelled'
		WHERE incident_id = $1 AND status IN ('scheduled','held','queued')`, incidentID)
	return err
}

// emit reports an incident change to the serve layer.
func (e *Engine) emit(ctx context.Context, inc *domain.Incident) {
	if e.OnIncident != nil {
		e.OnIncident(ctx, inc)
	}
}

// sendWebhook hands an event to the serve layer.
func (e *Engine) sendWebhook(ctx context.Context, inc *domain.Incident, kind string, at time.Time) error {
	if e.OnWebhook != nil {
		e.OnWebhook(ctx, inc, kind, at)
	}
	return nil
}

func newID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
