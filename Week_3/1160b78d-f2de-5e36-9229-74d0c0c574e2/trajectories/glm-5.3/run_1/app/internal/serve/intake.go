package serve

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"switchlamp/internal/copytext"
	"switchlamp/internal/domain"
	"switchlamp/internal/store"
)

const rateLimit = 120

// queuedEvent is the message body the queue carries, from any publisher.
type queuedEvent struct {
	EventID     string `json:"event_id"`
	RoutingKey  string `json:"routing_key"`
	DedupKey    string `json:"dedup_key"`
	KeySeq      int    `json:"key_seq"`
	EventAction string `json:"event_action"`
	Payload     struct {
		Summary  string `json:"summary"`
		Source   string `json:"source"`
		Severity string `json:"severity"`
	} `json:"payload"`
}

// handleIntake takes one monitoring event. The routing key authorises; there
// is no session and no cookie, so no origin check applies.
func (s *Server) handleIntake(w http.ResponseWriter, r *http.Request) {
	if r.ContentLength > intakeLimit {
		apiError(w, http.StatusRequestEntityTooLarge, "body_too_large")
		return
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, intakeLimit+1))
	if err != nil || int64(len(data)) > intakeLimit {
		apiError(w, http.StatusRequestEntityTooLarge, "body_too_large")
		return
	}
	var body map[string]json.RawMessage
	if err := json.Unmarshal(data, &body); err != nil {
		apiError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	ctx := r.Context()
	now := s.clock.Now()

	// Field validation, every bad field at once.
	fields := map[string]string{}
	var routingKey, action, dedupKey string
	if raw, ok := body["routing_key"]; ok {
		json.Unmarshal(raw, &routingKey)
	}
	if raw, ok := body["event_action"]; ok {
		json.Unmarshal(raw, &action)
	}
	if raw, ok := body["dedup_key"]; ok {
		json.Unmarshal(raw, &dedupKey)
	}
	if routingKey == "" {
		fields["routing_key"] = copytext.RoutingKeyRequired
	}
	switch action {
	case "trigger", "acknowledge", "resolve":
	default:
		fields["event_action"] = copytext.ActionInvalid
	}
	if (action == "acknowledge" || action == "resolve") && dedupKey == "" {
		fields["dedup_key"] = copytext.DedupRequired
	}
	if dedupKey != "" && len(dedupKey) > 255 {
		fields["dedup_key"] = copytext.DedupLength
	}
	var payload struct {
		Summary  string `json:"summary"`
		Source   string `json:"source"`
		Severity string `json:"severity"`
	}
	if raw, ok := body["payload"]; ok {
		_ = json.Unmarshal(raw, &payload)
	}
	if action == "trigger" {
		if payload.Summary == "" {
			fields["payload.summary"] = copytext.SummaryRequired
		} else if len(payload.Summary) > 1024 {
			fields["payload.summary"] = copytext.SummaryLength
		}
		if payload.Source == "" {
			fields["payload.source"] = copytext.SourceRequired
		}
		switch payload.Severity {
		case "critical", "error", "warning", "info":
		default:
			fields["payload.severity"] = copytext.SeverityInvalid
		}
	}
	if len(fields) > 0 {
		// Refused: nothing is published.
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_event", "errors": fields})
		s.logEvent(ctx, routingKey, "", action, dedupKey, domain.LogRefused,
			copytext.ReasonInvalidEvent+strings.Join(intakeFieldOrder(fields), ", ")+".", nil)
		return
	}

	// A request naming no known routing key is not logged.
	if _, err := s.store.IntegrationByRoutingKey(ctx, routingKey); err != nil {
		apiError(w, http.StatusNotFound, "unknown_routing_key")
		return
	}

	// The rate limit is counted in Valkey; the 120th is allowed.
	if s.cache.Up(ctx) {
		res, rerr := s.cache.RateCount(ctx, routingKey, now.Unix(), rateLimit)
		if rerr == nil && !res.Available {
			w.Header().Set("Retry-After", strconv.FormatInt(*res.RetryAfter, 10))
			writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": "rate_limited", "retry_after": *res.RetryAfter})
			s.logEvent(ctx, routingKey, "", action, dedupKey, domain.LogRefused, copytext.ReasonRateLimit, nil)
			return
		}
	}

	// Accepted only after the broker has confirmed holding it.
	eventID := newToken()
	if dedupKey == "" {
		dedupKey = eventID
	}
	keySeq, seqErr := s.nextKeySeq(ctx, routingKey, dedupKey)
	if seqErr != nil {
		apiError(w, http.StatusServiceUnavailable, "queue_unavailable")
		return
	}
	msg := map[string]any{
		"event_id":     eventID,
		"routing_key":  routingKey,
		"dedup_key":    dedupKey,
		"key_seq":      keySeq,
		"event_action": action,
		"payload":      payload,
		"accepted_at":  now.UTC().Format(time.RFC3339),
	}
	msgBody, _ := json.Marshal(msg)
	pubCtx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	if err := s.broker.PublishConfirm(pubCtx, msgBody); err != nil {
		// A number that did not get a broker confirm is reused.
		s.releaseKeySeq(ctx, routingKey, dedupKey)
		apiError(w, http.StatusServiceUnavailable, "queue_unavailable")
		s.logEvent(ctx, routingKey, "", action, dedupKey, domain.LogRefused, copytext.ReasonQueueDown, nil)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"status": "accepted", "event_id": eventID, "dedup_key": dedupKey,
	})
}

// intakeFieldOrder lists the bad fields in the intake sentence table's order.
func intakeFieldOrder(fields map[string]string) []string {
	order := []string{"routing_key", "event_action", "dedup_key", "payload.summary", "payload.source", "payload.severity"}
	out := []string{}
	for _, k := range order {
		if _, ok := fields[k]; ok {
			out = append(out, k)
		}
	}
	return out
}

// nextKeySeq numbers each accepted event per routing key and dedup key,
// starting at 1 with no gaps.
func (s *Server) nextKeySeq(ctx context.Context, routingKey, dedupKey string) (int, error) {
	if _, err := s.store.Pool().Exec(ctx, `INSERT INTO intake_seq (routing_key, dedup_key, last_seq)
		VALUES ($1,$2,0) ON CONFLICT DO NOTHING`, routingKey, dedupKey); err != nil {
		return 0, err
	}
	tag, err := s.store.Pool().Exec(ctx, `UPDATE intake_seq SET last_seq = last_seq + 1
		WHERE routing_key = $1 AND dedup_key = $2`, routingKey, dedupKey)
	if err != nil {
		return 0, err
	}
	if tag.RowsAffected() == 0 {
		return 0, errors.New("no row")
	}
	var n int
	if err := s.store.Pool().QueryRow(ctx, `SELECT last_seq FROM intake_seq
		WHERE routing_key = $1 AND dedup_key = $2`, routingKey, dedupKey).Scan(&n); err != nil {
		return 0, err
	}
	return n, nil
}

// releaseKeySeq lets a number that got no confirm be reused.
func (s *Server) releaseKeySeq(ctx context.Context, routingKey, dedupKey string) {
	s.store.Pool().Exec(ctx, `UPDATE intake_seq SET last_seq = greatest(last_seq - 1, 0)
		WHERE routing_key = $1 AND dedup_key = $2`, routingKey, dedupKey)
}

// logEvent writes one integration event-log row. A request naming no known
// routing key is not logged.
func (s *Server) logEvent(ctx context.Context, routingKey, eventID, action, dedupKey, outcome, reason string, incidentNumber *int64) {
	if routingKey == "" {
		return
	}
	integration, err := s.store.IntegrationByRoutingKey(ctx, routingKey)
	if err != nil {
		return
	}
	s.store.Pool().Exec(ctx, `INSERT INTO event_log (id, integration_id, event_id, at, action, dedup_key, outcome, reason, incident_number)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		genID(), integration.ID, eventID, s.clock.Now(), action, dedupKey, outcome, reason, incidentNumber)
}

// ConsumeEvents applies every message from the events queue, whoever published
// it. A nil body resubscribes after a reconnection.
func (s *Server) ConsumeEvents(ctx context.Context, body []byte) {
	if body == nil {
		return
	}
	var msg queuedEvent
	if err := json.Unmarshal(body, &msg); err != nil {
		s.deadLetterDirect(ctx, "", string(body), copytext.DeadNotJSON)
		return
	}
	now := s.engine.Now()
	_ = s.engine.ApplyDue(ctx, now)
	// A copy with an event_id already applied has no effect at all.
	var applied bool
	if err := s.store.Pool().QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM applied_events WHERE event_id = $1)`,
		msg.EventID).Scan(&applied); err == nil && applied {
		return
	}
	reason := s.validateQueued(ctx, &msg)
	if reason != "" {
		s.deadLetterDirect(ctx, msg.EventID, string(body), reason)
		s.logEvent(ctx, msg.RoutingKey, msg.EventID, msg.EventAction, msg.DedupKey, domain.LogDeadLettered, reason, nil)
		return
	}
	// Apply key_seq k only after k-1; a message that arrives early waits.
	if msg.KeySeq > 1 {
		var prev bool
		if err := s.store.Pool().QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM applied_seqs
			WHERE routing_key = $1 AND dedup_key = $2 AND key_seq = $3)`,
			msg.RoutingKey, msg.DedupKey, msg.KeySeq-1).Scan(&prev); err == nil && !prev {
			s.store.Pool().Exec(ctx, `INSERT INTO waiting_events (routing_key, dedup_key, key_seq, event_id, body, first_seen)
				VALUES ($1,$2,$3,$4,$5, now()) ON CONFLICT DO NOTHING`,
				msg.RoutingKey, msg.DedupKey, msg.KeySeq, msg.EventID, string(body))
			return
		}
	}
	s.applyQueued(ctx, &msg, now)
	// Any earlier numbers waiting behind this one now apply.
	s.drainWaiting(ctx, msg.RoutingKey, msg.DedupKey, msg.KeySeq)
}

// validateQueued rechecks the message, in the published order, and names the
// first problem.
func (s *Server) validateQueued(ctx context.Context, msg *queuedEvent) string {
	if msg.EventID == "" {
		return copytext.DeadMissing + "event_id."
	}
	if msg.RoutingKey == "" {
		return copytext.DeadMissing + "routing_key."
	}
	if _, err := s.store.IntegrationByRoutingKey(ctx, msg.RoutingKey); err != nil {
		return copytext.DeadRoutingKey + msg.RoutingKey + "."
	}
	if msg.DedupKey == "" {
		return copytext.DeadMissing + "dedup_key."
	}
	if msg.KeySeq < 1 {
		return copytext.DeadMissing + "key_seq."
	}
	switch msg.EventAction {
	case "trigger", "acknowledge", "resolve":
	default:
		return copytext.DeadMissing + "event_action."
	}
	if msg.EventAction == "trigger" {
		if msg.Payload.Summary == "" {
			return copytext.DeadMissing + "payload.summary."
		}
		if len(msg.Payload.Summary) > 1024 {
			return "Summary is longer than 1024 characters."
		}
		if msg.Payload.Source == "" {
			return copytext.DeadMissing + "payload.source."
		}
		switch msg.Payload.Severity {
		case "critical", "error", "warning", "info":
		default:
			return copytext.DeadSeverity + msg.Payload.Severity + "."
		}
	}
	return ""
}

// drainWaiting applies waiting messages whose predecessor has now applied.
func (s *Server) drainWaiting(ctx context.Context, routingKey, dedupKey string, justApplied int) {
	for {
		var waiting bool
		if err := s.store.Pool().QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM waiting_events
			WHERE routing_key = $1 AND dedup_key = $2 AND key_seq = $3)`,
			routingKey, dedupKey, justApplied+1).Scan(&waiting); err != nil || !waiting {
			return
		}
		var body string
		if err := s.store.Pool().QueryRow(ctx, `SELECT body FROM waiting_events
			WHERE routing_key = $1 AND dedup_key = $2 AND key_seq = $3`,
			routingKey, dedupKey, justApplied+1).Scan(&body); err != nil {
			return
		}
		s.store.Pool().Exec(ctx, `DELETE FROM waiting_events WHERE routing_key = $1 AND dedup_key = $2 AND key_seq = $3`,
			routingKey, dedupKey, justApplied+1)
		var next queuedEvent
		if err := json.Unmarshal([]byte(body), &next); err != nil {
			s.deadLetterDirect(ctx, "", body, copytext.DeadNotJSON)
			return
		}
		now := s.engine.Now()
		if reason := s.validateQueued(ctx, &next); reason != "" {
			s.deadLetterDirect(ctx, next.EventID, body, reason)
			return
		}
		s.applyQueued(ctx, &next, now)
		justApplied = next.KeySeq
	}
}

func (s *Server) deadLetterDirect(ctx context.Context, eventID, raw, reason string) {
	var routingKey string
	var m map[string]json.RawMessage
	if json.Unmarshal([]byte(raw), &m) == nil {
		json.Unmarshal(m["routing_key"], &routingKey)
	}
	s.store.Pool().Exec(ctx, `INSERT INTO dead_letters (id, event_id, routing_key, reason, raw, attempts, dead_at)
		VALUES ($1,$2,$3,$4,$5,3,now())`, genID(), eventID, routingKey, reason, raw)
}

// applyQueued applies one checked message in acceptance order.
func (s *Server) applyQueued(ctx context.Context, msg *queuedEvent, now time.Time) {
	integration, err := s.store.IntegrationByRoutingKey(ctx, msg.RoutingKey)
	if err != nil {
		return
	}
	rk := msg.RoutingKey
	s.store.Pool().Exec(ctx, `INSERT INTO applied_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING`, msg.EventID)
	s.store.Pool().Exec(ctx, `INSERT INTO applied_seqs (routing_key, dedup_key, key_seq) VALUES ($1,$2,$3)
		ON CONFLICT DO NOTHING`, rk, msg.DedupKey, msg.KeySeq)

	switch msg.EventAction {
	case "trigger":
		s.applyTrigger(ctx, integration, msg, now)
	case "acknowledge":
		s.applyAckEvent(ctx, integration, msg, now)
	case "resolve":
		s.applyResolveEvent(ctx, integration, msg, now)
	}
}

// openAlert finds the open alert for a key pair. A resolved alert never
// reopens, so it is invisible here and a new alert opens instead.
func (s *Server) openAlert(ctx context.Context, rk, dedup string) (string, string, string, bool) {
	var id, incidentID, status string
	err := s.store.Pool().QueryRow(ctx, `SELECT a.id, a.incident_id, a.status FROM alerts a
		WHERE a.routing_key = $1 AND a.dedup_key = $2 AND a.status != 'resolved'`, rk, dedup).Scan(&id, &incidentID, &status)
	if err != nil {
		return "", "", "", false
	}
	return id, incidentID, status, true
}

func (s *Server) applyTrigger(ctx context.Context, integration *store.IntegrationRecord, msg *queuedEvent, now time.Time) {
	rk := msg.RoutingKey
	dedup := msg.DedupKey
	if _, _, _, open := s.openAlert(ctx, rk, dedup); open {
		// A trigger on an open alert adds one to event_count and one repeat
		// entry, logs Applied, and sends nothing.
		var incidentID string
		s.store.Pool().QueryRow(ctx, `SELECT incident_id FROM alerts WHERE routing_key = $1 AND dedup_key = $2`,
			rk, dedup).Scan(&incidentID)
		inc, err := s.store.Incident(ctx, incidentID)
		if err != nil {
			return
		}
		s.store.Pool().Exec(ctx, `UPDATE alerts SET event_count = event_count + 1 WHERE routing_key = $1 AND dedup_key = $2`, rk, dedup)
		text := domain.TimelineText(domain.KindRepeatEvent, inc, dedup)
		s.store.Pool().Exec(ctx, `INSERT INTO timelines (id, incident_id, at, kind, actor, text)
			VALUES ($1,$2,$3,$4,$5,$6)`, genID(), incidentID, now, domain.KindRepeatEvent, integration.Name, text)
		num := inc.Number
		s.logEvent(ctx, rk, msg.EventID, "trigger", dedup, domain.LogApplied, "", &num)
		return
	}
	sv, err := s.store.Service(ctx, integration.ServiceID)
	if err != nil {
		return
	}
	// Trigger during a maintenance window: suppressed, no alert, no incident.
	var inWindow bool
	if err := s.store.Pool().QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM maintenance_windows
		WHERE service_id = $1 AND starts_at <= $2 AND ends_at > $2)`, sv.ID, now).Scan(&inWindow); err == nil && inWindow {
		s.logEvent(ctx, rk, msg.EventID, "trigger", dedup, domain.LogSuppressed, copytext.ReasonMaintenance, nil)
		return
	}
	inc, err := s.openIncidentForTrigger(ctx, sv, rk, dedup, msg.Payload.Summary, msg.Payload.Source, msg.Payload.Severity, now, integration.Name, false)
	if err != nil {
		if err == errNobodyOnCall {
			s.logEvent(ctx, rk, msg.EventID, "trigger", dedup, domain.LogDropped, copytext.ReasonNobodyOnCall, nil)
			return
		}
		return
	}
	num := inc.Number
	s.logEvent(ctx, rk, msg.EventID, "trigger", dedup, domain.LogApplied, "", &num)
}

func (s *Server) applyAckEvent(ctx context.Context, integration *store.IntegrationRecord, msg *queuedEvent, now time.Time) {
	rk := msg.RoutingKey
	dedup := msg.DedupKey
	alertID, incidentID, status, found := s.openAlert(ctx, rk, dedup)
	if !found {
		s.logEvent(ctx, rk, msg.EventID, "acknowledge", dedup, domain.LogDropped, copytext.ReasonNoAlert, nil)
		return
	}
	inc, err := s.store.Incident(ctx, incidentID)
	if err != nil {
		return
	}
	num := inc.Number
	if status == "resolved" {
		s.logEvent(ctx, rk, msg.EventID, "acknowledge", dedup, domain.LogDropped, copytext.ReasonAlreadyResolved, &num)
		return
	}
	if inc.Status == domain.StatusResolved {
		s.logEvent(ctx, rk, msg.EventID, "acknowledge", dedup, domain.LogDropped, copytext.ReasonAlreadyResolved, &num)
		return
	}
	if inc.Status == domain.StatusAcknowledged || inc.Status == domain.StatusSnoozed {
		s.logEvent(ctx, rk, msg.EventID, "acknowledge", dedup, domain.LogDropped, copytext.ReasonAlreadyAck, &num)
		return
	}
	if _, err := s.engine.Acknowledge(ctx, incidentID, integration.ID, integration.Name); err != nil {
		return
	}
	s.logEvent(ctx, rk, msg.EventID, "acknowledge", dedup, domain.LogApplied, "", &num)
	_ = alertID
}

func (s *Server) applyResolveEvent(ctx context.Context, integration *store.IntegrationRecord, msg *queuedEvent, now time.Time) {
	rk := msg.RoutingKey
	dedup := msg.DedupKey
	alertID, incidentID, status, found := s.openAlert(ctx, rk, dedup)
	if !found {
		s.logEvent(ctx, rk, msg.EventID, "resolve", dedup, domain.LogDropped, copytext.ReasonNoAlert, nil)
		return
	}
	inc, err := s.store.Incident(ctx, incidentID)
	if err != nil {
		return
	}
	num := inc.Number
	if status == "resolved" {
		s.logEvent(ctx, rk, msg.EventID, "resolve", dedup, domain.LogDropped, copytext.ReasonAlreadyResolved, &num)
		return
	}
	if inc.Status == domain.StatusResolved {
		s.logEvent(ctx, rk, msg.EventID, "resolve", dedup, domain.LogDropped, copytext.ReasonAlreadyResolved, &num)
		return
	}
	// The alert resolves, and the incident resolves when its last open alert does.
	s.store.Pool().Exec(ctx, `UPDATE alerts SET status = 'resolved', resolved_at = $2 WHERE id = $1`, alertID, now)
	var openCount int
	s.store.Pool().QueryRow(ctx, `SELECT count(*) FROM alerts WHERE incident_id = $1 AND status != 'resolved'`,
		incidentID).Scan(&openCount)
	if openCount == 0 {
		if _, err := s.engine.Resolve(ctx, incidentID, integration.Name); err != nil {
			return
		}
	}
	s.logEvent(ctx, rk, msg.EventID, "resolve", dedup, domain.LogApplied, "", &num)
}


// openIncidentForTrigger applies the grouping rule and opens the alert and
// incident, or joins an existing incident.
func (s *Server) openIncidentForTrigger(ctx context.Context, sv *store.ServiceRecord, rk, dedup, summary, source, severity string, now time.Time, actorName string, drill bool) (*domain.Incident, error) {
	// Nobody on call on the whole policy: no alert, no incident.
	snap, err := s.policySnapshotFor(ctx, sv)
	if err != nil {
		return nil, err
	}
	holders, empty, err := s.levelHoldersFor(ctx, snap.Levels[0], now)
	if err != nil {
		return nil, err
	}
	if empty && len(snap.Levels) == 0 {
		return nil, errNobodyOnCall
	}
	// Grouping decides which incident a new alert joins.
	target := s.groupingTarget(ctx, sv, now)
	urgency := domain.UrgencyOf(severity)

	var inc *domain.Incident
	if target != nil {
		inc = target
		// Joining never changes status, holder or timers, apart from the
		// urgency rule.
	} else {
		// Open a new incident.
		number, err := s.store.NextIncidentNumber(ctx)
		if err != nil {
			return nil, err
		}
		id := genID()
		holdersJSON, _ := json.Marshal(holders)
		escalateAt := (*time.Time)(nil)
		if urgency == "high" && len(snap.Levels) > 0 {
			t := now.Add(time.Duration(snap.Levels[0].TimeoutMinutes) * time.Minute)
			escalateAt = &t
		}
		var autoResolveAt (*time.Time)
		if sv.AutoResolveMinutes != nil {
			t := now.Add(time.Duration(*sv.AutoResolveMinutes) * time.Minute)
			autoResolveAt = &t
		}
		var groupingUntil (*time.Time)
		if sv.GroupingMode == "window" && sv.GroupingMinutes != nil {
			t := now.Add(time.Duration(*sv.GroupingMinutes) * time.Minute)
			groupingUntil = &t
		}
		if _, err := s.store.Pool().Exec(ctx, `INSERT INTO incidents (id, number, title, service_id, status, urgency,
			level, cycle, policy_snapshot, holders, opened_at, escalate_at, auto_resolve_at, grouping_until, version)
			VALUES ($1,$2,$3,$4,'triggered',$5,1,0,$6,$7,$8,$9,$10,$11,1)`,
			id, number, summary, sv.ID, urgency, mustJSON(snap), holdersJSON, now, escalateAt, autoResolveAt, groupingUntil); err != nil {
			return nil, err
		}
		inc, err = s.store.Incident(ctx, id)
		if err != nil {
			return nil, err
		}
		inc.SetMergeTarget(number)
		if err := s.writeEngineTimeline(ctx, inc, now, domain.KindTriggered, actorName,
			domain.TimelineText(domain.KindTriggered, inc)); err != nil {
			return nil, err
		}
		if !empty {
			if err := s.engineNotify(ctx, inc, now); err != nil {
				return nil, err
			}
		}
	}
	// Open the alert on the (possibly joined) incident.
	rkPtr := (*string)(nil)
	if !drill {
		rkPtr = &rk
	}
	if _, err := s.store.Pool().Exec(ctx, `INSERT INTO alerts (id, incident_id, routing_key, dedup_key, status,
		summary, source, severity, event_count, opened_at)
		VALUES ($1,$2,$3,$4,'triggered',$5,$6,$7,1,$8)`,
		genID(), inc.ID, rkPtr, dedup, summary, source, severity, now); err != nil {
		return nil, err
	}
	// Urgency follows the worst alert: a joining critical alert raises a
	// low-urgency incident and notifies its holder.
	after, err := s.store.Incident(ctx, inc.ID)
	if err != nil {
		return nil, err
	}
	if after.Urgency == "low" && urgency == "high" && after.Status == domain.StatusTriggered {
		s.raiseUrgency(ctx, after, now)
	}
	return s.store.Incident(ctx, inc.ID)
}

// groupingTarget finds the incident a new alert joins under the service's
// grouping mode.
func (s *Server) groupingTarget(ctx context.Context, sv *store.ServiceRecord, now time.Time) *domain.Incident {
	switch sv.GroupingMode {
	case "none":
		return nil
	case "until_resolved":
		inc, err := s.store.LatestIncidentForService(ctx, sv.ID)
		if err != nil {
			return nil
		}
		return inc
	case "window":
		// The service's most recent incident, while open and inside its window.
		var id string
		var groupingUntil *time.Time
		err := s.store.Pool().QueryRow(ctx, `SELECT id, grouping_until FROM incidents
			WHERE service_id = $1 AND status != 'resolved'
			ORDER BY opened_at DESC, number DESC LIMIT 1`, sv.ID).Scan(&id, &groupingUntil)
		if err != nil {
			return nil
		}
		if groupingUntil == nil {
			return nil
		}
		if !now.Before(*groupingUntil) {
			// The window has ended: a new incident with its own window opens.
			return nil
		}
		inc, err := s.store.Incident(ctx, id)
		if err != nil {
			return nil
		}
		return inc
	}
	return nil
}

// raiseUrgency applies the urgency rule: one entry at that second, pending
// low-urgency notices cancelled, escalation starts fresh, holders' steps
// restart from delay zero.
func (s *Server) raiseUrgency(ctx context.Context, inc *domain.Incident, now time.Time) {
	s.store.Pool().Exec(ctx, `UPDATE incidents SET urgency = 'high', level = 1, cycle = 0, version = version + 1 WHERE id = $1`, inc.ID)
	if inc.PolicySnapshot.Levels != nil && len(inc.PolicySnapshot.Levels) > 0 {
		esc := now.Add(time.Duration(inc.PolicySnapshot.Levels[0].TimeoutMinutes) * time.Minute)
		s.store.Pool().Exec(ctx, `UPDATE incidents SET escalate_at = $2 WHERE id = $1`, inc.ID, esc)
	}
	after, err := s.store.Incident(ctx, inc.ID)
	if err != nil {
		return
	}
	s.store.Pool().Exec(ctx, `UPDATE steps SET status = 'cancelled' WHERE incident_id = $1 AND status IN ('scheduled','held','queued') AND kind = 'low_urgency'`, inc.ID)
	s.writeEngineTimeline(ctx, after, now, domain.KindUrgencyRaised, "Switchlamp", domain.TimelineText(domain.KindUrgencyRaised, after))
	s.engineNotify(ctx, after, now)
}

func (s *Server) writeEngineTimeline(ctx context.Context, inc *domain.Incident, at time.Time, kind, actor, text string) error {
	_, err := s.store.Pool().Exec(ctx, `INSERT INTO timelines (id, incident_id, at, kind, actor, text)
		VALUES ($1,$2,$3,$4,$5,$6)`, genID(), inc.ID, at, kind, actor, text)
	if err == nil {
		s.live.AnnounceTimeline(ctx, inc.ID, domain.TimelineEntry{At: at, Kind: kind, Actor: actor, Text: text})
	}
	return err
}

func (s *Server) engineNotify(ctx context.Context, inc *domain.Incident, at time.Time) error {
	s.store.Pool().Exec(ctx, `UPDATE steps SET status = 'cancelled' WHERE incident_id = $1 AND status IN ('scheduled','held','queued')`, inc.ID)
	for _, h := range inc.Holders {
		u, err := s.store.User(ctx, h.ID)
		if err != nil {
			continue
		}
		sent := at
		s.store.Pool().Exec(ctx, `INSERT INTO steps (id, incident_id, person_id, kind, channel, due_at, status, sent_at)
			VALUES ($1,$2,$3,'step','in_app',$4,'sent',$5)`, genID(), inc.ID, h.ID, at, sent)
		if inc.Urgency == "high" {
			for _, d := range u.NotificationDelays {
				due := at.Add(time.Duration(d) * time.Minute)
				s.store.Pool().Exec(ctx, `INSERT INTO steps (id, incident_id, person_id, kind, channel, due_at, status)
					VALUES ($1,$2,$3,'step','email',$4,'scheduled')`, genID(), inc.ID, h.ID, due)
			}
		} else {
			due := at.Add(time.Duration(u.LowUrgencyDelay) * time.Minute)
			s.store.Pool().Exec(ctx, `INSERT INTO steps (id, incident_id, person_id, kind, channel, due_at, status)
				VALUES ($1,$2,$3,'low_urgency','email',$4,'scheduled')`, genID(), inc.ID, h.ID, due)
		}
	}
	return nil
}

