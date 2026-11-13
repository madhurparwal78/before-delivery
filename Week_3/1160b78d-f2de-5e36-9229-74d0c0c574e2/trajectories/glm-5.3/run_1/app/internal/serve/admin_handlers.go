package serve

import (
	"context"
	"net/http"
	"time"

	"switchlamp/internal/domain"
	"switchlamp/internal/store"
)

func (s *Server) handleListSavedFilters(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	rows, err := s.store.Pool().Query(r.Context(),
		`SELECT id, name, status, service_id FROM saved_filters WHERE user_id = $1 ORDER BY created_at`, u.ID)
	if err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, name, status string
		var service *string
		if err := rows.Scan(&id, &name, &status, &service); err != nil {
			apiError(w, http.StatusInternalServerError, "internal")
			return
		}
		items = append(items, map[string]any{"id": id, "name": name, "status": status, "service_id": service})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handlePostSavedFilter(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	var body struct {
		Name      string  `json:"name"`
		Status    string  `json:"status"`
		ServiceID *string `json:"service_id"`
	}
	if err := readBody(w, r, &body, bodyLimit); err != nil {
		return
	}
	if body.Name == "" || body.Status == "" {
		errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"name": "Choose a name and status."})
		return
	}
	ctx := r.Context()
	id := genID()
	if _, err := s.store.Pool().Exec(ctx, `INSERT INTO saved_filters (id, user_id, name, status, service_id)
		VALUES ($1,$2,$3,$4,$5)`, id, u.ID, body.Name, body.Status, body.ServiceID); err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id": id, "name": body.Name, "status": body.Status, "service_id": body.ServiceID,
	})
}

func (s *Server) handleDeleteSavedFilter(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	_, err := s.store.Pool().Exec(r.Context(), `DELETE FROM saved_filters WHERE id = $1 AND user_id = $2`,
		r.PathValue("id"), u.ID)
	if err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleCreateCalendarToken(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	// Regenerating kills the old token at once.
	ctx := r.Context()
	s.store.Pool().Exec(ctx, `DELETE FROM calendar_tokens WHERE user_id = $1`, u.ID)
	token := newToken()
	expires := s.clock.Now().Add(365 * 24 * time.Hour)
	if _, err := s.store.Pool().Exec(ctx, `INSERT INTO calendar_tokens (token, user_id, expires_at)
		VALUES ($1,$2,$3)`, token, u.ID, expires); err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"url": "/calendar/" + token + ".ics", "expires_at": expires.UTC().Format(time.RFC3339),
	})
}

func (s *Server) handleRevokeCalendarToken(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	s.store.Pool().Exec(r.Context(), `DELETE FROM calendar_tokens WHERE user_id = $1`, u.ID)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	users, err := s.store.Users(r.Context())
	if err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	items := make([]map[string]any, 0, len(users))
	for _, usr := range users {
		items = append(items, userJSON(usr))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handlePatchUser(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	var body struct {
		Role string `json:"role"`
	}
	if err := readBody(w, r, &body, bodyLimit); err != nil {
		return
	}
	switch body.Role {
	case "responder", "lead", "admin", "stakeholder":
	default:
		errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"role": "Choose a listed role."})
		return
	}
	ctx := r.Context()
	target, err := s.store.User(ctx, r.PathValue("id"))
	if err != nil {
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	// The last admin cannot be demoted.
	if target.Role == "admin" && body.Role != "admin" {
		var admins int
		if err := s.store.Pool().QueryRow(ctx, `SELECT count(*) FROM users WHERE role = 'admin' AND removed_at IS NULL`).Scan(&admins); err == nil && admins <= 1 {
			apiError(w, http.StatusConflict, "last_admin")
			return
		}
	}
	if _, err := s.store.Pool().Exec(ctx, `UPDATE users SET role = $2 WHERE id = $1`, target.ID, body.Role); err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	// An immediate access change closes the person's sockets with 4403.
	s.live.CloseFor(target.ID, 4403)
	updated, _ := s.store.User(ctx, target.ID)
	writeJSON(w, http.StatusOK, userJSON(updated))
}

func (s *Server) handleForceSignOut(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	target, err := s.store.User(ctx, r.PathValue("id"))
	if err != nil {
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	s.store.Pool().Exec(ctx, `DELETE FROM sessions WHERE user_id = $1`, target.ID)
	s.live.CloseFor(target.ID, 4401)
	w.WriteHeader(http.StatusNoContent)
}

// removalBreak lists what removing a person would break.
type removalBreak struct {
	Schedule string `json:"schedule,omitempty"`
	Start    string `json:"start,omitempty"`
	End      string `json:"end,omitempty"`
	Policy   string `json:"policy,omitempty"`
	Level    int    `json:"level,omitempty"`
	Kind     string `json:"-"`
}

func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	target, err := s.store.User(ctx, r.PathValue("id"))
	if err != nil {
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	// The last admin cannot be removed.
	if target.Role == "admin" {
		var admins int
		if err := s.store.Pool().QueryRow(ctx, `SELECT count(*) FROM users WHERE role = 'admin' AND removed_at IS NULL`).Scan(&admins); err == nil && admins <= 1 {
			apiError(w, http.StatusConflict, "last_admin")
			return
		}
	}
	breaks, err := s.removalBreaks(ctx, target)
	if err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	if len(breaks) > 0 {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "still_needed", "breaks": breaks})
		return
	}
	if _, err := s.store.Pool().Exec(ctx, `UPDATE users SET removed_at = now() WHERE id = $1`, target.ID); err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	s.store.Pool().Exec(ctx, `DELETE FROM sessions WHERE user_id = $1`, target.ID)
	s.live.CloseFor(target.ID, 4401)
	w.WriteHeader(http.StatusNoContent)
}

// removalBreaks lists every future shift and policy level that would break, in
// schedule then start order, policies last.
func (s *Server) removalBreaks(ctx context.Context, u *store.UserRecord) ([]map[string]any, error) {
	now := s.clock.Now()
	names, err := s.store.UserNames(ctx)
	if err != nil {
		return nil, err
	}
	var out []map[string]any
	type pending struct {
		schedule string
		start    time.Time
		end      time.Time
	}
	var pends []pending
	schedules, _ := s.store.Schedules(ctx)
	for _, sc := range schedules {
		layers, err := s.store.Layers(ctx, sc.ID)
		if err != nil {
			return nil, err
		}
		for _, l := range layers {
			// Does this person hold a shift within the next 60 days?
			found := false
			for _, p := range l.People {
				if p == u.ID {
					found = true
				}
			}
			if !found {
				continue
			}
			l.SetScheduleZone(sc.Zone)
			l.RecordFormat = sc.RecordFormat
			overrides, err := s.store.Overrides(ctx, sc.ID)
			if err != nil {
				return nil, err
			}
			blocks := domain.FinalSchedule([]*domain.Layer{l}, overrides, now, now.Add(60*24*time.Hour), names)
			for _, b := range blocks {
				if b.Person != nil && b.Person.ID == u.ID {
					pends = append(pends, pending{schedule: sc.Name, start: b.Start, end: b.End})
					break
				}
			}
		}
	}
	// Schedule then start order.
	for i := 1; i < len(pends); i++ {
		for j := i; j > 0; j-- {
			if pends[j].schedule < pends[j-1].schedule ||
				(pends[j].schedule == pends[j-1].schedule && pends[j].start.Before(pends[j-1].start)) {
				pends[j], pends[j-1] = pends[j-1], pends[j]
			} else {
				break
			}
		}
	}
	for _, p := range pends {
		out = append(out, map[string]any{
			"schedule": p.schedule,
			"start":    p.start.UTC().Format(time.RFC3339),
			"end":      p.end.UTC().Format(time.RFC3339),
		})
	}
	// Policy levels last, by policy name.
	policies, _ := s.store.Policies(ctx)
	for _, p := range policies {
		for i, lvl := range p.Levels {
			for _, t := range lvl.Targets {
				if t.Type == "person" && t.ID == u.ID {
					out = append(out, map[string]any{"policy": p.Name, "level": i + 1})
				}
			}
		}
	}
	return out, nil
}
