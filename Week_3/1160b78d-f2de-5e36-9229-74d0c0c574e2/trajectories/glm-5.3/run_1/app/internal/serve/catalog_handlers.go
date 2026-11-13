package serve

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"switchlamp/internal/copytext"
	"switchlamp/internal/domain"
	"switchlamp/internal/store"
)

func (s *Server) handleListPolicies(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	policies, err := s.store.Policies(r.Context())
	if err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	items := make([]map[string]any, 0, len(policies))
	for _, p := range policies {
		items = append(items, policyJSON(p))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func policyJSON(p *store.PolicyRecord) map[string]any {
	return map[string]any{"id": p.ID, "name": p.Name, "repeats": p.Repeats, "levels": p.Levels, "version": p.Version}
}

func (s *Server) handleGetPolicy(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	p, err := s.store.Policy(r.Context(), r.PathValue("id"))
	if err != nil {
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	etag := `"` + strconv.Itoa(p.Version) + `"`
	w.Header().Set("ETag", etag)
	if match := r.Header.Get("If-None-Match"); match == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	writeJSON(w, http.StatusOK, policyJSON(p))
}

func (s *Server) handleListServices(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	services, err := s.store.Services(ctx)
	if err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	byID := map[string]*store.ServiceRecord{}
	for _, sv := range services {
		byID[sv.ID] = sv
	}
	items := make([]map[string]any, 0, len(services))
	for _, sv := range services {
		own, shown := s.serviceStatus(ctx, sv, byID)
		items = append(items, serviceJSON(sv, own, shown))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func serviceJSON(sv *store.ServiceRecord, own, shown string) map[string]any {
	return map[string]any{
		"id": sv.ID, "name": sv.Name, "team": sv.Team, "policy_id": sv.PolicyID,
		"depends_on": sv.DependsOn, "grouping_mode": sv.GroupingMode,
		"grouping_minutes": sv.GroupingMinutes, "ack_timeout_minutes": sv.AckTimeoutMinutes,
		"auto_resolve_minutes": sv.AutoResolveMinutes, "version": sv.Version,
		"own_status": own, "status": shown,
	}
}

func (s *Server) handleGetService(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	sv, err := s.store.Service(ctx, r.PathValue("id"))
	if err != nil {
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	services, _ := s.store.Services(ctx)
	byID := map[string]*store.ServiceRecord{}
	for _, s2 := range services {
		byID[s2.ID] = s2
	}
	own, shown := s.serviceStatus(ctx, sv, byID)
	etag := `"` + strconv.Itoa(sv.Version) + `"`
	w.Header().Set("ETag", etag)
	if match := r.Header.Get("If-None-Match"); match == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	writeJSON(w, http.StatusOK, serviceJSON(sv, own, shown))
}

// serviceStatus decides a service's own and shown status words in one place.
func (s *Server) serviceStatus(ctx context.Context, sv *store.ServiceRecord, byID map[string]*store.ServiceRecord) (own, shown string) {
	now := s.engine.Now()
	// Own status: an open alert of that severity decides it.
	var worst string
	rows, err := s.store.Pool().Query(ctx, `SELECT DISTINCT a.severity FROM alerts a
		JOIN incidents i ON i.id = a.incident_id
		WHERE a.status != 'resolved' AND i.status != 'resolved' AND i.service_id = $1`, sv.ID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var sev string
			if rows.Scan(&sev) == nil {
				switch sev {
				case "critical":
					worst = domain.WorstStatus(worst, domain.StatusMajorOutage)
				case "error":
					worst = domain.WorstStatus(worst, domain.StatusPartial)
				case "warning", "info":
					worst = domain.WorstStatus(worst, domain.StatusDegraded)
				}
			}
		}
	}
	if worst != "" {
		own = worst
	} else {
		// Maintenance inside a running window.
		var inWindow bool
		if err := s.store.Pool().QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM maintenance_windows
			WHERE service_id = $1 AND starts_at <= $2 AND ends_at > $2)`, sv.ID, now).Scan(&inWindow); err == nil && inWindow {
			own = domain.StatusMaintenance
		} else {
			own = domain.StatusOperational
		}
	}
	// Shown status: the worst of its own and every service it depends on.
	shown = own
	for _, dep := range sv.DependsOn {
		if d, ok := byID[dep]; ok {
			_, depShown := s.serviceStatus(ctx, d, byID)
			shown = domain.WorstStatus(shown, depShown)
		}
	}
	return own, shown
}

func (s *Server) handleListMaintenance(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	now := s.engine.Now()
	rows, err := s.store.Pool().Query(ctx, `SELECT id, service_id, starts_at, ends_at FROM maintenance_windows ORDER BY starts_at`)
	if err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, serviceID string
		var startsAt, endsAt time.Time
		if err := rows.Scan(&id, &serviceID, &startsAt, &endsAt); err != nil {
			apiError(w, http.StatusInternalServerError, "internal")
			return
		}
		state := domain.WindowUpcoming
		if !startsAt.After(now) && now.Before(endsAt) {
			state = domain.WindowRunning
		} else if !now.Before(endsAt) {
			state = domain.WindowEnded
		}
		items = append(items, map[string]any{
			"id": id, "service_id": serviceID,
			"starts_at": startsAt.UTC().Format(time.RFC3339),
			"ends_at":   endsAt.UTC().Format(time.RFC3339), "state": state,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleCreateMaintenance(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	var body struct {
		ServiceID string `json:"service_id"`
		StartsAt  string `json:"starts_at"`
		EndsAt    string `json:"ends_at"`
	}
	if err := readBody(w, r, &body, bodyLimit); err != nil {
		return
	}
	ctx := r.Context()
	starts, err1 := time.Parse(time.RFC3339, body.StartsAt)
	ends, err2 := time.Parse(time.RFC3339, body.EndsAt)
	if err1 != nil || err2 != nil {
		errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"starts_at": copytext.FmtDateTime})
		return
	}
	if !ends.After(starts) {
		errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"ends_at": copytext.WindowEnd})
		return
	}
	now := s.engine.Now()
	if starts.Before(now) {
		errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"starts_at": copytext.WindowPast})
		return
	}
	if _, err := s.store.Service(ctx, body.ServiceID); err != nil {
		errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"service_id": copytext.ChooseService})
		return
	}
	id := genID()
	if _, err := s.store.Pool().Exec(ctx, `INSERT INTO maintenance_windows (id, service_id, starts_at, ends_at)
		VALUES ($1,$2,$3,$4)`, id, body.ServiceID, starts, ends); err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	s.cache.Del(ctx, "cache:status:json", "cache:status:html")
	writeJSON(w, http.StatusCreated, map[string]any{
		"id": id, "service_id": body.ServiceID,
		"starts_at": starts.UTC().Format(time.RFC3339),
		"ends_at":   ends.UTC().Format(time.RFC3339), "state": domain.WindowUpcoming,
	})
}

func (s *Server) handleDeleteMaintenance(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	if _, err := s.store.Pool().Exec(ctx, `DELETE FROM maintenance_windows WHERE id = $1`, r.PathValue("id")); err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	s.cache.Del(ctx, "cache:status:json", "cache:status:html")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleListIntegrations(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	integrations, err := s.store.Integrations(r.Context())
	if err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	items := make([]map[string]any, 0, len(integrations))
	for _, i := range integrations {
		items = append(items, map[string]any{"id": i.ID, "service_id": i.ServiceID, "name": i.Name, "routing_key": i.RoutingKey})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleGetIntegration(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	i, err := s.store.Integration(ctx, r.PathValue("id"))
	if err != nil {
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	body := map[string]any{"id": i.ID, "service_id": i.ServiceID, "name": i.Name, "routing_key": i.RoutingKey}
	now := s.engine.Now()
	if s.cache.Up(ctx) {
		res, err := s.cache.RateRead(ctx, i.RoutingKey, now.Unix(), rateLimit)
		if err == nil {
			body["counter"] = map[string]any{
				"count": res.Count, "limit": rateLimit, "retry_after": res.RetryAfter, "available": res.Available,
			}
		} else {
			body["counter"] = map[string]any{"count": nil, "limit": rateLimit, "retry_after": nil, "available": true}
		}
	} else {
		body["counter"] = map[string]any{"count": nil, "limit": rateLimit, "retry_after": nil, "available": true}
	}
	writeJSON(w, http.StatusOK, body)
}

func (s *Server) handleIntegrationEvents(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	i, err := s.store.Integration(ctx, r.PathValue("id"))
	if err != nil {
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	limit := 25
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 1 && n <= 100 {
			limit = n
		}
	}
	after := r.URL.Query().Get("after")
	rows, err := s.store.Pool().Query(ctx, `SELECT id, event_id, at, action, dedup_key, outcome, reason, incident_number
		FROM event_log WHERE integration_id = $1 AND ($2 = '' OR at < $2::timestamptz)
		ORDER BY at DESC LIMIT $3`, i.ID, after, limit)
	if err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	var lastAt *string
	for rows.Next() {
		var id, eventID, action, dedupKey, outcome string
		var at time.Time
		var reason *string
		var number *int64
		if err := rows.Scan(&id, &eventID, &at, &action, &dedupKey, &outcome, &reason, &number); err != nil {
			apiError(w, http.StatusInternalServerError, "internal")
			return
		}
		a := at.UTC().Format(time.RFC3339)
		lastAt = &a
		items = append(items, map[string]any{
			"event_id": eventID, "at": a, "action": action, "dedup_key": dedupKey,
			"outcome": outcome, "reason": reason, "incident_number": number,
		})
	}
	var next any
	if len(items) == limit && lastAt != nil {
		next = *lastAt
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "next_cursor": next})
}

func (s *Server) handleDeadLetters(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	q := `SELECT id, event_id, routing_key, reason, raw, attempts, dead_at FROM dead_letters`
	args := []any{}
	if v := r.URL.Query().Get("integration_id"); v != "" {
		var routing string
		if i, err := s.store.Integration(ctx, v); err == nil {
			routing = i.RoutingKey
		}
		q += ` WHERE routing_key = $1`
		args = append(args, routing)
	}
	q += ` ORDER BY dead_at`
	rows, err := s.store.Pool().Query(ctx, q, args...)
	if err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, routingKey, reason, raw string
		var eventID *string
		var attempts int
		var deadAt time.Time
		if err := rows.Scan(&id, &eventID, &routingKey, &reason, &raw, &attempts, &deadAt); err != nil {
			apiError(w, http.StatusInternalServerError, "internal")
			return
		}
		items = append(items, map[string]any{
			"id": id, "event_id": eventID, "routing_key": routingKey, "reason": reason,
			"raw": raw, "attempts": attempts, "dead_at": deadAt.UTC().Format(time.RFC3339),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// handleReplayDeadLetter applies a dead letter exactly once through Replay.
func (s *Server) handleReplayDeadLetter(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	var raw, reason string
	var eventID *string
	var routingKey string
	var replayedAt *time.Time
	if err := s.store.Pool().QueryRow(ctx, `SELECT raw, reason, event_id, routing_key, replayed_at
		FROM dead_letters WHERE id = $1`, r.PathValue("id")).
		Scan(&raw, &reason, &eventID, &routingKey, &replayedAt); err != nil {
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	if replayedAt != nil {
		apiError(w, http.StatusConflict, "already_replayed")
		return
	}
	// An optional correction replaces the stored message.
	var body struct {
		Message json.RawMessage `json:"message"`
	}
	if r.ContentLength > 0 {
		if err := readBody(w, r, &body, bodyLimit); err != nil {
			return
		}
	}
	useRaw := raw
	if len(body.Message) > 0 {
		useRaw = string(body.Message)
	}
	var msg queuedEvent
	if err := json.Unmarshal([]byte(useRaw), &msg); err != nil {
		errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"message": copytext.DeadNotJSON})
		return
	}
	now := s.engine.Now()
	_ = s.engine.ApplyDue(ctx, now)
	if check := s.validateQueued(ctx, &msg); check != "" {
		errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"message": check})
		return
	}
	// Replay applies as of now, once.
	var appliedBefore bool
	if msg.EventID != "" {
		s.store.Pool().QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM applied_events WHERE event_id = $1)`, msg.EventID).Scan(&appliedBefore)
	}
	if !appliedBefore {
		s.applyQueued(ctx, &msg, now)
	}
	s.store.Pool().Exec(ctx, `UPDATE dead_letters SET replayed_at = now() WHERE id = $1`, r.PathValue("id"))
	s.store.Pool().Exec(ctx, `DELETE FROM dead_letters WHERE id = $1`, r.PathValue("id"))
	id := ""
	if eventID != nil {
		id = *eventID
	}
	s.logEvent(ctx, msg.RoutingKey, id, msg.EventAction, msg.DedupKey, domain.LogReplayed, "", nil)
	writeJSON(w, http.StatusOK, map[string]any{"status": "replayed", "event_id": id})
}

var _ = json.Marshal
