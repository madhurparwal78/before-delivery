package main

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := contextWithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	var seeded int
	err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM projects`).Scan(&seeded)
	if err != nil || seeded == 0 {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "starting"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleSignIn(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "That request body isn't valid JSON.")
		return
	}
	email := strings.TrimSpace(strings.ToLower(body.Email))
	if email == "" || body.Password == "" {
		validationFailed(w, map[string]string{"email": "Enter an email and password."})
		return
	}
	var id, name, hash, role, accessKey string
	var hasKey bool
	row := s.db.QueryRowContext(r.Context(),
		`SELECT id, name, password_hash, role, coalesce(access_key,''), access_key IS NOT NULL FROM users WHERE lower(email) = $1`, email)
	if err := row.Scan(&id, &name, &hash, &role, &accessKey, &hasKey); err != nil {
		if err == sql.ErrNoRows {
			writeError(w, http.StatusUnauthorized, "invalid_credentials", "That email and password don't match.")
			return
		}
		http.Error(w, "internal", 500)
		return
	}
	// a reviewer signs in with the access key as the password
	passwordOK := bcrypt.CompareHashAndPassword([]byte(hash), []byte(body.Password)) == nil
	if !passwordOK && role == "reviewer" && hasKey && body.Password == accessKey {
		passwordOK = true
	}
	if !passwordOK {
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "That email and password don't match.")
		return
	}
	if role == "reviewer" {
		var n int
		if err := s.db.QueryRowContext(r.Context(), `SELECT count(*) FROM reviewer_scopes rs JOIN users u ON u.id = rs.reviewer_id WHERE u.id = $1`, id).Scan(&n); err != nil {
			http.Error(w, "internal", 500)
			return
		}
		if n == 0 {
			writeError(w, http.StatusUnauthorized, "invalid_credentials", "That email and password don't match.")
			return
		}
	}
	if err := createSession(w, r, s.db, id); err != nil {
		http.Error(w, "internal", 500)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": map[string]string{"id": id, "name": name, "email": email, "role": role}})
}

func (s *Server) handleSignOut(w http.ResponseWriter, r *http.Request) {
	destroySession(w, r, s.db)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	u, err := currentUser(r, s.db)
	if err != nil {
		unauthenticated(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": u.ID, "name": u.Name, "email": u.Email, "role": u.Role})
}

// probe state, refreshed by the background probe loop.
type probeState struct {
	git      string
	ai       string
	webhooks string
	at       time.Time
}

var probeCache probeState

func (s *Server) handleIntegrations(w http.ResponseWriter, r *http.Request) {
	if _, err := currentUser(r, s.db); err != nil {
		unauthenticated(w)
		return
	}
	if time.Since(probeCache.at) > 15*time.Second {
		s.probeServices(r.Context())
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"git_host": probeCache.git, "ai_engine": probeCache.ai, "webhooks": probeCache.webhooks,
	})
}

func (s *Server) probeServices(ctx context.Context) {
	git, ai, hooks := "down", "down", "down"
	c, cancel := contextWithTimeout(ctx, 5*time.Second)
	if s.git.Health(c) == nil {
		git = "up"
	}
	cancel()
	c, cancel = contextWithTimeout(ctx, 5*time.Second)
	if s.ai.Health(c) == nil {
		ai = "up"
	}
	cancel()
	c, cancel = contextWithTimeout(ctx, 5*time.Second)
	if s.svix.Health(c) == nil {
		hooks = "up"
	}
	cancel()
	probeCache = probeState{git: git, ai: ai, webhooks: hooks, at: time.Now()}
}

func (s *Server) handleWorkspaceStats(w http.ResponseWriter, r *http.Request) {
	stats, err := s.store.WorkspaceStats(r.Context())
	if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

func (s *Server) handleAuditList(w http.ResponseWriter, r *http.Request) {
	cutoff := time.Now().UTC().Add(-s.cfg.AuditRetention)
	entries, err := s.store.AuditList(r.Context(), cutoff)
	if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	if entries == nil {
		entries = []map[string]any{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
}

func (s *Server) handleAuditCSV(w http.ResponseWriter, r *http.Request) {
	cutoff := time.Now().UTC().Add(-s.cfg.AuditRetention)
	entries, err := s.store.AuditList(r.Context(), cutoff)
	if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	var buf bytes.Buffer
	buf.WriteString("at,actor,action,project,detail\r\n")
	for _, e := range entries {
		row := []string{csvCell(fmt.Sprint(e["at"])), csvCell(e["actor"].(string)), csvCell(e["action"].(string)), csvCell(e["project"].(string)), csvCell(e["detail"].(string))}
		buf.WriteString(strings.Join(row, ","))
		buf.WriteString("\r\n")
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(buf.Bytes())
}

// csvCell neutralises formula cells and quotes where needed.
func csvCell(v string) string {
	if v == "" {
		return ""
	}
	if strings.HasPrefix(v, "=") || strings.HasPrefix(v, "+") || strings.HasPrefix(v, "-") || strings.HasPrefix(v, "@") ||
		strings.HasPrefix(v, "\t") || strings.HasPrefix(v, "\r") {
		v = "'" + v
	}
	if strings.ContainsAny(v, ",\"\n\r") {
		v = `"` + strings.ReplaceAll(v, `"`, `""`) + `"`
	}
	return v
}

// decodeJSONBody reads a small JSON body into out.
func decodeJSONBody(r *http.Request, out any) error {
	dec := jsonDecoder(r)
	return dec.Decode(out)
}

// bcryptHash hashes a password for storage.
func bcryptHash(pw string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	return string(b), err
}
