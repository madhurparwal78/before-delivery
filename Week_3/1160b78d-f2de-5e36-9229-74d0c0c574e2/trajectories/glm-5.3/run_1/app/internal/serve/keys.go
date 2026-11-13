package serve

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"time"

	"switchlamp/internal/copytext"
)

// keyRoutes registers the API key endpoints.
func (s *Server) keyRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/api-keys", s.require("admin", s.handleListKeys))
	m.HandleFunc("POST /api/api-keys", s.require("admin", s.handleCreateKey))
	m.HandleFunc("POST /api/api-keys/{id}/rotate", s.require("admin", s.handleRotateKey))
	m.HandleFunc("DELETE /api/api-keys/{id}", s.require("admin", s.handleRevokeKey))
}

func (s *Server) handleListKeys(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	rows, err := s.store.Pool().Query(r.Context(),
		`SELECT id, name, scope, grace_ends_at, revoked_at FROM api_keys ORDER BY created_at`)
	if err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, name, scope string
		var grace, revoked *time.Time
		if err := rows.Scan(&id, &name, &scope, &grace, &revoked); err != nil {
			apiError(w, http.StatusInternalServerError, "internal")
			return
		}
		items = append(items, map[string]any{
			"id": id, "name": name, "scope": scope, "grace_ends_at": grace, "revoked_at": revoked,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleCreateKey(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	var body struct {
		Name  string `json:"name"`
		Scope string `json:"scope"`
	}
	if err := readBody(w, r, &body, bodyLimit); err != nil {
		return
	}
	fields := map[string]string{}
	if body.Name == "" {
		fields["name"] = "Name is required."
	}
	switch body.Scope {
	case "read", "write":
	default:
		fields["scope"] = "Choose Read or Write."
	}
	if len(fields) > 0 {
		errorsBody(w, http.StatusUnprocessableEntity, fields)
		return
	}
	// The key is shown only here and stored only as its hash.
	key := "slk_" + newToken() + newToken()
	sum := sha256.Sum256([]byte(key))
	id := genID()
	if _, err := s.store.Pool().Exec(r.Context(),
		`INSERT INTO api_keys (id, name, scope, key_hash) VALUES ($1,$2,$3,$4)`,
		id, body.Name, body.Scope, hex.EncodeToString(sum[:])); err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id": id, "name": body.Name, "scope": body.Scope, "key": key,
	})
}

func (s *Server) handleRotateKey(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	var body struct {
		GraceMinutes *int `json:"grace_minutes"`
	}
	if r.ContentLength > 0 {
		if err := readBody(w, r, &body, bodyLimit); err != nil {
			return
		}
	}
	grace := 60
	if body.GraceMinutes != nil {
		if *body.GraceMinutes < 0 || *body.GraceMinutes > 1440 {
			errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"grace_minutes": copytext.OutRange})
			return
		}
		grace = *body.GraceMinutes
	}
	ctx := r.Context()
	var revoked *time.Time
	if err := s.store.Pool().QueryRow(ctx, `SELECT revoked_at FROM api_keys WHERE id = $1`,
		r.PathValue("id")).Scan(&revoked); err != nil {
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	if revoked != nil {
		apiError(w, http.StatusConflict, "key_revoked")
		return
	}
	// Rotating issues a new key at once; the old key works until the grace
	// ends, so its hash moves to previous_hash.
	key := "slk_" + newToken() + newToken()
	sum := sha256.Sum256([]byte(key))
	graceEnds := s.clock.Now().Add(time.Duration(grace) * time.Minute)
	if _, err := s.store.Pool().Exec(ctx, `UPDATE api_keys SET previous_hash = key_hash, key_hash = $2, grace_ends_at = $3 WHERE id = $1`,
		r.PathValue("id"), hex.EncodeToString(sum[:]), graceEnds); err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"key": key, "grace_ends_at": graceEnds.UTC().Format(time.RFC3339)})
}

func (s *Server) handleRevokeKey(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	if _, err := s.store.Pool().Exec(r.Context(),
		`UPDATE api_keys SET revoked_at = now(), grace_ends_at = NULL WHERE id = $1`, r.PathValue("id")); err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
