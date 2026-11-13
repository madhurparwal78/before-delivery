package web

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"strings"
	"time"

	"switchlamp/internal/core"
)

func (s *Server) staticHandler() http.Handler {
	assets, err := fs.Sub(staticFS, "static")
	if err != nil {
		panic(err)
	}
	fileServer := http.FileServer(http.FS(assets))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=3600")
		fileServer.ServeHTTP(w, r)
	})
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	if !s.app.Ready() {
		writeJSON(w, 503, map[string]any{"status": "starting"})
		return
	}
	writeJSON(w, 200, map[string]any{"status": "ok"})
}

func (s *Server) systemState(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	return s.app.SystemState(), nil
}

// intake takes a monitoring event. It carries no cookie and has its own limit.
func (s *Server) intake(w http.ResponseWriter, r *http.Request) {
	if !s.app.Ready() {
		writeJSON(w, 503, map[string]any{"status": "starting"})
		return
	}
	body, sizeErr := s.readBody(r, 512000)
	if sizeErr != nil {
		writeJSON(w, sizeErr.Status, sizeErr.Body)
		return
	}
	if err := s.app.Tick(r.Context()); err != nil {
		writeJSON(w, 500, map[string]any{"error": "internal"})
		return
	}
	result, apiErr := s.app.Intake(r.Context(), body)
	if apiErr != nil {
		if apiErr.Status == 429 {
			if retry, ok := apiErr.Body["retry_after"].(int); ok {
				w.Header().Set("Retry-After", fmt.Sprint(retry))
			}
		}
		writeJSON(w, apiErr.Status, apiErr.Body)
		return
	}
	writeJSON(w, 202, result)
}

func (s *Server) signIn(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	user, token, err := s.app.SignIn(r.Context(), stringField(state.JSON, "email"), stringField(state.JSON, "password"))
	if err != nil {
		return nil, err
	}
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: token, Path: "/", HttpOnly: true,
		SameSite: http.SameSiteLaxMode, MaxAge: 60 * 60 * 24 * 7,
	})
	return map[string]any{"user": user}, nil
}

func (s *Server) signOut(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	if state.Token != "" {
		if err := s.app.SignOut(r.Context(), state.Token); err != nil {
			return nil, err
		}
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", HttpOnly: true, MaxAge: -1})
	return noContent(), nil
}

func (s *Server) readMe(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	if state.User() == nil {
		return nil, errors.New("no person")
	}
	return s.app.UserByID(r.Context(), state.User().ID)
}

func (s *Server) saveMe(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	return s.app.SaveSettings(r.Context(), state.User().ID, state.JSON)
}

func (s *Server) listFilters(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	items, err := s.app.SavedFilters(r.Context(), state.User().ID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items}, nil
}

func (s *Server) saveFilter(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	filter, err := s.app.SaveFilter(r.Context(), state.User().ID, stringField(state.JSON, "name"),
		stringField(state.JSON, "status"), stringPointer(state.JSON, "service_id"))
	if err != nil {
		return nil, err
	}
	return created(filter), nil
}

func (s *Server) deleteFilter(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	if err := s.app.DeleteFilter(r.Context(), state.User().ID, pathValue(r, "id")); err != nil {
		return nil, err
	}
	return noContent(), nil
}

func (s *Server) createCalendarToken(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	token, err := s.app.CreateCalendarToken(r.Context(), state.User().ID)
	if err != nil {
		return nil, err
	}
	return created(token), nil
}

func (s *Server) revokeCalendarToken(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	if err := s.app.RevokeCalendarToken(r.Context(), state.User().ID); err != nil {
		return nil, err
	}
	return noContent(), nil
}

// calendarFeed serves one person's shifts by token and can change nothing.
func (s *Server) calendarFeed(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, 405, map[string]any{"error": "method_not_allowed"})
		return
	}
	file := pathValue(r, "file")
	if !strings.HasSuffix(file, ".ics") {
		writeJSON(w, 404, map[string]any{"error": "not_found"})
		return
	}
	feed, err := s.app.CalendarFeed(r.Context(), strings.TrimSuffix(file, ".ics"))
	if err != nil {
		writeAPIError(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
	if _, err := w.Write([]byte(feed)); err != nil {
		return
	}
}

func (s *Server) readClock(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	return s.clockState(), nil
}

func (s *Server) clockState() map[string]any {
	return map[string]any{
		"now":            s.app.Clock.Now(),
		"frozen":         s.app.Clock.Frozen(),
		"offset_seconds": s.app.Clock.OffsetSeconds(),
	}
}

func (s *Server) moveClock(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	ctx := r.Context()
	if raw, ok := state.JSON["set_to"]; ok && raw != nil {
		value, _ := raw.(string)
		target, ok := parseInstant(value)
		if !ok {
			return nil, &core.APIError{Status: 422, Body: map[string]any{
				"errors": map[string]any{"set_to": "The clock only moves forward."}}}
		}
		delta := target.Sub(s.app.Clock.Now())
		if delta < 0 {
			return nil, &core.APIError{Status: 422, Body: map[string]any{
				"errors": map[string]any{"set_to": "The clock only moves forward."}}}
		}
		if err := s.app.Clock.Advance(ctx, delta); err != nil {
			return nil, err
		}
	}
	if seconds := intField(state.JSON, "advance_seconds"); seconds != 0 {
		if seconds < 1 || seconds > 31536000 {
			return nil, &core.APIError{Status: 422, Body: map[string]any{
				"errors": map[string]any{"advance_seconds": "Use 1 to 31536000 seconds."}}}
		}
		if err := s.app.Clock.Advance(ctx, time.Duration(seconds)*time.Second); err != nil {
			return nil, err
		}
	}
	if raw, ok := state.JSON["frozen"]; ok {
		frozen, _ := raw.(bool)
		if err := s.app.Clock.SetFrozen(ctx, frozen); err != nil {
			return nil, err
		}
	}
	if err := s.app.Tick(ctx); err != nil {
		return nil, err
	}
	s.app.ClockMoved(ctx)
	return s.clockState(), nil
}

func (s *Server) drill(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	incident, err := s.app.Drill(r.Context(), state.Actor, stringField(state.JSON, "service_id"),
		stringField(state.JSON, "summary"), stringField(state.JSON, "severity"), stringField(state.JSON, "dedup_key"))
	if err != nil {
		return nil, err
	}
	return created(incident), nil
}

func (s *Server) listIntegrations(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	items, err := s.app.ListIntegrations(r.Context())
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items}, nil
}

func (s *Server) createIntegration(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	integration, err := s.app.CreateIntegration(r.Context(), stringField(state.JSON, "service_id"), stringField(state.JSON, "name"))
	if err != nil {
		return nil, err
	}
	return created(integration), nil
}

func (s *Server) readIntegration(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	integration, err := s.app.GetIntegration(r.Context(), pathValue(r, "id"))
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"id": integration.ID, "service_id": integration.ServiceID, "name": integration.Name,
		"routing_key": integration.RoutingKey, "counter": s.app.Counter(r.Context(), integration.RoutingKey),
	}, nil
}

func (s *Server) readEventLog(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	integration, err := s.app.GetIntegration(r.Context(), pathValue(r, "id"))
	if err != nil {
		return nil, err
	}
	items, err := s.app.EventLog(r.Context(), integration.ID, queryInt(r, "limit", 50))
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "next_cursor": nil}, nil
}

func (s *Server) listDeadLetters(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	items, err := s.app.ListDeadLetters(r.Context(), r.URL.Query().Get("integration_id"))
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items}, nil
}

func (s *Server) replayDeadLetter(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	if err := requireRole(state.Actor, accessLead); err != nil {
		return nil, err
	}
	var corrected []byte
	if raw, ok := state.JSON["message"]; ok && raw != nil {
		corrected = mustMarshal(raw)
	}
	return s.app.ReplayDeadLetter(r.Context(), pathValue(r, "id"), corrected)
}

func (s *Server) listIncidents(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	query := core.IncidentQuery{
		Status:    r.URL.Query().Get("status"),
		ServiceID: r.URL.Query().Get("service_id"),
		Limit:     queryInt(r, "limit", 25),
		After:     r.URL.Query().Get("after"),
		Before:    r.URL.Query().Get("before"),
	}
	return s.app.ListIncidents(r.Context(), query)
}

func (s *Server) readIncident(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	incident, err := s.app.Incident(r.Context(), pathValue(r, "id"))
	if err != nil {
		return nil, err
	}
	if etagFor(w, r, incident.Version) {
		return nil, nil
	}
	return incident, nil
}

func (s *Server) acknowledgeIncident(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	return s.app.Acknowledge(r.Context(), state.Actor, pathValue(r, "id"))
}

func (s *Server) snoozeIncident(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	var until *time.Time
	if raw := stringField(state.JSON, "until"); raw != "" {
		parsed, ok := parseInstant(raw)
		if !ok {
			return nil, &core.APIError{Status: 422, Body: map[string]any{
				"errors": map[string]any{"until": "Choose a time after now."}}}
		}
		until = &parsed
	}
	return s.app.Snooze(r.Context(), state.Actor, pathValue(r, "id"), intField(state.JSON, "preset_hours"), until)
}

func (s *Server) resolveIncident(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	return s.app.Resolve(r.Context(), state.Actor, pathValue(r, "id"))
}

func (s *Server) reassignIncident(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	return s.app.Reassign(r.Context(), state.Actor, pathValue(r, "id"),
		stringPointer(state.JSON, "person_id"), stringPointer(state.JSON, "service_id"))
}

func (s *Server) mergeIncidents(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	if err := requireRole(state.Actor, accessLead); err != nil {
		return nil, err
	}
	return s.idempotent(r.Context(), r, state, "merge", func() (any, int, error) {
		incident, err := s.app.Merge(r.Context(), state.Actor, pathValue(r, "id"), stringList(state.JSON, "source_ids"))
		if err != nil {
			return nil, 0, err
		}
		return incident, 200, nil
	})
}

func (s *Server) splitAlert(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	if err := requireRole(state.Actor, accessLead); err != nil {
		return nil, err
	}
	incident, err := s.app.Split(r.Context(), state.Actor, pathValue(r, "id"), pathValue(r, "alertId"))
	if err != nil {
		return nil, err
	}
	return created(incident), nil
}

func (s *Server) addNote(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	return s.idempotent(r.Context(), r, state, "note", func() (any, int, error) {
		entry, err := s.app.AddNote(r.Context(), state.Actor, pathValue(r, "id"), stringField(state.JSON, "body"))
		if err != nil {
			return nil, 0, err
		}
		return entry, 201, nil
	})
}

func (s *Server) readDraft(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	body, savedAt, err := s.app.NoteDraft(r.Context(), pathValue(r, "id"), state.User().ID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"body": body, "saved_at": savedAt}, nil
}

func (s *Server) saveDraft(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	savedAt, err := s.app.SaveNoteDraft(r.Context(), pathValue(r, "id"), state.User().ID, stringField(state.JSON, "body"))
	if err != nil {
		return nil, err
	}
	return map[string]any{"body": stringField(state.JSON, "body"), "saved_at": savedAt}, nil
}

func (s *Server) requestResponder(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	request, err := s.app.RequestResponder(r.Context(), state.Actor, pathValue(r, "id"), stringField(state.JSON, "person_id"))
	if err != nil {
		return nil, err
	}
	return created(request), nil
}

func (s *Server) acceptResponder(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	return s.app.AnswerResponderRequest(r.Context(), state.Actor, pathValue(r, "id"), true)
}

func (s *Server) declineResponder(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	return s.app.AnswerResponderRequest(r.Context(), state.Actor, pathValue(r, "id"), false)
}

func (s *Server) bulkIncidents(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	results, err := s.app.Bulk(r.Context(), state.Actor, stringField(state.JSON, "action"), stringList(state.JSON, "ids"))
	if err != nil {
		return nil, err
	}
	return map[string]any{"results": results}, nil
}

func (s *Server) listPolicies(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	items, err := s.app.ListPolicies(r.Context())
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items}, nil
}

func (s *Server) readPolicy(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	policy, err := s.app.GetPolicy(r.Context(), pathValue(r, "id"))
	if err != nil {
		return nil, err
	}
	if etagFor(w, r, policy.Version) {
		return nil, nil
	}
	return policy, nil
}

func policyInput(body map[string]any) core.PolicyInput {
	in := core.PolicyInput{Name: stringField(body, "name"), Repeats: intField(body, "repeats")}
	raw, _ := body["levels"].([]any)
	for _, item := range raw {
		level, _ := item.(map[string]any)
		parsed := core.PolicyLevel{TimeoutMinutes: intField(level, "timeout_minutes")}
		targets, _ := level["targets"].([]any)
		for _, t := range targets {
			target, _ := t.(map[string]any)
			parsed.Targets = append(parsed.Targets, core.PolicyTarget{
				Type: stringField(target, "type"), ID: stringField(target, "id")})
		}
		in.Levels = append(in.Levels, parsed)
	}
	return in
}

func mustMarshal(value any) []byte {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	return encoded
}

func (s *Server) createPolicy(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	policy, err := s.app.CreatePolicy(r.Context(), policyInput(state.JSON))
	if err != nil {
		return nil, err
	}
	return created(policy), nil
}

func (s *Server) savePolicy(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	if _, err := s.app.GetPolicy(r.Context(), pathValue(r, "id")); err != nil {
		return nil, err
	}
	if err := requireRole(state.Actor, accessLead); err != nil {
		return nil, err
	}
	version, err := ifMatchVersion(r)
	if err != nil {
		return nil, err
	}
	policy, running, err := s.app.UpdatePolicy(r.Context(), pathValue(r, "id"), policyInput(state.JSON), version)
	if err != nil {
		return nil, err
	}
	return map[string]any{"id": policy.ID, "name": policy.Name, "repeats": policy.Repeats,
		"levels": policy.Levels, "version": policy.Version, "running_incidents": running,
		"previous_version": version}, nil
}

func (s *Server) listServices(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	items, err := s.app.ListServices(r.Context())
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items}, nil
}

func (s *Server) readService(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	service, err := s.app.GetService(r.Context(), pathValue(r, "id"))
	if err != nil {
		return nil, err
	}
	if etagFor(w, r, service.Version) {
		return nil, nil
	}
	return service, nil
}

func serviceInput(body map[string]any) core.ServiceInput {
	return core.ServiceInput{
		Name: stringField(body, "name"), Team: stringField(body, "team"),
		PolicyID: stringPointer(body, "policy_id"), DependsOn: stringList(body, "depends_on"),
		GroupingMode: stringField(body, "grouping_mode"), GroupingMinutes: intPointer(body, "grouping_minutes"),
		AckTimeoutMinutes: intPointer(body, "ack_timeout_minutes"), AutoResolveMinutes: intPointer(body, "auto_resolve_minutes"),
	}
}

func (s *Server) createService(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	service, err := s.app.CreateService(r.Context(), serviceInput(state.JSON))
	if err != nil {
		return nil, err
	}
	return created(service), nil
}

func (s *Server) saveService(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	if _, err := s.app.GetService(r.Context(), pathValue(r, "id")); err != nil {
		return nil, err
	}
	if err := requireRole(state.Actor, accessAdmin); err != nil {
		return nil, err
	}
	version, err := ifMatchVersion(r)
	if err != nil {
		return nil, err
	}
	return s.app.UpdateService(r.Context(), pathValue(r, "id"), serviceInput(state.JSON), version)
}

func (s *Server) listMaintenance(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	items, err := s.app.ListMaintenance(r.Context())
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items}, nil
}

func (s *Server) createMaintenance(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	starts, okStart := parseInstant(stringField(state.JSON, "starts_at"))
	ends, okEnd := parseInstant(stringField(state.JSON, "ends_at"))
	if !okStart {
		return nil, &core.APIError{Status: 422, Body: map[string]any{
			"errors": map[string]any{"starts_at": "Use the format YYYY-MM-DD HH:MM."}}}
	}
	if !okEnd {
		return nil, &core.APIError{Status: 422, Body: map[string]any{
			"errors": map[string]any{"ends_at": "Use the format YYYY-MM-DD HH:MM."}}}
	}
	window, err := s.app.CreateMaintenance(r.Context(), stringField(state.JSON, "service_id"), starts, ends)
	if err != nil {
		return nil, err
	}
	return created(window), nil
}

func (s *Server) deleteMaintenance(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	if err := s.app.DeleteMaintenance(r.Context(), pathValue(r, "id")); err != nil {
		return nil, err
	}
	return noContent(), nil
}

func (s *Server) listSchedules(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	items, err := s.app.ListSchedules(r.Context())
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items}, nil
}

func (s *Server) readSchedule(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	schedule, err := s.app.GetSchedule(r.Context(), pathValue(r, "id"))
	if err != nil {
		return nil, err
	}
	if etagFor(w, r, schedule.Version) {
		return nil, nil
	}
	return schedule, nil
}

func (s *Server) createSchedule(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	schedule, err := s.app.CreateSchedule(r.Context(), stringField(state.JSON, "name"), stringField(state.JSON, "zone"))
	if err != nil {
		return nil, err
	}
	return created(schedule), nil
}

func layerInput(body map[string]any) core.LayerConfig {
	cfg := core.LayerConfig{
		ShiftDays:   intField(body, "shift_days"),
		HandoffTime: stringField(body, "handoff_time"),
		StartDate:   stringField(body, "start_date"),
		People:      stringList(body, "people"),
	}
	raw, _ := body["restrictions"].([]any)
	for _, item := range raw {
		restriction, _ := item.(map[string]any)
		cfg.Restrictions = append(cfg.Restrictions, core.Restriction{
			Days: stringList(restriction, "days"), Start: stringField(restriction, "start"),
			End: stringField(restriction, "end"),
		})
	}
	return cfg
}

func (s *Server) addLayer(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	if _, err := s.app.GetSchedule(r.Context(), pathValue(r, "id")); err != nil {
		return nil, err
	}
	if err := requireRole(state.Actor, accessLead); err != nil {
		return nil, err
	}
	schedule, err := s.app.AddLayer(r.Context(), pathValue(r, "id"), stringField(state.JSON, "name"),
		intField(state.JSON, "order"), layerInput(state.JSON))
	if err != nil {
		return nil, err
	}
	return created(schedule), nil
}

func (s *Server) saveLayer(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	if _, err := s.app.GetSchedule(r.Context(), pathValue(r, "id")); err != nil {
		return nil, err
	}
	if err := requireRole(state.Actor, accessLead); err != nil {
		return nil, err
	}
	version, err := ifMatchVersion(r)
	if err != nil {
		return nil, err
	}
	return s.app.UpdateLayer(r.Context(), pathValue(r, "id"), pathValue(r, "layerId"),
		stringField(state.JSON, "name"), intField(state.JSON, "order"), layerInput(state.JSON), version)
}

func (s *Server) readFinal(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	schedule, err := s.app.GetSchedule(r.Context(), pathValue(r, "id"))
	if err != nil {
		return nil, err
	}
	zone := r.URL.Query().Get("zone")
	if zone == "" {
		zone = schedule.Zone
	}
	now := s.app.Clock.Now()
	from := now
	to := now.AddDate(0, 0, 7)
	if raw := r.URL.Query().Get("from"); raw != "" {
		if parsed, ok := parseInstant(raw); ok {
			from = parsed
		}
	}
	if raw := r.URL.Query().Get("to"); raw != "" {
		if parsed, ok := parseInstant(raw); ok {
			to = parsed
		}
	}
	if to.Sub(from) > 35*24*time.Hour+time.Hour {
		return nil, &core.APIError{Status: 422, Body: map[string]any{
			"errors": map[string]any{"to": "View at most 35 days."}}}
	}
	return s.app.FinalSchedule(r.Context(), schedule.ID, from, to, zone)
}

func cutRange(body map[string]any) (*string, time.Time, time.Time, error) {
	person := stringPointer(body, "person_id")
	start, okStart := parseInstant(stringField(body, "start"))
	end, okEnd := parseInstant(stringField(body, "end"))
	if !okStart {
		return nil, time.Time{}, time.Time{}, &core.APIError{Status: 422, Body: map[string]any{
			"errors": map[string]any{"start": "Use the format YYYY-MM-DD HH:MM."}}}
	}
	if !okEnd {
		return nil, time.Time{}, time.Time{}, &core.APIError{Status: 422, Body: map[string]any{
			"errors": map[string]any{"end": "Use the format YYYY-MM-DD HH:MM."}}}
	}
	return person, start, end, nil
}

func (s *Server) previewCut(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	person, start, end, err := cutRange(state.JSON)
	if err != nil {
		return nil, err
	}
	return s.app.PreviewCut(r.Context(), pathValue(r, "id"), person, start, end)
}

func (s *Server) createOverride(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	if _, err := s.app.GetSchedule(r.Context(), pathValue(r, "id")); err != nil {
		return nil, err
	}
	if err := requireRole(state.Actor, accessLead); err != nil {
		return nil, err
	}
	person, start, end, err := cutRange(state.JSON)
	if err != nil {
		return nil, err
	}
	return s.idempotent(r.Context(), r, state, "override", func() (any, int, error) {
		override, err := s.app.CreateOverride(r.Context(), pathValue(r, "id"), person, start, end)
		if err != nil {
			return nil, 0, err
		}
		final, err := s.app.FinalSchedule(r.Context(), pathValue(r, "id"), override.Start.Add(-24*time.Hour),
			override.End.Add(24*time.Hour), "")
		if err != nil {
			return nil, 0, err
		}
		return map[string]any{"override": override, "final": final, "message": s.app.OverrideSavedCopy(r.Context(), pathValue(r, "id"), override)}, 201, nil
	})
}

func (s *Server) deleteOverride(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	if err := requireRole(state.Actor, accessLead); err != nil {
		return nil, err
	}
	if err := s.app.DeleteOverride(r.Context(), pathValue(r, "id"), pathValue(r, "overrideId")); err != nil {
		return nil, err
	}
	return noContent(), nil
}

func (s *Server) readOnCall(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	scheduleID := r.URL.Query().Get("schedule_id")
	if scheduleID == "" {
		schedules, err := s.app.ListSchedules(r.Context())
		if err != nil {
			return nil, err
		}
		if len(schedules) == 0 {
			return nil, &core.APIError{Status: 404, Body: map[string]any{"error": "not_found"}}
		}
		scheduleID = schedules[0].ID
	}
	state2, etag, cacheState, err := s.app.OnCallCached(r.Context(), scheduleID)
	if err != nil {
		return nil, err
	}
	w.Header().Set("ETag", etag)
	w.Header().Set("X-Switchlamp-Cache", cacheState)
	if match := r.Header.Get("If-None-Match"); match == etag {
		w.WriteHeader(http.StatusNotModified)
		return nil, nil
	}
	return state2, nil
}

func (s *Server) readStatus(w http.ResponseWriter, r *http.Request) {
	if !s.app.Ready() {
		writeJSON(w, 503, map[string]any{"status": "starting"})
		return
	}
	if err := s.app.Tick(r.Context()); err != nil {
		writeJSON(w, 500, map[string]any{"error": "internal"})
		return
	}
	view, etag, cacheState, err := s.app.StatusPage(r.Context())
	if err != nil {
		writeAPIError(w, err)
		return
	}
	w.Header().Set("ETag", etag)
	w.Header().Set("X-Switchlamp-Cache", cacheState)
	if match := r.Header.Get("If-None-Match"); match == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	writeJSON(w, 200, view)
}

func (s *Server) subscribe(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	if err := s.app.Subscribe(r.Context(), stringField(state.JSON, "email")); err != nil {
		return nil, err
	}
	return created(map[string]any{"status": "subscribed"}), nil
}

func (s *Server) listStatusUpdates(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	items, err := s.app.ListStatusUpdates(r.Context(), false)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items}, nil
}

func (s *Server) createStatusUpdate(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	update, err := s.app.CreateStatusUpdate(r.Context(), stringField(state.JSON, "title"), stringField(state.JSON, "body"),
		stringField(state.JSON, "state"), stringList(state.JSON, "service_ids"))
	if err != nil {
		return nil, err
	}
	return created(update), nil
}

func (s *Server) saveStatusUpdate(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	return s.app.UpdateStatusUpdate(r.Context(), pathValue(r, "id"), stringField(state.JSON, "title"),
		stringField(state.JSON, "body"), stringField(state.JSON, "state"), stringList(state.JSON, "service_ids"))
}

func (s *Server) publishStatusUpdate(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	return s.idempotent(r.Context(), r, state, "publish", func() (any, int, error) {
		update, subscribers, err := s.app.PublishStatusUpdate(r.Context(), pathValue(r, "id"))
		if err != nil {
			return nil, 0, err
		}
		return map[string]any{"id": update.ID, "title": update.Title, "body": update.Body, "state": update.State,
			"services": update.Services, "published_at": update.PublishedAt, "subscribers": subscribers}, 200, nil
	})
}

func (s *Server) listWebhooks(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	items, err := s.app.ListWebhooks(r.Context())
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items}, nil
}

func (s *Server) createWebhook(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	endpoint, err := s.app.CreateWebhook(r.Context(), stringField(state.JSON, "name"), stringField(state.JSON, "path"),
		stringList(state.JSON, "event_types"), stringList(state.JSON, "service_ids"))
	if err != nil {
		return nil, err
	}
	return created(endpoint), nil
}

func (s *Server) deleteWebhook(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	if err := s.app.DeleteWebhook(r.Context(), pathValue(r, "id")); err != nil {
		return nil, err
	}
	return noContent(), nil
}

func (s *Server) listDeliveries(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	if _, err := s.app.GetWebhook(r.Context(), pathValue(r, "id")); err != nil {
		return nil, err
	}
	items, err := s.app.Deliveries(r.Context(), pathValue(r, "id"), queryInt(r, "limit", 25))
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "next_cursor": nil}, nil
}

func (s *Server) replayDelivery(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	delivery, err := s.app.ReplayDelivery(r.Context(), pathValue(r, "id"))
	if err != nil {
		return nil, err
	}
	return accepted(delivery), nil
}

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	people, err := s.app.ListUsers(r.Context())
	if err != nil {
		return nil, err
	}
	items := make([]map[string]any, 0, len(people))
	for _, p := range people {
		items = append(items, map[string]any{"id": p.ID, "name": p.Name, "email": p.Email,
			"role": p.Role, "timezone": p.Timezone})
	}
	return map[string]any{"items": items}, nil
}

func (s *Server) setRole(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	return s.app.SetRole(r.Context(), pathValue(r, "id"), stringField(state.JSON, "role"))
}

func (s *Server) signOutUser(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	if err := s.app.ForceSignOut(r.Context(), pathValue(r, "id")); err != nil {
		return nil, err
	}
	return noContent(), nil
}

func (s *Server) removeUser(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	if _, err := s.app.RemoveUser(r.Context(), pathValue(r, "id")); err != nil {
		return nil, err
	}
	return noContent(), nil
}

func (s *Server) listAPIKeys(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	items, err := s.app.ListAPIKeys(r.Context())
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items}, nil
}

func (s *Server) createAPIKey(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	key, err := s.app.CreateAPIKey(r.Context(), stringField(state.JSON, "name"), stringField(state.JSON, "scope"))
	if err != nil {
		return nil, err
	}
	return created(key), nil
}

func (s *Server) rotateAPIKey(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	grace := 60
	if value := intPointer(state.JSON, "grace_minutes"); value != nil {
		grace = *value
	}
	return s.app.RotateAPIKey(r.Context(), pathValue(r, "id"), grace)
}

func (s *Server) revokeAPIKey(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	if err := s.app.RevokeAPIKey(r.Context(), pathValue(r, "id")); err != nil {
		return nil, err
	}
	return noContent(), nil
}

func (s *Server) startAnalytics(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	from := stringField(state.JSON, "from")
	to := stringField(state.JSON, "to")
	defaultFrom, defaultTo := s.app.DefaultAnalyticsRange()
	if to == "" {
		to = defaultTo
	}
	if from == "" {
		from = defaultFrom
	}
	job, cached, err := s.app.StartAnalyticsJob(r.Context(), from, to)
	if err != nil {
		return nil, err
	}
	if cached {
		return job, nil
	}
	return accepted(job), nil
}

func (s *Server) readAnalytics(w http.ResponseWriter, r *http.Request, state *session) (any, error) {
	return s.app.AnalyticsJob(r.Context(), pathValue(r, "id"))
}

func (s *Server) downloadAnalytics(w http.ResponseWriter, r *http.Request) {
	actor, _, authErr := s.actorFor(r)
	if authErr != nil {
		writeJSON(w, authErr.Status, authErr.Body)
		return
	}
	if actor == nil {
		writeJSON(w, 401, map[string]any{"error": "unauthenticated"})
		return
	}
	if err := checkAccess(*actor, accessReader); err != nil {
		writeAPIError(w, err)
		return
	}
	csv, err := s.app.AnalyticsCSV(r.Context(), pathValue(r, "id"))
	if err != nil {
		writeAPIError(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="response-measures.csv"`)
	if _, err := w.Write([]byte(csv)); err != nil {
		return
	}
}
