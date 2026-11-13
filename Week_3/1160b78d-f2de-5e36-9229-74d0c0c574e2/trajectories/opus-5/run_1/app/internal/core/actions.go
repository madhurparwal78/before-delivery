package core

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// conflictFor is the body every request that lost a decision receives.
func (a *App) conflictFor(inc *incidentRow) *APIError {
	decision := inc.Status
	by := "Switchlamp"
	if inc.DecidedBy != nil {
		by = *inc.DecidedBy
	}
	at := inc.OpenedAt
	if inc.DecidedAt != nil {
		at = *inc.DecidedAt
	}
	return &APIError{Status: 409, Body: map[string]any{
		"error": "already_decided", "decision": decision, "decided_by": by, "decided_at": at,
	}}
}

func (a *App) markDecision(inc *incidentRow, actor Actor, now time.Time) {
	name := actor.Name()
	inc.DecidedBy = &name
	inc.DecidedAt = &now
}

// Acknowledge moves an incident from triggered to acknowledged, or ends another
// person's snooze.
func (a *App) Acknowledge(ctx context.Context, actor Actor, id string) (*IncidentView, error) {
	a.Lock()
	defer a.Unlock()
	if err := a.applyDueTimers(ctx); err != nil {
		return nil, err
	}
	inc, err := a.loadIncident(ctx, id)
	if err != nil {
		return nil, err
	}
	now := a.Clock.Now()
	switch inc.Status {
	case "triggered":
	case "snoozed":
		if inc.SnoozedBy != nil && actor.IsUser(*inc.SnoozedBy) {
			return nil, a.conflictFor(inc)
		}
		inc.SnoozedUntil = nil
		inc.SnoozedBy = nil
		if inc.AutoResolveMinutes != nil {
			inc.AutoResolveAt = ptr(now.Add(time.Duration(*inc.AutoResolveMinutes) * time.Minute))
		}
	default:
		return nil, a.conflictFor(inc)
	}
	inc.Status = "acknowledged"
	inc.AcknowledgedAt = &now
	name := actor.Name()
	inc.AcknowledgedBy = &name
	a.markDecision(inc, actor, now)
	inc.EscalationDueAt = nil
	service, err := a.GetService(ctx, inc.ServiceID)
	if err != nil {
		return nil, err
	}
	if service.AckTimeoutMinutes != nil {
		inc.AckDeadlineAt = ptr(now.Add(time.Duration(*service.AckTimeoutMinutes) * time.Minute))
	} else {
		inc.AckDeadlineAt = nil
	}
	if err := a.cancelSteps(ctx, inc.ID, nil); err != nil {
		return nil, err
	}
	if _, err := a.addEntry(ctx, inc.ID, now, "acknowledged", name, txtAcknowledged(inc.Number, name), nil); err != nil {
		return nil, err
	}
	if err := a.saveIncident(ctx, inc); err != nil {
		return nil, err
	}
	a.afterIncidentChange(ctx, inc, txtAcknowledged(inc.Number, name), "incident.acknowledged")
	return a.incidentView(ctx, inc)
}

// Snooze holds an acknowledged incident for a preset or a custom time.
func (a *App) Snooze(ctx context.Context, actor Actor, id string, presetHours int, until *time.Time) (*IncidentView, error) {
	a.Lock()
	defer a.Unlock()
	if err := a.applyDueTimers(ctx); err != nil {
		return nil, err
	}
	inc, err := a.loadIncident(ctx, id)
	if err != nil {
		return nil, err
	}
	now := a.Clock.Now()
	if inc.Status == "triggered" {
		return nil, &APIError{Status: 409, Body: map[string]any{
			"error": "illegal_transition", "message": "Only an acknowledged incident can be snoozed.",
		}}
	}
	if inc.Status != "acknowledged" {
		return nil, a.conflictFor(inc)
	}
	var end time.Time
	switch {
	case presetHours != 0:
		if !contains([]string{"1", "4", "8", "24"}, fmt.Sprint(presetHours)) {
			return nil, errFields("preset_hours", "Choose 1, 4, 8 or 24 hours.")
		}
		end = now.Add(time.Duration(presetHours) * time.Hour)
	case until != nil:
		end = until.UTC().Truncate(time.Second)
		if !end.After(now) {
			return nil, errFields("until", "Choose a time after now.")
		}
		if end.Sub(now) > 168*time.Hour {
			return nil, errFields("until", "Snooze for at most 168 hours.")
		}
	default:
		return nil, errFields("until", "Choose a time after now.")
	}
	inc.Status = "snoozed"
	inc.SnoozedUntil = &end
	if actor.User != nil {
		inc.SnoozedBy = &actor.User.ID
	}
	inc.AckDeadlineAt = nil
	if inc.AutoResolveMinutes != nil {
		inc.AutoResolveAt = ptr(end.Add(time.Duration(*inc.AutoResolveMinutes) * time.Minute))
	}
	a.markDecision(inc, actor, now)
	if err := a.cancelSteps(ctx, inc.ID, nil); err != nil {
		return nil, err
	}
	name := actor.Name()
	text := txtSnoozed(inc.Number, name, end)
	if _, err := a.addEntry(ctx, inc.ID, now, "snoozed", name, text, nil); err != nil {
		return nil, err
	}
	if err := a.saveIncident(ctx, inc); err != nil {
		return nil, err
	}
	a.afterIncidentChange(ctx, inc, text, "incident.snoozed")
	return a.incidentView(ctx, inc)
}

// Resolve closes an incident, and its alerts with it.
func (a *App) Resolve(ctx context.Context, actor Actor, id string) (*IncidentView, error) {
	a.Lock()
	defer a.Unlock()
	if err := a.applyDueTimers(ctx); err != nil {
		return nil, err
	}
	inc, err := a.loadIncident(ctx, id)
	if err != nil {
		return nil, err
	}
	if inc.Status == "resolved" {
		return nil, a.conflictFor(inc)
	}
	now := a.Clock.Now()
	name := actor.Name()
	if err := a.closeIncident(ctx, inc, now, "Resolved", name, "resolved", txtResolved(inc.Number, name)); err != nil {
		return nil, err
	}
	a.afterIncidentChange(ctx, inc, txtResolved(inc.Number, name), "incident.resolved")
	return a.incidentView(ctx, inc)
}

func (a *App) closeIncident(ctx context.Context, inc *incidentRow, now time.Time, reason, actorName, kind, text string) error {
	inc.Status = "resolved"
	inc.ResolvedAt = &now
	inc.ResolveReason = &reason
	inc.ResolvedBy = &actorName
	inc.DecidedBy = &actorName
	inc.DecidedAt = &now
	inc.EscalationDueAt = nil
	inc.AckDeadlineAt = nil
	inc.SnoozedUntil = nil
	inc.AutoResolveAt = nil
	inc.GroupingUntil = nil
	if err := a.cancelSteps(ctx, inc.ID, nil); err != nil {
		return err
	}
	if _, err := a.pool.Exec(ctx, `UPDATE alerts SET status='resolved', resolved_at=$1 WHERE incident_id=$2 AND status <> 'resolved'`,
		now, inc.ID); err != nil {
		return fmt.Errorf("resolve alerts: %w", err)
	}
	if _, err := a.addEntry(ctx, inc.ID, now, kind, actorName, text, nil); err != nil {
		return err
	}
	return a.saveIncident(ctx, inc)
}

// afterIncidentChange clears the matching caches, tells every open screen and
// sends the subscribed webhook event.
func (a *App) afterIncidentChange(ctx context.Context, inc *incidentRow, announce, eventType string) {
	a.clearStatusCache(ctx)
	a.clearAnalyticsCache(ctx)
	a.announceIncident(ctx, inc, announce)
	a.publishStatus(ctx)
	if eventType != "" {
		a.emitWebhook(ctx, inc, eventType)
	}
}

// Reassign moves an incident to another person or service.
func (a *App) Reassign(ctx context.Context, actor Actor, id string, personID, serviceID *string) (*IncidentView, error) {
	a.Lock()
	defer a.Unlock()
	if err := a.applyDueTimers(ctx); err != nil {
		return nil, err
	}
	if (personID == nil) == (serviceID == nil) {
		return nil, errFields("person_id", "Choose either a person or a service.")
	}
	inc, err := a.loadIncident(ctx, id)
	if err != nil {
		return nil, err
	}
	if inc.Status == "resolved" {
		return nil, a.conflictFor(inc)
	}
	now := a.Clock.Now()
	if personID != nil {
		holders, err := a.holderRefs(ctx, inc.ID)
		if err != nil {
			return nil, err
		}
		if len(holders) == 1 && holders[0].ID == *personID {
			return nil, errFields("person_id", "This person already holds the incident.")
		}
		if _, err := a.UserByID(ctx, *personID); err != nil {
			return nil, errFields("person_id", "Choose a listed person.")
		}
		if err := a.setHolders(ctx, inc, []string{*personID}, now, true, ""); err != nil {
			return nil, err
		}
		// A reassign to a person holds that person until escalation moves on.
		inc.HoldersPinned = true
		if !inc.EscalationFinished && inc.Urgency == "high" {
			inc.EscalationDueAt = ptr(now.Add(levelTimeout(inc.Snapshot, inc.Level)))
		}
	} else {
		if *serviceID == inc.ServiceID {
			return nil, errFields("service_id", "The incident is already on this service.")
		}
		service, err := a.GetService(ctx, *serviceID)
		if err != nil {
			return nil, errFields("service_id", "Choose a listed service.")
		}
		if _, err := a.pool.Exec(ctx, `INSERT INTO incident_impacted (incident_id, service_id) VALUES ($1,$2)
			ON CONFLICT DO NOTHING`, inc.ID, inc.ServiceID); err != nil {
			return nil, fmt.Errorf("record impacted service: %w", err)
		}
		snapshot, err := a.policySnapshotFor(ctx, service.ID)
		if err != nil {
			return nil, err
		}
		inc.ServiceID = service.ID
		inc.Snapshot = snapshot
		inc.Level = 1
		inc.Cycle = 0
		inc.EscalationFinished = false
		if _, err := a.pool.Exec(ctx, `UPDATE alerts SET service_id=$1 WHERE incident_id=$2`, service.ID, inc.ID); err != nil {
			return nil, fmt.Errorf("move alerts: %w", err)
		}
		if inc.Urgency == "high" {
			if err := a.runEscalation(ctx, inc, now, true); err != nil {
				return nil, err
			}
		} else if err := a.assignFirstLevel(ctx, inc, now); err != nil {
			return nil, err
		}
	}
	wasSnoozed := inc.Status == "snoozed"
	inc.Status = "triggered"
	inc.AckDeadlineAt = nil
	inc.SnoozedUntil = nil
	inc.SnoozedBy = nil
	inc.AcknowledgedAt = nil
	inc.AcknowledgedBy = nil
	if wasSnoozed && inc.AutoResolveMinutes != nil {
		inc.AutoResolveAt = ptr(now.Add(time.Duration(*inc.AutoResolveMinutes) * time.Minute))
	}
	a.markDecision(inc, actor, now)
	names, err := a.holderNames(ctx, inc.ID)
	if err != nil {
		return nil, err
	}
	text := txtReassigned(inc.Number, names, actor.Name())
	if _, err := a.addEntry(ctx, inc.ID, now, "reassigned", actor.Name(), text, nil); err != nil {
		return nil, err
	}
	if err := a.saveIncident(ctx, inc); err != nil {
		return nil, err
	}
	a.afterIncidentChange(ctx, inc, text, "incident.reassigned")
	return a.incidentView(ctx, inc)
}

// Merge moves every source's alerts onto one open target.
func (a *App) Merge(ctx context.Context, actor Actor, targetID string, sourceIDs []string) (*IncidentView, error) {
	a.Lock()
	defer a.Unlock()
	if err := a.applyDueTimers(ctx); err != nil {
		return nil, err
	}
	target, err := a.loadIncident(ctx, targetID)
	if err != nil {
		return nil, err
	}
	if target.Status == "resolved" {
		return nil, errCode(409, "merge_target_resolved")
	}
	now := a.Clock.Now()
	var sources []*incidentRow
	for _, id := range sourceIDs {
		if id == targetID {
			return nil, errFields("source_ids", "An incident cannot merge into itself.")
		}
		source, err := a.loadIncident(ctx, id)
		if err != nil {
			return nil, err
		}
		if source.Status == "resolved" {
			return nil, &APIError{Status: 409, Body: map[string]any{"error": "merge_source_resolved", "number": source.Number}}
		}
		sources = append(sources, source)
	}
	var total int
	if err := a.pool.QueryRow(ctx, `SELECT count(*) FROM alerts WHERE incident_id = ANY($1)`,
		append([]string{targetID}, sourceIDs...)).Scan(&total); err != nil {
		return nil, fmt.Errorf("count alerts: %w", err)
	}
	if total > 1000 {
		return nil, errFields("source_ids", "An incident can hold at most 1000 alerts.")
	}
	for _, source := range sources {
		if _, err := a.pool.Exec(ctx, `UPDATE alerts SET incident_id=$1 WHERE incident_id=$2`, target.ID, source.ID); err != nil {
			return nil, fmt.Errorf("move alerts: %w", err)
		}
		if _, err := a.pool.Exec(ctx, `UPDATE timeline SET incident_id=$1, from_number=$2 WHERE incident_id=$3`,
			target.ID, source.Number, source.ID); err != nil {
			return nil, fmt.Errorf("move timeline: %w", err)
		}
		if err := a.cancelSteps(ctx, source.ID, nil); err != nil {
			return nil, err
		}
		source.MergedInto = &target.ID
		source.EscalationDueAt = nil
		source.AckDeadlineAt = nil
		source.SnoozedUntil = nil
		source.AutoResolveAt = nil
		source.Status = "resolved"
		source.ResolvedAt = &now
		reason := "Merged"
		source.ResolveReason = &reason
		name := actor.Name()
		source.ResolvedBy = &name
		source.DecidedBy = &name
		source.DecidedAt = &now
		text := txtMerged(source.Number, target.Number, name)
		if _, err := a.addEntry(ctx, target.ID, now, "merged", name, text, ptr(source.Number)); err != nil {
			return nil, err
		}
		if err := a.saveIncident(ctx, source); err != nil {
			return nil, err
		}
		a.afterIncidentChange(ctx, source, text, "incident.merged")
		if err := a.raiseUrgencyFromAlerts(ctx, target, now); err != nil {
			return nil, err
		}
	}
	if err := a.saveIncident(ctx, target); err != nil {
		return nil, err
	}
	a.announceIncident(ctx, target, "")
	return a.incidentView(ctx, target)
}

// Split takes one alert off an incident and opens a new incident for it.
func (a *App) Split(ctx context.Context, actor Actor, incidentID, alertID string) (*IncidentView, error) {
	a.Lock()
	defer a.Unlock()
	if err := a.applyDueTimers(ctx); err != nil {
		return nil, err
	}
	inc, err := a.loadIncident(ctx, incidentID)
	if err != nil {
		return nil, err
	}
	if inc.Status == "resolved" {
		return nil, a.conflictFor(inc)
	}
	alerts, err := a.alertsFor(ctx, incidentID)
	if err != nil {
		return nil, err
	}
	if len(alerts) <= 1 {
		return nil, errCode(409, "last_alert")
	}
	var alert *Alert
	for i := range alerts {
		if alerts[i].ID == alertID {
			alert = &alerts[i]
		}
	}
	if alert == nil {
		return nil, errNotFound
	}
	now := a.Clock.Now()
	snapshot, err := a.policySnapshotFor(ctx, alert.ServiceID)
	if err != nil {
		return nil, err
	}
	service, err := a.GetService(ctx, alert.ServiceID)
	if err != nil {
		return nil, err
	}
	fresh, err := a.createIncident(ctx, service, snapshot, alert.Summary, severityUrgency(alert.Severity), now)
	if err != nil {
		return nil, err
	}
	if _, err := a.pool.Exec(ctx, `UPDATE alerts SET incident_id=$1 WHERE id=$2`, fresh.ID, alertID); err != nil {
		return nil, fmt.Errorf("move alert: %w", err)
	}
	if fresh.Urgency == "high" {
		if err := a.runEscalation(ctx, fresh, now, true); err != nil {
			return nil, err
		}
	} else if err := a.assignFirstLevel(ctx, fresh, now); err != nil {
		return nil, err
	}
	name := actor.Name()
	text := txtSplit(alert.DedupKey, fresh.Number, name)
	if _, err := a.addEntry(ctx, fresh.ID, now, "split", name, text, nil); err != nil {
		return nil, err
	}
	if _, err := a.addEntry(ctx, inc.ID, now, "split", name, text, nil); err != nil {
		return nil, err
	}
	if err := a.saveIncident(ctx, fresh); err != nil {
		return nil, err
	}
	a.afterIncidentChange(ctx, fresh, text, "incident.triggered")
	a.announceIncident(ctx, inc, "")
	return a.incidentView(ctx, fresh)
}

func severityUrgency(severity string) string {
	if severity == "critical" || severity == "error" {
		return "high"
	}
	return "low"
}

// createIncident writes a new incident with its opened-with policy copy.
func (a *App) createIncident(ctx context.Context, service *Service, snapshot PolicySnapshot, title, urgency string, now time.Time) (*incidentRow, error) {
	var number int64
	if err := a.pool.QueryRow(ctx, `SELECT nextval('incident_numbers')`).Scan(&number); err != nil {
		return nil, fmt.Errorf("take incident number: %w", err)
	}
	inc := &incidentRow{
		ID: newID(), Number: number, ServiceID: service.ID, Title: title, Status: "triggered",
		Urgency: urgency, Level: 1, Cycle: 0, Snapshot: snapshot, OpenedAt: now, Version: 1,
		AutoResolveMinutes: service.AutoResolveMinutes,
	}
	if service.AutoResolveMinutes != nil {
		inc.AutoResolveAt = ptr(now.Add(time.Duration(*service.AutoResolveMinutes) * time.Minute))
	}
	if service.GroupingMode == "window" && service.GroupingMinutes != nil {
		inc.GroupingUntil = ptr(now.Add(time.Duration(*service.GroupingMinutes) * time.Minute))
	}
	snapshotJSON, err := jsonBytes(snapshot)
	if err != nil {
		return nil, err
	}
	if _, err := a.pool.Exec(ctx, `INSERT INTO incidents (id, number, service_id, title, status, urgency, level, cycle,
		policy_snapshot, auto_resolve_minutes, auto_resolve_at, grouping_until, opened_at, version)
		VALUES ($1,$2,$3,$4,'triggered',$5,1,0,$6,$7,$8,$9,$10,1)`,
		inc.ID, number, service.ID, title, urgency, snapshotJSON, inc.AutoResolveMinutes, inc.AutoResolveAt,
		inc.GroupingUntil, now); err != nil {
		return nil, fmt.Errorf("open incident: %w", err)
	}
	return inc, nil
}

// raiseUrgencyFromAlerts raises an incident to the urgency of the most severe
// alert it has held.
func (a *App) raiseUrgencyFromAlerts(ctx context.Context, inc *incidentRow, now time.Time) error {
	alerts, err := a.alertsFor(ctx, inc.ID)
	if err != nil {
		return err
	}
	for _, alert := range alerts {
		if severityUrgency(alert.Severity) == "high" && inc.Urgency != "high" {
			return a.raiseUrgency(ctx, inc, now)
		}
	}
	return nil
}

// raiseUrgency writes the entry and, on a triggered incident, restarts
// escalation and notifies the holders.
func (a *App) raiseUrgency(ctx context.Context, inc *incidentRow, now time.Time) error {
	inc.Urgency = "high"
	if _, err := a.addEntry(ctx, inc.ID, now, "urgency_raised", "Switchlamp", txtUrgencyRaised(inc.Number), nil); err != nil {
		return err
	}
	if inc.Status == "triggered" {
		if err := a.cancelSteps(ctx, inc.ID, nil); err != nil {
			return err
		}
		if _, err := a.pool.Exec(ctx, `DELETE FROM incident_holders WHERE incident_id=$1`, inc.ID); err != nil {
			return fmt.Errorf("clear holders: %w", err)
		}
		inc.Level = 1
		inc.Cycle = 0
		inc.EscalationFinished = false
		if err := a.runEscalation(ctx, inc, now, true); err != nil {
			return err
		}
	}
	if err := a.saveIncident(ctx, inc); err != nil {
		return err
	}
	a.announceIncident(ctx, inc, txtUrgencyRaised(inc.Number))
	return nil
}

// AddNote writes one note and one timeline entry, and clears that person's
// draft everywhere.
func (a *App) AddNote(ctx context.Context, actor Actor, incidentID, body string) (TimelineEntry, error) {
	a.Lock()
	defer a.Unlock()
	body = strings.TrimSpace(body)
	if body == "" || len([]rune(body)) > 10000 {
		return TimelineEntry{}, errFields("body", "Write 1 to 10000 characters.")
	}
	inc, err := a.loadIncident(ctx, incidentID)
	if err != nil {
		return TimelineEntry{}, err
	}
	entry, err := a.addEntry(ctx, inc.ID, a.Clock.Now(), "note", actor.Name(), body, nil)
	if err != nil {
		return TimelineEntry{}, err
	}
	if actor.User != nil {
		if _, err := a.pool.Exec(ctx, `DELETE FROM note_drafts WHERE incident_id=$1 AND person_id=$2`,
			incidentID, actor.User.ID); err != nil {
			return TimelineEntry{}, fmt.Errorf("clear draft: %w", err)
		}
	}
	a.announceIncident(ctx, inc, "")
	return entry, nil
}

func (a *App) NoteDraft(ctx context.Context, incidentID, personID string) (string, *time.Time, error) {
	var body string
	var savedAt time.Time
	err := a.pool.QueryRow(ctx, `SELECT body, saved_at FROM note_drafts WHERE incident_id=$1 AND person_id=$2`,
		incidentID, personID).Scan(&body, &savedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil, nil
	}
	if err != nil {
		return "", nil, fmt.Errorf("read draft: %w", err)
	}
	return body, &savedAt, nil
}

func (a *App) SaveNoteDraft(ctx context.Context, incidentID, personID, body string) (time.Time, error) {
	now := a.Clock.Now()
	if strings.TrimSpace(body) == "" {
		if _, err := a.pool.Exec(ctx, `DELETE FROM note_drafts WHERE incident_id=$1 AND person_id=$2`,
			incidentID, personID); err != nil {
			return now, fmt.Errorf("clear draft: %w", err)
		}
		return now, nil
	}
	if _, err := a.pool.Exec(ctx, `INSERT INTO note_drafts (incident_id, person_id, body, saved_at)
		VALUES ($1,$2,$3,$4) ON CONFLICT (incident_id, person_id) DO UPDATE SET body=$3, saved_at=$4`,
		incidentID, personID, body, now); err != nil {
		return now, fmt.Errorf("save draft: %w", err)
	}
	a.publish(ctx, "incident", map[string]any{"incident_id": incidentID, "draft_person": personID, "announce": ""})
	return now, nil
}

// RequestResponder asks a colleague to join an incident.
func (a *App) RequestResponder(ctx context.Context, actor Actor, incidentID, personID string) (ResponderRequest, error) {
	a.Lock()
	defer a.Unlock()
	inc, err := a.loadIncident(ctx, incidentID)
	if err != nil {
		return ResponderRequest{}, err
	}
	if inc.Status == "resolved" {
		return ResponderRequest{}, a.conflictFor(inc)
	}
	person, err := a.UserByID(ctx, personID)
	if err != nil {
		return ResponderRequest{}, err
	}
	var already int
	if err := a.pool.QueryRow(ctx, `SELECT count(*) FROM incident_responders WHERE incident_id=$1 AND person_id=$2`,
		incidentID, personID).Scan(&already); err != nil {
		return ResponderRequest{}, fmt.Errorf("check responder: %w", err)
	}
	var holding int
	if err := a.pool.QueryRow(ctx, `SELECT count(*) FROM incident_holders WHERE incident_id=$1 AND person_id=$2`,
		incidentID, personID).Scan(&holding); err != nil {
		return ResponderRequest{}, fmt.Errorf("check holder: %w", err)
	}
	if already > 0 || holding > 0 {
		return ResponderRequest{}, errCode(409, "already_responding")
	}
	now := a.Clock.Now()
	id := newID()
	requestedBy := ""
	if actor.User != nil {
		requestedBy = actor.User.ID
	} else {
		requestedBy = personID
	}
	if _, err := a.pool.Exec(ctx, `INSERT INTO responder_requests (id, incident_id, person_id, requested_by, state, created_at)
		VALUES ($1,$2,$3,$4,'requested',$5)`, id, incidentID, personID, requestedBy, now); err != nil {
		return ResponderRequest{}, fmt.Errorf("ask responder: %w", err)
	}
	if _, err := a.pool.Exec(ctx, `INSERT INTO notification_steps (id, incident_id, person_id, assignment_id, kind,
		channel, due_at, status, sent_at, created_at) VALUES ($1,$2,$3,$4,'step','in_app',$5,'sent',$5,$5)`,
		newID(), incidentID, personID, id, now); err != nil {
		return ResponderRequest{}, fmt.Errorf("notify responder: %w", err)
	}
	text := txtResponderRequested(actor.Name(), person.Name, inc.Number)
	if _, err := a.addEntry(ctx, incidentID, now, "responder_requested", actor.Name(), text, nil); err != nil {
		return ResponderRequest{}, err
	}
	a.announceIncident(ctx, inc, text)
	return ResponderRequest{ID: id, Person: person.Name, State: "requested"}, nil
}

// AnswerResponderRequest records the first answer, which stands.
func (a *App) AnswerResponderRequest(ctx context.Context, actor Actor, requestID string, accept bool) (ResponderRequest, error) {
	a.Lock()
	defer a.Unlock()
	var incidentID, personID, state string
	err := a.pool.QueryRow(ctx, `SELECT incident_id, person_id, state FROM responder_requests WHERE id=$1`, requestID).
		Scan(&incidentID, &personID, &state)
	if errors.Is(err, pgx.ErrNoRows) {
		return ResponderRequest{}, errNotFound
	}
	if err != nil {
		return ResponderRequest{}, fmt.Errorf("read responder request: %w", err)
	}
	if actor.User == nil || actor.User.ID != personID {
		return ResponderRequest{}, errForbidden
	}
	if state != "requested" {
		return ResponderRequest{}, errCode(409, "already_answered")
	}
	inc, err := a.loadIncident(ctx, incidentID)
	if err != nil {
		return ResponderRequest{}, err
	}
	now := a.Clock.Now()
	answer := "declined"
	kind := "responder_declined"
	text := txtResponderDeclined(actor.Name(), inc.Number)
	if accept {
		answer = "accepted"
		kind = "responder_accepted"
		text = txtResponderAccepted(actor.Name(), inc.Number)
		if _, err := a.pool.Exec(ctx, `INSERT INTO incident_responders (incident_id, person_id) VALUES ($1,$2)
			ON CONFLICT DO NOTHING`, incidentID, personID); err != nil {
			return ResponderRequest{}, fmt.Errorf("add responder: %w", err)
		}
	}
	if _, err := a.pool.Exec(ctx, `UPDATE responder_requests SET state=$1, answered_at=$2 WHERE id=$3`,
		answer, now, requestID); err != nil {
		return ResponderRequest{}, fmt.Errorf("answer responder request: %w", err)
	}
	if _, err := a.addEntry(ctx, incidentID, now, kind, actor.Name(), text, nil); err != nil {
		return ResponderRequest{}, err
	}
	a.announceIncident(ctx, inc, text)
	return ResponderRequest{ID: requestID, Person: actor.Name(), State: answer}, nil
}

// BulkResult is one row's own result from a bulk action.
type BulkResult struct {
	ID        string `json:"id"`
	Number    int64  `json:"number"`
	Status    string `json:"status"`
	Decision  string `json:"decision,omitempty"`
	DecidedBy string `json:"decided_by,omitempty"`
}

func (a *App) Bulk(ctx context.Context, actor Actor, action string, ids []string) ([]BulkResult, error) {
	if action != "acknowledge" && action != "resolve" {
		return nil, errFields("action", "Choose acknowledge or resolve.")
	}
	if len(ids) < 1 || len(ids) > 100 {
		return nil, errFields("ids", "Choose 1 to 100 incidents.")
	}
	results := make([]BulkResult, 0, len(ids))
	for _, id := range ids {
		var view *IncidentView
		var err error
		if action == "acknowledge" {
			view, err = a.Acknowledge(ctx, actor, id)
		} else {
			view, err = a.Resolve(ctx, actor, id)
		}
		if err == nil {
			results = append(results, BulkResult{ID: view.ID, Number: view.Number, Status: "ok"})
			continue
		}
		var apiErr *APIError
		if errors.As(err, &apiErr) && apiErr.Status == 409 {
			inc, loadErr := a.loadIncident(ctx, id)
			if loadErr != nil {
				return nil, loadErr
			}
			decision, _ := apiErr.Body["decision"].(string)
			decidedBy, _ := apiErr.Body["decided_by"].(string)
			if decision == "" {
				decision = inc.Status
			}
			results = append(results, BulkResult{ID: id, Number: inc.Number, Status: "conflict",
				Decision: decision, DecidedBy: decidedBy})
			continue
		}
		return nil, err
	}
	return results, nil
}

// Drill opens a real incident on a service directly, through no routing key.
func (a *App) Drill(ctx context.Context, actor Actor, serviceID, summary, severity, dedupKey string) (*IncidentView, error) {
	a.Lock()
	defer a.Unlock()
	if err := a.applyDueTimers(ctx); err != nil {
		return nil, err
	}
	errs := map[string]string{}
	service, err := a.GetService(ctx, serviceID)
	if err != nil {
		errs["service_id"] = "Choose a service."
	}
	if strings.TrimSpace(summary) == "" {
		errs["summary"] = "Summary is required."
	} else if len([]rune(summary)) > 1024 {
		errs["summary"] = "Summary is longer than 1024 characters."
	}
	if !contains([]string{"critical", "error", "warning", "info"}, severity) {
		errs["severity"] = "Severity must be critical, error, warning or info."
	}
	if len(errs) > 0 {
		return nil, errFieldMap(errs)
	}
	inMaintenance, err := a.inMaintenance(ctx, service.ID)
	if err != nil {
		return nil, err
	}
	if inMaintenance {
		return nil, errCode(409, "in_maintenance")
	}
	if dedupKey == "" {
		dedupKey = "drill-" + randomHex(6)
	}
	now := a.Clock.Now()
	inc, reason, err := a.openForAlert(ctx, service, alertInput{
		DedupKey: dedupKey, Summary: summary, Source: "Drill", Severity: severity,
	}, actor.Name(), now)
	if err != nil {
		return nil, err
	}
	if inc == nil {
		if reason == reasonNobodyOnCall {
			return nil, errCode(409, "nobody_on_call")
		}
		return nil, errCode(409, "in_maintenance")
	}
	return a.incidentView(ctx, inc)
}
