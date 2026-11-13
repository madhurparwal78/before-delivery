package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// eventMessage is the shape that travels on the queue.
type eventMessage struct {
	EventID     string          `json:"event_id"`
	RoutingKey  string          `json:"routing_key"`
	DedupKey    string          `json:"dedup_key"`
	KeySeq      int64           `json:"key_seq"`
	EventAction string          `json:"event_action"`
	Payload     *eventPayload   `json:"payload"`
	AcceptedAt  string          `json:"accepted_at"`
	Raw         json.RawMessage `json:"-"`
}

type eventPayload struct {
	Summary       string         `json:"summary"`
	Source        string         `json:"source"`
	Severity      string         `json:"severity"`
	Timestamp     string         `json:"timestamp,omitempty"`
	CustomDetails map[string]any `json:"custom_details,omitempty"`
}

// intakeRequest is what a monitor posts.
type intakeRequest struct {
	RoutingKey  string        `json:"routing_key"`
	EventAction string        `json:"event_action"`
	DedupKey    string        `json:"dedup_key"`
	Payload     *eventPayload `json:"payload"`
}

// intakeFieldOrder is the order bad fields are named in.
var intakeFieldOrder = []string{"routing_key", "event_action", "dedup_key", "payload.summary", "payload.source", "payload.severity"}

func validateIntake(in intakeRequest) map[string]string {
	errs := map[string]string{}
	if strings.TrimSpace(in.RoutingKey) == "" {
		errs["routing_key"] = "Routing key is required."
	}
	if !contains([]string{"trigger", "acknowledge", "resolve"}, in.EventAction) {
		errs["event_action"] = "Action must be trigger, acknowledge or resolve."
	}
	switch {
	case in.DedupKey == "" && in.EventAction != "trigger":
		errs["dedup_key"] = "Dedup key is required for this action."
	case in.DedupKey != "" && (len([]rune(in.DedupKey)) < 1 || len([]rune(in.DedupKey)) > 255):
		errs["dedup_key"] = "Dedup key must be 1 to 255 characters."
	}
	if in.EventAction == "trigger" {
		payload := in.Payload
		if payload == nil {
			payload = &eventPayload{}
		}
		switch {
		case strings.TrimSpace(payload.Summary) == "":
			errs["payload.summary"] = "Summary is required."
		case len([]rune(payload.Summary)) > 1024:
			errs["payload.summary"] = "Summary is longer than 1024 characters."
		}
		if strings.TrimSpace(payload.Source) == "" {
			errs["payload.source"] = "Source is required."
		}
		if !contains([]string{"critical", "error", "warning", "info"}, payload.Severity) {
			errs["payload.severity"] = "Severity must be critical, error, warning or info."
		}
	}
	return errs
}

func badFieldList(errs map[string]string) string {
	var named []string
	for _, field := range intakeFieldOrder {
		if _, ok := errs[field]; ok {
			named = append(named, field)
		}
	}
	return strings.Join(named, ", ")
}

// Intake answers a monitoring event as accepted only once the broker has
// confirmed holding it.
func (a *App) Intake(ctx context.Context, raw []byte) (map[string]any, *APIError) {
	var in intakeRequest
	if err := json.Unmarshal(raw, &in); err != nil {
		return nil, errCode(400, "invalid_json")
	}
	integration, err := a.integrationByRoutingKey(ctx, in.RoutingKey)
	if err != nil {
		return nil, errCode(503, "queue_unavailable")
	}
	errs := validateIntake(in)
	if len(errs) > 0 {
		if integration != nil {
			a.logEvent(ctx, integration.ID, nil, in.EventAction, in.DedupKey, "Refused",
				fmt.Sprintf("Invalid event: %s.", badFieldList(errs)), nil)
		}
		fields := map[string]any{}
		for k, v := range errs {
			fields[k] = v
		}
		return nil, &APIError{Status: 400, Body: map[string]any{"error": "invalid_event", "errors": fields}}
	}
	if integration == nil {
		return nil, errCode(404, "unknown_routing_key")
	}
	state, allowed := a.rateWindow(ctx, in.RoutingKey, true)
	if !allowed {
		retry := 1
		if state.RetryAfter != nil {
			retry = *state.RetryAfter
		}
		a.logEvent(ctx, integration.ID, nil, in.EventAction, in.DedupKey, "Refused", reasonRateLimited, nil)
		return nil, &APIError{Status: 429, Body: map[string]any{"error": "rate_limited", "retry_after": retry}}
	}

	dedupKey := in.DedupKey
	if dedupKey == "" {
		dedupKey = "auto-" + randomHex(8)
	}
	eventID := newID()
	keySeq, err := a.takeKeySeq(ctx, in.RoutingKey, dedupKey)
	if err != nil {
		a.returnRateSlot(ctx, in.RoutingKey)
		return nil, errCode(503, "queue_unavailable")
	}
	message := eventMessage{
		EventID: eventID, RoutingKey: in.RoutingKey, DedupKey: dedupKey, KeySeq: keySeq,
		EventAction: in.EventAction, Payload: in.Payload, AcceptedAt: a.Clock.Now().Format(time.RFC3339),
	}
	body, err := json.Marshal(message)
	if err != nil {
		a.returnRateSlot(ctx, in.RoutingKey)
		return nil, errCode(503, "queue_unavailable")
	}
	if err := a.broker.publish(ctx, body); err != nil {
		a.returnKeySeq(ctx, in.RoutingKey, dedupKey, keySeq)
		a.returnRateSlot(ctx, in.RoutingKey)
		a.logEvent(ctx, integration.ID, nil, in.EventAction, in.DedupKey, "Refused", reasonQueueUnavailable, nil)
		return nil, errCode(503, "queue_unavailable")
	}
	a.publishIntegration(ctx, integration.ID)
	return map[string]any{"status": "accepted", "event_id": eventID, "dedup_key": dedupKey}, nil
}

// takeKeySeq numbers each accepted event per routing key and dedup key.
func (a *App) takeKeySeq(ctx context.Context, routingKey, dedupKey string) (int64, error) {
	var seq int64
	err := a.pool.QueryRow(ctx, `INSERT INTO event_seq (routing_key, dedup_key, next_seq, applied_seq)
		VALUES ($1,$2,2,0) ON CONFLICT (routing_key, dedup_key)
		DO UPDATE SET next_seq = event_seq.next_seq + 1 RETURNING next_seq - 1`, routingKey, dedupKey).Scan(&seq)
	if err != nil {
		return 0, fmt.Errorf("take key_seq: %w", err)
	}
	return seq, nil
}

// returnKeySeq gives a number back when the broker did not confirm.
func (a *App) returnKeySeq(ctx context.Context, routingKey, dedupKey string, seq int64) {
	if _, err := a.pool.Exec(ctx, `UPDATE event_seq SET next_seq=$1 WHERE routing_key=$2 AND dedup_key=$3 AND next_seq=$4`,
		seq, routingKey, dedupKey, seq+1); err != nil {
		log.Printf("return key_seq: %v", err)
	}
}

func (a *App) logEvent(ctx context.Context, integrationID string, eventID *string, action, dedupKey, outcome, reason string, incidentNumber *int64) {
	if _, err := a.pool.Exec(ctx, `INSERT INTO event_log (integration_id, event_id, at, action, dedup_key, outcome, reason, incident_number)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, integrationID, eventID, a.Clock.Now(), action, dedupKey, outcome, reason, incidentNumber); err != nil {
		log.Printf("write event log: %v", err)
	}
	a.publishIntegration(ctx, integrationID)
}

// handleEventMessage applies one message from the queue, retrying before it
// becomes a dead letter.
func (a *App) handleEventMessage(ctx context.Context, body []byte) {
	for attempt := 1; attempt <= 3; attempt++ {
		reason, err := a.applyMessage(ctx, body, false)
		if err != nil {
			log.Printf("apply event: %v", err)
		}
		if reason == "" {
			return
		}
		if attempt == 3 {
			a.deadLetter(ctx, body, reason, attempt)
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Duration(attempt) * time.Second):
		}
	}
}

// checkMessage names the first absent or wrong field, which becomes the dead
// letter's reason.
func checkMessage(body []byte) (*eventMessage, string) {
	var generic map[string]any
	if err := json.Unmarshal(body, &generic); err != nil {
		return nil, deadNotJSON
	}
	var msg eventMessage
	if err := json.Unmarshal(body, &msg); err != nil {
		return nil, deadNotJSON
	}
	for _, field := range []string{"event_id", "routing_key", "dedup_key", "key_seq", "event_action"} {
		value, ok := generic[field]
		if !ok || value == nil || value == "" {
			return nil, deadMissingField(field)
		}
	}
	if !contains([]string{"trigger", "acknowledge", "resolve"}, msg.EventAction) {
		return nil, deadMissingField("event_action")
	}
	if msg.EventAction == "trigger" {
		if msg.Payload == nil {
			return nil, deadMissingField("payload")
		}
		if msg.Payload.Summary == "" {
			return nil, deadMissingField("payload.summary")
		}
		if len([]rune(msg.Payload.Summary)) > 1024 {
			return nil, deadLongSummary
		}
		if msg.Payload.Source == "" {
			return nil, deadMissingField("payload.source")
		}
		if !contains([]string{"critical", "error", "warning", "info"}, msg.Payload.Severity) {
			return nil, deadUnknownSeverity(msg.Payload.Severity)
		}
	}
	return &msg, ""
}

// applyMessage applies one event exactly once, in acceptance order for its key.
func (a *App) applyMessage(ctx context.Context, body []byte, replay bool) (string, error) {
	msg, reason := checkMessage(body)
	if reason != "" {
		return reason, nil
	}
	integration, err := a.integrationByRoutingKey(ctx, msg.RoutingKey)
	if err != nil {
		return "", err
	}
	if integration == nil {
		return deadUnknownRoutingKey(msg.RoutingKey), nil
	}

	a.Lock()
	defer a.Unlock()
	if err := a.applyDueTimers(ctx); err != nil {
		return "", err
	}

	var applied int
	if err := a.pool.QueryRow(ctx, `SELECT count(*) FROM applied_events WHERE event_id=$1`, msg.EventID).Scan(&applied); err != nil {
		return "", fmt.Errorf("check applied event: %w", err)
	}
	if applied > 0 {
		return "", nil
	}
	if !replay {
		var appliedSeq int64
		err := a.pool.QueryRow(ctx, `SELECT applied_seq FROM event_seq WHERE routing_key=$1 AND dedup_key=$2`,
			msg.RoutingKey, msg.DedupKey).Scan(&appliedSeq)
		if errors.Is(err, pgx.ErrNoRows) {
			appliedSeq = 0
		} else if err != nil {
			return "", fmt.Errorf("read applied seq: %w", err)
		}
		if msg.KeySeq <= appliedSeq {
			return "", nil
		}
		if msg.KeySeq > appliedSeq+1 {
			if err := a.holdPending(ctx, msg, body); err != nil {
				return "", err
			}
			return "", nil
		}
	}
	if err := a.applyEffect(ctx, integration, msg); err != nil {
		return "", err
	}
	if _, err := a.pool.Exec(ctx, `INSERT INTO applied_events (event_id, applied_at) VALUES ($1,$2)
		ON CONFLICT DO NOTHING`, msg.EventID, a.Clock.Now()); err != nil {
		return "", fmt.Errorf("record applied event: %w", err)
	}
	if !replay {
		if _, err := a.pool.Exec(ctx, `INSERT INTO event_seq (routing_key, dedup_key, next_seq, applied_seq)
			VALUES ($1,$2,$3,$3) ON CONFLICT (routing_key, dedup_key) DO UPDATE SET applied_seq=$3`,
			msg.RoutingKey, msg.DedupKey, msg.KeySeq); err != nil {
			return "", fmt.Errorf("record applied seq: %w", err)
		}
		if _, err := a.pool.Exec(ctx, `DELETE FROM pending_events WHERE event_id=$1`, msg.EventID); err != nil {
			return "", fmt.Errorf("clear pending event: %w", err)
		}
	}
	return "", nil
}

func (a *App) holdPending(ctx context.Context, msg *eventMessage, body []byte) error {
	if _, err := a.pool.Exec(ctx, `INSERT INTO pending_events (event_id, routing_key, dedup_key, key_seq, body, first_seen_at, next_try_at)
		VALUES ($1,$2,$3,$4,$5,$6,$6) ON CONFLICT (event_id) DO NOTHING`,
		msg.EventID, msg.RoutingKey, msg.DedupKey, msg.KeySeq, body, time.Now().UTC()); err != nil {
		return fmt.Errorf("hold early event: %w", err)
	}
	return nil
}

type alertInput struct {
	RoutingKey *string
	DedupKey   string
	Summary    string
	Source     string
	Severity   string
}

// applyEffect applies one event to the record and writes its log row.
func (a *App) applyEffect(ctx context.Context, integration *Integration, msg *eventMessage) error {
	now := a.Clock.Now()
	eventID := msg.EventID
	switch msg.EventAction {
	case "trigger":
		open, err := a.openAlertFor(ctx, msg.RoutingKey, msg.DedupKey)
		if err != nil {
			return err
		}
		if open != nil {
			if _, err := a.pool.Exec(ctx, `UPDATE alerts SET event_count = event_count + 1 WHERE id=$1`, open.ID); err != nil {
				return fmt.Errorf("count repeat event: %w", err)
			}
			inc, err := a.incidentOfAlert(ctx, open.ID)
			if err != nil {
				return err
			}
			if inc != nil {
				if _, err := a.addEntry(ctx, inc.ID, now, "repeat_event", integration.Name, txtRepeatEvent(msg.DedupKey), nil); err != nil {
					return err
				}
				a.announceIncident(ctx, inc, "")
				a.logEvent(ctx, integration.ID, &eventID, msg.EventAction, msg.DedupKey, "Applied", "", &inc.Number)
				return nil
			}
			a.logEvent(ctx, integration.ID, &eventID, msg.EventAction, msg.DedupKey, "Applied", "", nil)
			return nil
		}
		service, err := a.GetService(ctx, integration.ServiceID)
		if err != nil {
			return err
		}
		key := msg.RoutingKey
		inc, reason, err := a.openForAlert(ctx, service, alertInput{
			RoutingKey: &key, DedupKey: msg.DedupKey, Summary: msg.Payload.Summary,
			Source: msg.Payload.Source, Severity: msg.Payload.Severity,
		}, integration.Name, now)
		if err != nil {
			return err
		}
		if inc == nil {
			outcome := "Dropped"
			if reason == reasonMaintenance {
				outcome = "Suppressed"
			}
			a.logEvent(ctx, integration.ID, &eventID, msg.EventAction, msg.DedupKey, outcome, reason, nil)
			return nil
		}
		a.logEvent(ctx, integration.ID, &eventID, msg.EventAction, msg.DedupKey, "Applied", "", &inc.Number)
		return nil

	case "acknowledge", "resolve":
		alert, reason, err := a.alertForAction(ctx, msg.RoutingKey, msg.DedupKey, msg.EventAction)
		if err != nil {
			return err
		}
		if alert == nil {
			a.logEvent(ctx, integration.ID, &eventID, msg.EventAction, msg.DedupKey, "Dropped", reason, nil)
			return nil
		}
		inc, err := a.incidentOfAlert(ctx, alert.ID)
		if err != nil {
			return err
		}
		if inc == nil {
			a.logEvent(ctx, integration.ID, &eventID, msg.EventAction, msg.DedupKey, "Dropped", reasonNoAlert, nil)
			return nil
		}
		if msg.EventAction == "acknowledge" {
			if inc.Status != "triggered" {
				a.logEvent(ctx, integration.ID, &eventID, msg.EventAction, msg.DedupKey, "Dropped", reasonAlreadyAcked, &inc.Number)
				return nil
			}
			if err := a.acknowledgeAsIntegration(ctx, inc, integration.Name, now); err != nil {
				return err
			}
			a.logEvent(ctx, integration.ID, &eventID, msg.EventAction, msg.DedupKey, "Applied", "", &inc.Number)
			return nil
		}
		if _, err := a.pool.Exec(ctx, `UPDATE alerts SET status='resolved', resolved_at=$1 WHERE id=$2`, now, alert.ID); err != nil {
			return fmt.Errorf("resolve alert: %w", err)
		}
		var open int
		if err := a.pool.QueryRow(ctx, `SELECT count(*) FROM alerts WHERE incident_id=$1 AND status <> 'resolved'`,
			inc.ID).Scan(&open); err != nil {
			return fmt.Errorf("count open alerts: %w", err)
		}
		if open == 0 && inc.Status != "resolved" {
			if err := a.closeIncident(ctx, inc, now, "Resolved", integration.Name, "resolved",
				txtResolved(inc.Number, integration.Name)); err != nil {
				return err
			}
			a.afterIncidentChange(ctx, inc, txtResolved(inc.Number, integration.Name), "incident.resolved")
		} else {
			a.announceIncident(ctx, inc, "")
		}
		a.logEvent(ctx, integration.ID, &eventID, msg.EventAction, msg.DedupKey, "Applied", "", &inc.Number)
		return nil
	}
	return nil
}

func (a *App) acknowledgeAsIntegration(ctx context.Context, inc *incidentRow, name string, now time.Time) error {
	inc.Status = "acknowledged"
	inc.AcknowledgedAt = &now
	inc.AcknowledgedBy = &name
	inc.DecidedBy = &name
	inc.DecidedAt = &now
	inc.EscalationDueAt = nil
	service, err := a.GetService(ctx, inc.ServiceID)
	if err != nil {
		return err
	}
	if service.AckTimeoutMinutes != nil {
		inc.AckDeadlineAt = ptr(now.Add(time.Duration(*service.AckTimeoutMinutes) * time.Minute))
	}
	if err := a.cancelSteps(ctx, inc.ID, nil); err != nil {
		return err
	}
	if _, err := a.addEntry(ctx, inc.ID, now, "acknowledged", name, txtAcknowledged(inc.Number, name), nil); err != nil {
		return err
	}
	if err := a.saveIncident(ctx, inc); err != nil {
		return err
	}
	a.afterIncidentChange(ctx, inc, txtAcknowledged(inc.Number, name), "incident.acknowledged")
	return nil
}

func (a *App) openAlertFor(ctx context.Context, routingKey, dedupKey string) (*Alert, error) {
	var al Alert
	err := a.pool.QueryRow(ctx, `SELECT id, routing_key, dedup_key, status, summary, source, severity, event_count, service_id
		FROM alerts WHERE routing_key=$1 AND dedup_key=$2 AND status <> 'resolved' ORDER BY opened_at DESC LIMIT 1`,
		routingKey, dedupKey).Scan(&al.ID, &al.RoutingKey, &al.DedupKey, &al.Status, &al.Summary, &al.Source,
		&al.Severity, &al.EventCount, &al.ServiceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read open alert: %w", err)
	}
	return &al, nil
}

// alertForAction finds the alert an acknowledge or resolve event names, or the
// reason it is dropped.
func (a *App) alertForAction(ctx context.Context, routingKey, dedupKey, action string) (*Alert, string, error) {
	var al Alert
	err := a.pool.QueryRow(ctx, `SELECT id, routing_key, dedup_key, status, summary, source, severity, event_count, service_id
		FROM alerts WHERE routing_key=$1 AND dedup_key=$2 ORDER BY opened_at DESC LIMIT 1`, routingKey, dedupKey).
		Scan(&al.ID, &al.RoutingKey, &al.DedupKey, &al.Status, &al.Summary, &al.Source, &al.Severity, &al.EventCount, &al.ServiceID)
	if errors.Is(err, pgx.ErrNoRows) {
		var other int
		if err := a.pool.QueryRow(ctx, `SELECT count(*) FROM alerts WHERE dedup_key=$1 AND status <> 'resolved'`, dedupKey).Scan(&other); err != nil {
			return nil, "", fmt.Errorf("check other integrations: %w", err)
		}
		if other > 0 {
			return nil, reasonOtherIntegration, nil
		}
		return nil, reasonNoAlert, nil
	}
	if err != nil {
		return nil, "", fmt.Errorf("read alert: %w", err)
	}
	if al.Status == "resolved" {
		return nil, reasonAlreadyResolved, nil
	}
	return &al, "", nil
}

func (a *App) incidentOfAlert(ctx context.Context, alertID string) (*incidentRow, error) {
	var incidentID *string
	if err := a.pool.QueryRow(ctx, `SELECT incident_id FROM alerts WHERE id=$1`, alertID).Scan(&incidentID); err != nil {
		return nil, fmt.Errorf("read alert incident: %w", err)
	}
	if incidentID == nil {
		return nil, nil
	}
	return a.loadIncident(ctx, *incidentID)
}

// openForAlert opens a new alert, joining a grouped incident or opening one.
func (a *App) openForAlert(ctx context.Context, service *Service, in alertInput, actorName string, now time.Time) (*incidentRow, string, error) {
	inWindow, err := a.inMaintenance(ctx, service.ID)
	if err != nil {
		return nil, "", err
	}
	if inWindow {
		return nil, reasonMaintenance, nil
	}
	target, err := a.groupingTarget(ctx, service, now)
	if err != nil {
		return nil, "", err
	}
	if target != nil {
		if err := a.insertAlert(ctx, target.ID, service.ID, in, now); err != nil {
			return nil, "", err
		}
		if severityUrgency(in.Severity) == "high" && target.Urgency != "high" {
			if err := a.raiseUrgency(ctx, target, now); err != nil {
				return nil, "", err
			}
		} else {
			a.announceIncident(ctx, target, "")
		}
		a.clearStatusCache(ctx)
		a.publishStatus(ctx)
		return target, "", nil
	}
	snapshot, err := a.policySnapshotFor(ctx, service.ID)
	if err != nil {
		return nil, "", err
	}
	anyone, err := a.anyoneOnPolicy(ctx, snapshot, now)
	if err != nil {
		return nil, "", err
	}
	if !anyone {
		return nil, reasonNobodyOnCall, nil
	}
	inc, err := a.createIncident(ctx, service, snapshot, in.Summary, severityUrgency(in.Severity), now)
	if err != nil {
		return nil, "", err
	}
	if err := a.insertAlert(ctx, inc.ID, service.ID, in, now); err != nil {
		return nil, "", err
	}
	if _, err := a.addEntry(ctx, inc.ID, now, "triggered", actorName, txtTriggered(inc.Number, inc.Title), nil); err != nil {
		return nil, "", err
	}
	if inc.Urgency == "high" {
		if err := a.runEscalation(ctx, inc, now, true); err != nil {
			return nil, "", err
		}
	} else if err := a.assignFirstLevel(ctx, inc, now); err != nil {
		return nil, "", err
	}
	if err := a.saveIncident(ctx, inc); err != nil {
		return nil, "", err
	}
	a.afterIncidentChange(ctx, inc, txtTriggered(inc.Number, inc.Title), "incident.triggered")
	return inc, "", nil
}

// groupingTarget answers the incident a new alert joins under the service's
// grouping mode, or nil when it opens its own.
func (a *App) groupingTarget(ctx context.Context, service *Service, now time.Time) (*incidentRow, error) {
	switch service.GroupingMode {
	case "window":
		row := a.pool.QueryRow(ctx, `SELECT `+incidentColumns+` FROM incidents
			WHERE service_id=$1 AND status <> 'resolved' AND grouping_until IS NOT NULL AND grouping_until > $2
			ORDER BY opened_at DESC LIMIT 1`, service.ID, now)
		inc, err := scanIncident(row)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		if err != nil {
			return nil, fmt.Errorf("read grouping target: %w", err)
		}
		return inc, nil
	case "until_resolved":
		row := a.pool.QueryRow(ctx, `SELECT `+incidentColumns+` FROM incidents
			WHERE service_id=$1 AND status <> 'resolved' ORDER BY opened_at DESC LIMIT 1`, service.ID)
		inc, err := scanIncident(row)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		if err != nil {
			return nil, fmt.Errorf("read grouping target: %w", err)
		}
		return inc, nil
	default:
		return nil, nil
	}
}

func (a *App) insertAlert(ctx context.Context, incidentID, serviceID string, in alertInput, now time.Time) error {
	if _, err := a.pool.Exec(ctx, `INSERT INTO alerts (id, incident_id, service_id, routing_key, dedup_key, status,
		summary, source, severity, event_count, opened_at) VALUES ($1,$2,$3,$4,$5,'triggered',$6,$7,$8,1,$9)`,
		newID(), incidentID, serviceID, in.RoutingKey, in.DedupKey, in.Summary, in.Source, in.Severity, now); err != nil {
		return fmt.Errorf("open alert: %w", err)
	}
	return nil
}

// DeadLetter is one message that could not be applied.
type DeadLetter struct {
	ID         string    `json:"id"`
	EventID    *string   `json:"event_id"`
	RoutingKey *string   `json:"routing_key"`
	Reason     string    `json:"reason"`
	Raw        string    `json:"raw"`
	Attempts   int       `json:"attempts"`
	DeadAt     time.Time `json:"dead_at"`
}

func (a *App) deadLetter(ctx context.Context, body []byte, reason string, attempts int) {
	var msg eventMessage
	_ = json.Unmarshal(body, &msg)
	var eventID, routingKey *string
	if msg.EventID != "" {
		eventID = &msg.EventID
	}
	if msg.RoutingKey != "" {
		routingKey = &msg.RoutingKey
	}
	var integrationID *string
	if routingKey != nil {
		if integration, err := a.integrationByRoutingKey(ctx, *routingKey); err == nil && integration != nil {
			integrationID = &integration.ID
		}
	}
	if _, err := a.pool.Exec(ctx, `INSERT INTO dead_letters (id, event_id, integration_id, routing_key, reason, raw, attempts, dead_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, newID(), eventID, integrationID, routingKey, reason, string(body), attempts, a.Clock.Now()); err != nil {
		log.Printf("write dead letter: %v", err)
		return
	}
	if err := a.broker.publishDead(ctx, body); err != nil {
		log.Printf("publish dead letter: %v", err)
	}
	if integrationID != nil {
		a.logEvent(ctx, *integrationID, eventID, msg.EventAction, msg.DedupKey, "Dead-lettered", reason, nil)
	}
}

func (a *App) ListDeadLetters(ctx context.Context, integrationID string) ([]DeadLetter, error) {
	query := `SELECT id, event_id, routing_key, reason, raw, attempts, dead_at FROM dead_letters WHERE replayed_at IS NULL`
	args := []any{}
	if integrationID != "" {
		args = append(args, integrationID)
		query += ` AND integration_id = $1`
	}
	query += ` ORDER BY dead_at DESC`
	rows, err := a.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list dead letters: %w", err)
	}
	defer rows.Close()
	out := []DeadLetter{}
	for rows.Next() {
		var d DeadLetter
		if err := rows.Scan(&d.ID, &d.EventID, &d.RoutingKey, &d.Reason, &d.Raw, &d.Attempts, &d.DeadAt); err != nil {
			return nil, fmt.Errorf("read dead letter: %w", err)
		}
		d.DeadAt = d.DeadAt.UTC()
		out = append(out, d)
	}
	return out, rows.Err()
}

// ReplayDeadLetter applies a dead letter exactly once and takes it off the
// dead-letter queue.
func (a *App) ReplayDeadLetter(ctx context.Context, id string, corrected []byte) (map[string]any, error) {
	var raw string
	var eventID *string
	tag := a.pool.QueryRow(ctx, `UPDATE dead_letters SET replaying=true WHERE id=$1 AND replaying=false AND replayed_at IS NULL
		RETURNING raw, event_id`, id)
	if err := tag.Scan(&raw, &eventID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			var exists int
			if err := a.pool.QueryRow(ctx, `SELECT count(*) FROM dead_letters WHERE id=$1`, id).Scan(&exists); err != nil {
				return nil, fmt.Errorf("read dead letter: %w", err)
			}
			if exists == 0 {
				return nil, errNotFound
			}
			return nil, errCode(409, "already_replayed")
		}
		return nil, fmt.Errorf("take dead letter: %w", err)
	}
	body := []byte(raw)
	if len(corrected) > 0 {
		body = corrected
	}
	reason, err := a.applyMessage(ctx, body, true)
	if err != nil {
		return nil, err
	}
	if reason != "" {
		if _, err := a.pool.Exec(ctx, `UPDATE dead_letters SET replaying=false WHERE id=$1`, id); err != nil {
			return nil, fmt.Errorf("release dead letter: %w", err)
		}
		return nil, errFields("message", reason)
	}
	var msg eventMessage
	_ = json.Unmarshal(body, &msg)
	if _, err := a.pool.Exec(ctx, `DELETE FROM dead_letters WHERE id=$1`, id); err != nil {
		return nil, fmt.Errorf("clear dead letter: %w", err)
	}
	if eventID != nil {
		if err := a.broker.removeDead(*eventID); err != nil {
			log.Printf("remove dead letter from queue: %v", err)
		}
	}
	if integration, err := a.integrationByRoutingKey(ctx, msg.RoutingKey); err == nil && integration != nil {
		a.logEvent(ctx, integration.ID, &msg.EventID, msg.EventAction, msg.DedupKey, "Replayed", "", nil)
	}
	return map[string]any{"status": "replayed", "event_id": msg.EventID}, nil
}

func deadLetterEventID(body []byte) string {
	var msg eventMessage
	if err := json.Unmarshal(body, &msg); err != nil {
		return ""
	}
	return msg.EventID
}

// EventLogRow is one line of an integration's event log.
type EventLogRow struct {
	EventID        *string   `json:"event_id"`
	At             time.Time `json:"at"`
	Action         *string   `json:"action"`
	DedupKey       *string   `json:"dedup_key"`
	Outcome        string    `json:"outcome"`
	Reason         *string   `json:"reason"`
	IncidentNumber *int64    `json:"incident_number"`
}

func (a *App) EventLog(ctx context.Context, integrationID string, limit int) ([]EventLogRow, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := a.pool.Query(ctx, `SELECT event_id, at, action, dedup_key, outcome, reason, incident_number
		FROM event_log WHERE integration_id=$1 ORDER BY id DESC LIMIT $2`, integrationID, limit)
	if err != nil {
		return nil, fmt.Errorf("read event log: %w", err)
	}
	defer rows.Close()
	out := []EventLogRow{}
	for rows.Next() {
		var r EventLogRow
		if err := rows.Scan(&r.EventID, &r.At, &r.Action, &r.DedupKey, &r.Outcome, &r.Reason, &r.IncidentNumber); err != nil {
			return nil, fmt.Errorf("read event log row: %w", err)
		}
		r.At = r.At.UTC()
		out = append(out, r)
	}
	return out, rows.Err()
}

// pendingLoop applies events that arrived early once their turn comes, and
// dead-letters one whose earlier number never arrived.
func (a *App) pendingLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Second):
		}
		rows, err := a.pool.Query(ctx, `SELECT event_id, routing_key, dedup_key, key_seq, body, first_seen_at
			FROM pending_events ORDER BY key_seq`)
		if err != nil {
			continue
		}
		type pendingEvent struct {
			eventID, routingKey, dedupKey string
			keySeq                        int64
			body                          []byte
			firstSeen                     time.Time
		}
		var pending []pendingEvent
		for rows.Next() {
			var p pendingEvent
			if err := rows.Scan(&p.eventID, &p.routingKey, &p.dedupKey, &p.keySeq, &p.body, &p.firstSeen); err == nil {
				pending = append(pending, p)
			}
		}
		rows.Close()
		for _, p := range pending {
			var appliedSeq int64
			err := a.pool.QueryRow(ctx, `SELECT applied_seq FROM event_seq WHERE routing_key=$1 AND dedup_key=$2`,
				p.routingKey, p.dedupKey).Scan(&appliedSeq)
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				continue
			}
			if p.keySeq <= appliedSeq {
				if _, err := a.pool.Exec(ctx, `DELETE FROM pending_events WHERE event_id=$1`, p.eventID); err != nil {
					log.Printf("clear pending event: %v", err)
				}
				continue
			}
			if p.keySeq == appliedSeq+1 {
				a.handleEventMessage(ctx, p.body)
				continue
			}
			if time.Since(p.firstSeen) >= 60*time.Second {
				a.deadLetter(ctx, p.body, deadEarlierMissing(appliedSeq+1), 1)
				if _, err := a.pool.Exec(ctx, `DELETE FROM pending_events WHERE event_id=$1`, p.eventID); err != nil {
					log.Printf("clear pending event: %v", err)
				}
				if _, err := a.pool.Exec(ctx, `INSERT INTO event_seq (routing_key, dedup_key, next_seq, applied_seq)
					VALUES ($1,$2,$3,$3) ON CONFLICT (routing_key, dedup_key) DO UPDATE SET applied_seq=$3`,
					p.routingKey, p.dedupKey, p.keySeq); err != nil {
					log.Printf("unblock key: %v", err)
				}
			}
		}
	}
}

// IntegrationCounter is the live counter an integration page shows.
type IntegrationCounter struct {
	Count      *int `json:"count"`
	Limit      int  `json:"limit"`
	RetryAfter *int `json:"retry_after"`
	Available  bool `json:"available"`
}

func (a *App) Counter(ctx context.Context, routingKey string) IntegrationCounter {
	state, _ := a.rateWindow(ctx, routingKey, false)
	return IntegrationCounter{Count: state.Count, Limit: rateLimit, RetryAfter: state.RetryAfter, Available: state.Available}
}
