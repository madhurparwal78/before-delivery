package serve

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"switchlamp/internal/copytext"
	"switchlamp/internal/store"
	"switchlamp/internal/engine"
)

func (s *Server) handleListIncidents(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	if !checkScope(u, r.Method) {
		apiError(w, http.StatusForbidden, "forbidden")
		return
	}
	q := r.URL.Query()
	limit := 25
	if v := q.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 100 {
			errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"limit": copytext.LimitRange})
			return
		}
		limit = n
	}
	ctx := r.Context()
	now := s.clock.Now()
	_ = s.engine.ApplyDue(ctx, now)
	filter := q.Get("status")
	items, total, nextCursor, err := s.store.IncidentsPage(ctx, store.IncidentFilter{
		Status: filter, ServiceID: q.Get("service_id"), Before: q.Get("after"), Limit: limit,
	})
	if err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, inc := range items {
		inc.Countdown = countdownFor(ctx, s, inc, now)
		out = append(out, map[string]any{
			"id": inc.ID, "number": inc.Number, "title": inc.Title, "service": inc.Service,
			"status": inc.Status, "urgency": inc.Urgency, "holders": inc.Holders,
			"opened_at": inc.OpenedAt.UTC().Format(time.RFC3339),
			"alert_count": 0, "countdown": inc.Countdown,
		})
	}
	// prev_cursor names the page before the current one.
	prevCursor := any(nil)
	writeJSON(w, http.StatusOK, map[string]any{
		"items": out, "total": total, "next_cursor": nextCursor, "prev_cursor": prevCursor,
	})
}

func (s *Server) handleGetIncident(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	if !checkScope(u, r.Method) {
		apiError(w, http.StatusForbidden, "forbidden")
		return
	}
	ctx := r.Context()
	inc, err := s.store.Incident(ctx, r.PathValue("id"))
	if err != nil {
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	body := incidentJSON(ctx, s, inc)
	etag := `"` + strconv.Itoa(inc.Version) + `"`
	w.Header().Set("ETag", etag)
	if match := r.Header.Get("If-None-Match"); match == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	writeJSON(w, http.StatusOK, body)
}

// conflictBody writes the published decision conflict.
func conflictBody(w http.ResponseWriter, c *engine.ConflictError) {
	writeJSON(w, http.StatusConflict, map[string]any{
		"error": "already_decided", "decision": c.Decision, "decided_by": c.By,
		"decided_at": c.At.UTC().Format(time.RFC3339),
	})
}

func (s *Server) handleAcknowledge(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	if !checkScope(u, r.Method) {
		apiError(w, http.StatusForbidden, "forbidden")
		return
	}
	inc, err := s.engine.Acknowledge(r.Context(), r.PathValue("id"), u.ID, u.Name)
	if err != nil {
		var c *engine.ConflictError
		if errors.As(err, &c) {
			conflictBody(w, c)
			return
		}
		var ill *engine.IllegalTransitionError
		if errors.As(err, &ill) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "illegal_transition", "message": ill.Message})
			return
		}
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	s.cache.Del(r.Context(), "cache:status:json", "cache:status:html")
	writeJSON(w, http.StatusOK, incidentJSON(r.Context(), s, inc))
}

func (s *Server) handleSnooze(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	if !checkScope(u, r.Method) {
		apiError(w, http.StatusForbidden, "forbidden")
		return
	}
	var body struct {
		PresetHours *int    `json:"preset_hours"`
		Until       *string `json:"until"`
	}
	if err := readBody(w, r, &body, bodyLimit); err != nil {
		return
	}
	var until time.Time
	now := s.clock.Now()
	if body.PresetHours != nil {
		switch *body.PresetHours {
		case 1, 4, 8, 24:
		default:
			errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"preset_hours": copytext.OutRange})
			return
		}
		until = now.Add(time.Duration(*body.PresetHours) * time.Hour)
	} else if body.Until != nil {
		t, err := time.Parse(time.RFC3339, *body.Until)
		if err != nil {
			errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"until": copytext.SnoozeFuture})
			return
		}
		until = t
	} else {
		errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"until": copytext.SnoozeFuture})
		return
	}
	if !until.After(now) {
		errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"until": copytext.SnoozeFuture})
		return
	}
	if until.After(now.Add(168 * time.Hour)) {
		errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"until": copytext.SnoozeMax})
		return
	}
	inc, err := s.engine.Snooze(r.Context(), r.PathValue("id"), u.ID, u.Name, until)
	if err != nil {
		var c *engine.ConflictError
		if errors.As(err, &c) {
			conflictBody(w, c)
			return
		}
		if errors.Is(err, engine.ErrSnoozeFuture) {
			errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"until": copytext.SnoozeFuture})
			return
		}
		if errors.Is(err, engine.ErrSnoozeMax) {
			errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"until": copytext.SnoozeMax})
			return
		}
		var ill *engine.IllegalTransitionError
		if errors.As(err, &ill) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "illegal_transition", "message": ill.Message})
			return
		}
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, incidentJSON(r.Context(), s, inc))
}

func (s *Server) handleResolve(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	if !checkScope(u, r.Method) {
		apiError(w, http.StatusForbidden, "forbidden")
		return
	}
	inc, err := s.engine.Resolve(r.Context(), r.PathValue("id"), u.Name)
	if err != nil {
		var c *engine.ConflictError
		if errors.As(err, &c) {
			conflictBody(w, c)
			return
		}
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	s.cache.Del(r.Context(), "cache:status:json", "cache:status:html")
	writeJSON(w, http.StatusOK, incidentJSON(r.Context(), s, inc))
}

func (s *Server) handleBulk(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	var body struct {
		Action string   `json:"action"`
		IDs    []string `json:"ids"`
	}
	if err := readBody(w, r, &body, bodyLimit); err != nil {
		return
	}
	if len(body.IDs) < 1 || len(body.IDs) > 100 {
		errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"ids": copytext.IdsRange})
		return
	}
	type result struct {
		ID       string `json:"id"`
		Number   int64  `json:"number"`
		Status   string `json:"status"`
		Decision string `json:"decision"`
		DecidedBy string `json:"decided_by"`
	}
	results := make([]result, 0, len(body.IDs))
	for _, id := range body.IDs {
		var res result
		res.ID = id
		inc, err := s.store.Incident(r.Context(), id)
		if err != nil {
			res.Status = "conflict"
			res.Decision = "resolved"
			res.DecidedBy = "Switchlamp"
			results = append(results, res)
			continue
		}
		res.Number = inc.Number
		var actionErr error
		switch body.Action {
		case "acknowledge":
			_, actionErr = s.engine.Acknowledge(r.Context(), id, u.ID, u.Name)
		case "resolve":
			_, actionErr = s.engine.Resolve(r.Context(), id, u.Name)
		default:
			errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"action": "Action must be acknowledge or resolve."})
			return
		}
		if actionErr != nil {
			var c *engine.ConflictError
			if errors.As(actionErr, &c) {
				res.Status = "conflict"
				res.Decision = c.Decision
				res.DecidedBy = c.By
			} else {
				res.Status = "conflict"
				res.Decision = "unknown"
			}
		} else {
			res.Status = "ok"
			res.Decision = body.Action
			res.DecidedBy = u.Name
		}
		results = append(results, res)
	}
	s.cache.Del(r.Context(), "cache:status:json", "cache:status:html")
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

func (s *Server) handleReassign(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	var body struct {
		PersonID  *string `json:"person_id"`
		ServiceID *string `json:"service_id"`
	}
	if err := readBody(w, r, &body, bodyLimit); err != nil {
		return
	}
	ctx := r.Context()
	if (body.PersonID == nil) == (body.ServiceID == nil) {
		errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"person_id": copytext.PersonOrService})
		return
	}
	if body.PersonID != nil {
		if _, err := s.store.User(ctx, *body.PersonID); err != nil {
			apiError(w, http.StatusNotFound, "not_found")
			return
		}
		if err := s.checkPersonRole(ctx, *body.PersonID); err != nil {
			errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"person_id": "Choose a responder."})
			return
		}
	}
	if body.ServiceID != nil {
		if _, err := s.store.Service(ctx, *body.ServiceID); err != nil {
			apiError(w, http.StatusNotFound, "not_found")
			return
		}
	}
	inc, err := s.engine.Reassign(ctx, r.PathValue("id"), u.Name, body.PersonID, body.ServiceID)
	if err != nil {
		var c *engine.ConflictError
		if errors.As(err, &c) {
			conflictBody(w, c)
			return
		}
		if errors.Is(err, engine.ErrPersonHolds) {
			errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"person_id": copytext.PersonAlreadyHold})
			return
		}
		if errors.Is(err, engine.ErrSameService) {
			errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"service_id": copytext.AlreadyThisService})
			return
		}
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, incidentJSON(ctx, s, inc))
}

func (s *Server) checkPersonRole(ctx contextContext, id string) error {
	u, err := s.store.User(ctx, id)
	if err != nil {
		return err
	}
	if u.Role == "stakeholder" {
		return errors.New("stakeholder")
	}
	return nil
}

type contextContext = context.Context

func (s *Server) handleMerge(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	var body struct {
		SourceIDs []string `json:"source_ids"`
	}
	if err := readBody(w, r, &body, bodyLimit); err != nil {
		return
	}
	ctx := r.Context()
	inc, err := s.engine.Merge(ctx, r.PathValue("id"), body.SourceIDs, u.Name)
	if err != nil {
		var src *engine.MergeSourceResolvedError
		if errors.As(err, &src) {
			writeJSON(w, http.StatusConflict, map[string]any{"error": "merge_source_resolved", "number": src.Number})
			return
		}
		if errors.Is(err, engine.ErrMergeTargetResolved) {
			apiError(w, http.StatusConflict, "merge_target_resolved")
			return
		}
		if errors.Is(err, engine.ErrMergeIntoSelf) {
			errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"source_ids": copytext.MergeIntoItself})
			return
		}
		if errors.Is(err, engine.ErrMergeTooMany) {
			errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"source_ids": copytext.MergeTooMany})
			return
		}
		if errors.Is(err, errHandled) {
			return
		}
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	s.cache.Del(ctx, "cache:status:json", "cache:status:html")
	writeJSON(w, http.StatusOK, incidentJSON(ctx, s, inc))
}

func (s *Server) handleSplit(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	inc, err := s.engine.Split(r.Context(), r.PathValue("id"), r.PathValue("alertID"), u.Name)
	if err != nil {
		if errors.Is(err, engine.ErrLastAlert) {
			apiError(w, http.StatusConflict, "last_alert")
			return
		}
		var c *engine.ConflictError
		if errors.As(err, &c) {
			conflictBody(w, c)
			return
		}
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	writeJSON(w, http.StatusCreated, incidentJSON(r.Context(), s, inc))
}

func (s *Server) handleNote(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	var body struct {
		Body string `json:"body"`
	}
	if err := readBody(w, r, &body, bodyLimit); err != nil {
		return
	}
	if len(body.Body) < 1 || len(body.Body) > 10000 {
		errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"body": "Use 1 to 10000 characters."})
		return
	}
	inc, err := s.engine.Note(r.Context(), r.PathValue("id"), u.ID, u.Name, body.Body)
	if err != nil {
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"timeline": inc.Timeline})
}

func (s *Server) handleGetDraft(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	var body string
	var savedAt time.Time
	err := s.store.Pool().QueryRow(r.Context(),
		`SELECT body, saved_at FROM note_drafts WHERE incident_id = $1 AND user_id = $2`,
		r.PathValue("id"), u.ID).Scan(&body, &savedAt)
	if err != nil {
		body = ""
		savedAt = s.engine.Now()
	}
	writeJSON(w, http.StatusOK, map[string]any{"body": body, "saved_at": savedAt.UTC().Format(time.RFC3339)})
}

func (s *Server) handlePutDraft(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	var body struct {
		Body string `json:"body"`
	}
	if err := readBody(w, r, &body, bodyLimit); err != nil {
		return
	}
	// saved_at follows the server clock, like every other stamp.
	now := s.engine.Now()
	_, err := s.store.Pool().Exec(r.Context(), `INSERT INTO note_drafts (incident_id, user_id, body, saved_at)
		VALUES ($1,$2,$3,$4) ON CONFLICT (incident_id, user_id) DO UPDATE SET body = $3, saved_at = $4`,
		r.PathValue("id"), u.ID, body.Body, now)
	if err != nil {
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"body": body.Body, "saved_at": now.UTC().Format(time.RFC3339)})
}

func (s *Server) handleRequestResponder(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	var body struct {
		PersonID string `json:"person_id"`
	}
	if err := readBody(w, r, &body, bodyLimit); err != nil {
		return
	}
	ctx := r.Context()
	if err := s.checkPersonRole(ctx, body.PersonID); err != nil {
		errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"person_id": "Choose a responder."})
		return
	}
	id, err := s.engine.RequestResponder(ctx, r.PathValue("id"), body.PersonID, u.Name)
	if err != nil {
		if errors.Is(err, engine.ErrAlreadyResponding) {
			apiError(w, http.StatusConflict, "already_responding")
			return
		}
		if errors.Is(err, engine.ErrAlreadyAnswered) {
			apiError(w, http.StatusConflict, "already_answered")
			return
		}
		if errors.Is(err, engine.ErrResolvedRequest) {
			var c *engine.ConflictError
			inc, ierr := s.store.Incident(ctx, r.PathValue("id"))
			if ierr == nil {
				c, _ = s.engine.ResolvedDecisionFor(ctx, inc)
				conflictBody(w, c)
				return
			}
		}
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	person, _ := s.store.User(ctx, body.PersonID)
	writeJSON(w, http.StatusCreated, map[string]any{
		"id": id, "person": person.Name, "state": "requested",
	})
}

func (s *Server) handleAcceptResponder(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	s.answerResponder(w, r, u, true)
}

func (s *Server) handleDeclineResponder(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	s.answerResponder(w, r, u, false)
}

func (s *Server) answerResponder(w http.ResponseWriter, r *http.Request, u *SessionUser, accept bool) {
	ctx := r.Context()
	// Only the person asked may answer.
	var personID string
	if err := s.store.Pool().QueryRow(ctx, `SELECT person_id FROM responder_requests WHERE id = $1`,
		r.PathValue("id")).Scan(&personID); err != nil {
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	if personID != u.ID {
		apiError(w, http.StatusForbidden, "forbidden")
		return
	}
	state, err := s.engine.AnswerResponder(ctx, r.PathValue("id"), accept)
	if err != nil {
		if errors.Is(err, engine.ErrAlreadyAnswered) {
			apiError(w, http.StatusConflict, "already_answered")
			return
		}
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": r.PathValue("id"), "person": u.Name, "state": state})
}

