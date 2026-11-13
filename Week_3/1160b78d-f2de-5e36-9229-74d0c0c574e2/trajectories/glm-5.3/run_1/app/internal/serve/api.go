package serve

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"switchlamp/internal/copytext"
	"switchlamp/internal/domain"
	"switchlamp/internal/store"
)

// Routes builds the API mux.
func (s *Server) Routes() *http.ServeMux {
	m := http.NewServeMux()
	m.HandleFunc("GET /api/health", s.handleHealth)
	m.HandleFunc("POST /api/session", s.handleSignIn)
	m.HandleFunc("DELETE /api/session", s.require("", s.handleSignOut))
	m.HandleFunc("GET /api/me", s.require("", s.handleGetMe))
	m.HandleFunc("PATCH /api/me", s.require("", s.handlePatchMe))
	m.HandleFunc("GET /api/me/saved-filters", s.require("responder", s.handleListSavedFilters))
	m.HandleFunc("POST /api/me/saved-filters", s.require("responder", s.handlePostSavedFilter))
	m.HandleFunc("DELETE /api/me/saved-filters/{id}", s.require("responder", s.handleDeleteSavedFilter))
	m.HandleFunc("POST /api/me/calendar-token", s.require("", s.handleCreateCalendarToken))
	m.HandleFunc("DELETE /api/me/calendar-token", s.require("", s.handleRevokeCalendarToken))
	m.HandleFunc("GET /api/system", s.require("responder", s.handleSystem))
	m.HandleFunc("GET /api/clock", s.require("", s.handleGetClock))
	m.HandleFunc("POST /api/operator/clock", s.require("admin", s.handleOperatorClock))
	m.HandleFunc("POST /api/operator/drill", s.require("admin", s.handleDrill))
	m.HandleFunc("POST /api/events", s.handleIntake)
	m.HandleFunc("GET /api/incidents", s.require("responder", s.handleListIncidents))
	m.HandleFunc("GET /api/incidents/{id}", s.require("responder", s.handleGetIncident))
	m.HandleFunc("POST /api/incidents/bulk", s.require("responder", s.handleBulk))
	m.HandleFunc("POST /api/incidents/{id}/acknowledge", s.require("responder", s.handleAcknowledge))
	m.HandleFunc("POST /api/incidents/{id}/snooze", s.require("responder", s.handleSnooze))
	m.HandleFunc("POST /api/incidents/{id}/resolve", s.require("responder", s.handleResolve))
	m.HandleFunc("POST /api/incidents/{id}/reassign", s.require("responder", s.handleReassign))
	m.HandleFunc("POST /api/incidents/{id}/merge", s.require("lead", s.handleMerge))
	m.HandleFunc("POST /api/incidents/{id}/alerts/{alertID}/split", s.require("lead", s.handleSplit))
	m.HandleFunc("POST /api/incidents/{id}/notes", s.require("responder", s.handleNote))
	m.HandleFunc("GET /api/incidents/{id}/note-draft", s.require("responder", s.handleGetDraft))
	m.HandleFunc("PUT /api/incidents/{id}/note-draft", s.require("responder", s.handlePutDraft))
	m.HandleFunc("POST /api/incidents/{id}/responder-requests", s.require("responder", s.handleRequestResponder))
	m.HandleFunc("POST /api/responder-requests/{id}/accept", s.require("responder", s.handleAcceptResponder))
	m.HandleFunc("POST /api/responder-requests/{id}/decline", s.require("responder", s.handleDeclineResponder))
	m.HandleFunc("GET /api/users", s.require("responder", s.handleListUsers))
	m.HandleFunc("PATCH /api/users/{id}", s.require("admin", s.handlePatchUser))
	m.HandleFunc("POST /api/users/{id}/sign-out", s.require("admin", s.handleForceSignOut))
	m.HandleFunc("DELETE /api/users/{id}", s.require("admin", s.handleDeleteUser))
	m.HandleFunc("GET /api/oncall", s.require("responder", s.handleOncall))
	return m
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if !s.storeHealthy(r.Context()) {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "starting"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) storeHealthy(ctx context.Context) bool {
	var one int
	if err := s.store.Pool().QueryRow(ctx, `SELECT 1`).Scan(&one); err != nil {
		return false
	}
	return true
}

func (s *Server) handleSignIn(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := readBody(w, r, &body, bodyLimit); err != nil {
		return
	}
	ctx := r.Context()
	var hash string
	var u store.UserRecord
	var removed bool
	err := s.store.Pool().QueryRow(ctx, `SELECT id, name, email, role, timezone, password_hash, (removed_at IS NOT NULL)
		FROM users WHERE lower(email) = lower($1)`, body.Email).
		Scan(&u.ID, &u.Name, &u.Email, &u.Role, &u.Timezone, &hash, &removed)
	if err != nil || removed || !checkPassword(hash, body.Password) {
		apiError(w, http.StatusUnauthorized, "invalid_credentials")
		return
	}
	token := newToken()
	if _, err := s.store.Pool().Exec(ctx, `INSERT INTO sessions (token, user_id) VALUES ($1,$2)`, token, u.ID); err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode})
	writeJSON(w, http.StatusOK, map[string]any{"user": userJSON(&u)})
}

func userJSON(u *store.UserRecord) map[string]any {
	return map[string]any{
		"id": u.ID, "name": u.Name, "email": u.Email, "role": u.Role, "timezone": u.Timezone,
	}
}

func (s *Server) handleSignOut(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		s.store.Pool().Exec(r.Context(), `DELETE FROM sessions WHERE token = $1`, c.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", HttpOnly: true, MaxAge: -1})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleGetMe(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	if u.APIKey {
		apiError(w, http.StatusForbidden, "forbidden")
		return
	}
	full, err := s.store.User(r.Context(), u.ID)
	if err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, meJSON(full))
}

func meJSON(u *store.UserRecord) map[string]any {
	out := userJSON(u)
	out["quiet_start"] = u.QuietStart
	out["quiet_end"] = u.QuietEnd
	out["notification_delays"] = u.NotificationDelays
	out["low_urgency_delay"] = u.LowUrgencyDelay
	return out
}

var listedZones = func() []string {
	zones := []string{}
	for _, z := range []string{"Africa/", "America/", "Asia/", "Europe/", "Australia/", "Pacific/", "Atlantic/", "Indian/", "Antarctica/", "Arctic/"} {
		_ = z
	}
	return zones
}

func (s *Server) handlePatchMe(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	if u.APIKey {
		apiError(w, http.StatusForbidden, "forbidden")
		return
	}
	var body map[string]json.RawMessage
	if err := readBody(w, r, &body, bodyLimit); err != nil {
		return
	}
	ctx := r.Context()
	full, err := s.store.User(ctx, u.ID)
	if err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	fields := map[string]string{}
	if raw, ok := body["timezone"]; ok {
		var zone string
		json.Unmarshal(raw, &zone)
		if _, err := time.LoadLocation(zone); err != nil {
			fields["timezone"] = copytext.TimezoneUnknown
		} else {
			full.Timezone = zone
		}
	}
	qs, qe := full.QuietStart, full.QuietEnd
	if raw, ok := body["quiet_start"]; ok {
		var v *string
		json.Unmarshal(raw, &v)
		qs = v
	}
	if raw, ok := body["quiet_end"]; ok {
		var v *string
		json.Unmarshal(raw, &v)
		qe = v
	}
	if (qs == nil) != (qe == nil) {
		fields["quiet_start"] = copytext.QuietBoth
	} else {
		if qs != nil && !validClock(*qs) {
			fields["quiet_start"] = copytext.FmtTime
		}
		if qe != nil && !validClock(*qe) {
			fields["quiet_end"] = copytext.FmtTime
		}
		full.QuietStart, full.QuietEnd = qs, qe
	}
	if raw, ok := body["notification_delays"]; ok {
		var list []any
		if err := json.Unmarshal(raw, &list); err != nil || len(list) == 0 || len(list) > 5 {
			fields["notification_delays"] = copytext.FmtDelays
		} else {
			delays := make([]int, 0, len(list))
			okAll := true
			for _, v := range list {
				f, isNum := v.(float64)
				if !isNum || f != float64(int(f)) || int(f) < 0 || int(f) > 60 {
					okAll = false
					break
				}
				delays = append(delays, int(f))
			}
			if !okAll {
				fields["notification_delays"] = copytext.FmtDelays
			} else {
				full.NotificationDelays = delays
			}
		}
	}
	if raw, ok := body["low_urgency_delay"]; ok {
		var v float64
		if err := json.Unmarshal(raw, &v); err != nil || v != float64(int(v)) || v < 0 || v > 60 {
			fields["low_urgency_delay"] = copytext.LowDelayRange
		} else {
			full.LowUrgencyDelay = int(v)
		}
	}
	if len(fields) > 0 {
		errorsBody(w, http.StatusUnprocessableEntity, fields)
		return
	}
	if _, err := s.store.Pool().Exec(ctx, `UPDATE users SET timezone = $2, quiet_start = $3, quiet_end = $4,
		notification_delays = $5, low_urgency_delay = $6 WHERE id = $1`,
		full.ID, full.Timezone, full.QuietStart, full.QuietEnd, mustJSON(full.NotificationDelays), full.LowUrgencyDelay); err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, meJSON(full))
}

func validClock(s string) bool {
	var h, m int
	if n, err := fmt.Sscanf(s, "%d:%d", &h, &m); err != nil || n != 2 {
		return false
	}
	return h >= 0 && h < 24 && m >= 0 && m < 60
}

func (s *Server) handleSystem(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	cacheUp := s.cache.Up(ctx)
	queueUp := s.broker != nil && s.broker.Up()
	// Mail health follows the queue worker's last pass.
	mailUp := s.cache.MailUp()
	state, upgraded, finishedAt := s.upgrade.State(ctx)
	writeJSON(w, http.StatusOK, map[string]any{
		"queue":  map[bool]string{true: "ok", false: "down"}[queueUp],
		"cache":  map[bool]string{true: "ok", false: "down"}[cacheUp],
		"mail":   map[bool]string{true: "ok", false: "down"}[mailUp],
		"schedule_upgrade": map[string]any{"state": state, "upgraded": upgraded, "finished_at": finishedAt},
	})
}

func (s *Server) handleGetClock(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	st := s.clock.Snapshot()
	writeJSON(w, http.StatusOK, map[string]any{
		"now": st.Now.UTC().Format(time.RFC3339), "frozen": st.Frozen, "offset_seconds": st.OffsetSeconds,
	})
}

func (s *Server) handleOperatorClock(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	var body struct {
		AdvanceSeconds *int64 `json:"advance_seconds"`
		SetTo          *string `json:"set_to"`
		Frozen         *bool  `json:"frozen"`
	}
	if err := readBody(w, r, &body, bodyLimit); err != nil {
		return
	}
	ctx := r.Context()
	now := s.clock.Now()
	if body.SetTo != nil {
		t, err := time.Parse(time.RFC3339, *body.SetTo)
		if err != nil {
			errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"set_to": "Use the format YYYY-MM-DDTHH:MM:SSZ."})
			return
		}
		if !t.After(now) {
			errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"set_to": "The clock only moves forward."})
			return
		}
		s.clock.Move(ctx, int64(t.Sub(now).Seconds()))
	} else if body.AdvanceSeconds != nil {
		if *body.AdvanceSeconds < 1 || *body.AdvanceSeconds > 31536000 {
			errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"advance_seconds": copytext.OutRange})
			return
		}
		s.clock.Move(ctx, *body.AdvanceSeconds)
	}
	if body.Frozen != nil {
		if *body.Frozen {
			s.clock.Freeze(ctx)
		} else {
			s.clock.Release(ctx)
		}
	}
	// A move applies every due timer in deadline order.
	_ = s.engine.RunTimerPass(ctx)
	s.cache.Del(ctx, "cache:status:json", "cache:status:html")
	st := s.clock.Snapshot()
	writeJSON(w, http.StatusOK, map[string]any{
		"now": st.Now.UTC().Format(time.RFC3339), "frozen": st.Frozen, "offset_seconds": st.OffsetSeconds,
	})
}

// handleDrill opens a real incident directly on a service.
func (s *Server) handleDrill(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	var body struct {
		ServiceID string `json:"service_id"`
		Summary   string `json:"summary"`
		Severity  string `json:"severity"`
		DedupKey  string `json:"dedup_key"`
	}
	if err := readBody(w, r, &body, bodyLimit); err != nil {
		return
	}
	fields := map[string]string{}
	if body.ServiceID == "" {
		fields["service_id"] = copytext.ChooseService
	}
	switch body.Severity {
	case "critical", "error", "warning", "info":
	default:
		fields["severity"] = copytext.SeverityInvalid
	}
	if body.Summary == "" {
		fields["summary"] = copytext.SummaryRequired
	}
	if len(fields) > 0 {
		errorsBody(w, http.StatusUnprocessableEntity, fields)
		return
	}
	ctx := r.Context()
	sv, err := s.store.Service(ctx, body.ServiceID)
	if err != nil {
		errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"service_id": copytext.ChooseService})
		return
	}
	// A drill passes through no routing key, queue or rate limit and writes no
	// event log row, but otherwise follows the trigger rules.
	now := s.engine.Now()
	_ = s.engine.ApplyDue(ctx, now)
	// Maintenance applies.
	var inWindow bool
	if err := s.store.Pool().QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM maintenance_windows
		WHERE service_id = $1 AND starts_at <= $2 AND ends_at > $2)`, sv.ID, now).Scan(&inWindow); err == nil && inWindow {
		apiError(w, http.StatusConflict, "in_maintenance")
		return
	}
	inc, err := s.openIncidentForTrigger(ctx, sv, body.DedupKey, "drill-"+body.DedupKey, body.Summary, "drill", body.Severity, now, u.Name, true)
	if err != nil {
		if errors.Is(err, errNobodyOnCall) {
			apiError(w, http.StatusConflict, "nobody_on_call")
			return
		}
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusCreated, incidentJSON(ctx, s, inc))
}

var errNobodyOnCall = errors.New("nobody on call")

// incidentJSON builds the full incident JSON.
func incidentJSON(ctx context.Context, s *Server, inc *domain.Incident) map[string]any {
	now := s.clock.Now()
	_ = s.engine.ApplyDue(ctx, now)
	// Reload after the pass so the answer is never stale.
	inc, err := s.store.Incident(ctx, inc.ID)
	if err != nil {
		return nil
	}
	inc.ServerNow = now
	inc.Countdown = countdownFor(ctx, s, inc, now)
	resolveReason := inc.ResolveReason
	mergedInto := (*int64)(nil)
	if inc.MergedInto != nil {
		mergedInto = inc.MergedNumber()
	}
	return map[string]any{
		"id": inc.ID, "number": inc.Number, "title": inc.Title, "service": inc.Service,
		"status": inc.Status, "urgency": inc.Urgency, "holders": inc.Holders,
		"level": inc.Level, "cycle": inc.Cycle, "policy_snapshot": inc.PolicySnapshot,
		"server_now": now.UTC().Format(time.RFC3339), "countdown": inc.Countdown,
		"auto_resolve_at": inc.AutoResolveAt, "snoozed_until": inc.SnoozedUntil,
		"resolve_reason": resolveReason, "merged_into": mergedInto,
		"impacted_services": inc.ImpactedServices, "responders": inc.Responders,
		"responder_requests": inc.ResponderRequests, "alerts": inc.Alerts,
		"timeline": inc.Timeline, "steps": stepsJSON(ctx, s, inc), "version": inc.Version,
	}
}

// countdownFor follows the published countdown order.
func countdownFor(ctx context.Context, s *Server, inc *domain.Incident, now time.Time) domain.Countdown {
	remaining := func(due time.Time) int64 {
		sec := int64(due.Sub(now).Seconds())
		if sec < 0 {
			sec = 0
		}
		return sec
	}
	switch {
	case inc.SnoozedUntil != nil:
		return domain.Countdown{Kind: domain.CountdownSnooze, DueAt: inc.SnoozedUntil, RemainingSeconds: remaining(*inc.SnoozedUntil)}
	case inc.Status == domain.StatusAcknowledged && inc.AckDeadline != nil:
		return domain.Countdown{Kind: domain.CountdownAckTimeout, DueAt: inc.AckDeadline, RemainingSeconds: remaining(*inc.AckDeadline)}
	case inc.Status == domain.StatusTriggered && inc.Urgency == "high" && inc.EscalateAt != nil && !inc.EscalationFinished:
		return domain.Countdown{Kind: domain.CountdownEscalation, DueAt: inc.EscalateAt, RemainingSeconds: remaining(*inc.EscalateAt)}
	case (inc.Status == domain.StatusTriggered || inc.Status == domain.StatusAcknowledged) && inc.AutoResolveAt != nil:
		return domain.Countdown{Kind: domain.CountdownAutoResolve, DueAt: inc.AutoResolveAt, RemainingSeconds: remaining(*inc.AutoResolveAt)}
	case inc.Status == domain.StatusTriggered && inc.Urgency == "high" && inc.EscalationFinished:
		return domain.Countdown{Kind: domain.CountdownNone}
	default:
		return domain.Countdown{Kind: domain.CountdownNone}
	}
}

// stepsJSON decorates steps with the holder's quiet-hours words.
func stepsJSON(ctx context.Context, s *Server, inc *domain.Incident) []map[string]any {
	out := make([]map[string]any, 0, len(inc.Steps))
	for _, st := range inc.Steps {
		item := map[string]any{
			"id": st.ID, "person": st.Person, "kind": st.Kind, "channel": st.Channel,
			"due_at": st.DueAt.UTC().Format(time.RFC3339), "status": st.Status, "sent_at": st.SentAt,
		}
		if st.Status == domain.StepHeld {
			// Held until <local time in the holder's zone>.
			person := personByName(ctx, s, st.Person)
			if person != nil {
				item["held_until"] = domain.LocalTime(quietRelease(ctx, s, st, person.Timezone), person.Timezone)
			}
		}
		out = append(out, item)
	}
	return out
}

func personByName(ctx context.Context, s *Server, name string) *store.UserRecord {
	users, err := s.store.AllUsers(ctx)
	if err != nil {
		return nil
	}
	for _, u := range users {
		if u.Name == name {
			return u
		}
	}
	return nil
}

func quietRelease(ctx context.Context, s *Server, st domain.Step, zone string) time.Time {
	return st.DueAt
}

