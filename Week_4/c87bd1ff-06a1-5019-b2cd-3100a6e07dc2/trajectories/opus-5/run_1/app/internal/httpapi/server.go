// Package httpapi serves the saleroom: the JSON API, the sign-in routes, the
// live socket and the browser pages with their first-load data.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"

	"gavelhouse/internal/config"
	"gavelhouse/internal/domain"
	"gavelhouse/internal/keycloak"
	"gavelhouse/internal/saleroom"
)

// Server routes every request the saleroom answers.
type Server struct {
	cfg   *config.Config
	room  *saleroom.Saleroom
	realm *keycloak.Client
	hub   *Hub
	mux   *http.ServeMux
}

// New builds the server and its routes.
func New(cfg *config.Config, room *saleroom.Saleroom, realm *keycloak.Client) *Server {
	s := &Server{
		cfg:   cfg,
		room:  room,
		realm: realm,
		hub:   newHub(room),
		mux:   http.NewServeMux(),
	}
	s.routes()
	return s
}

// Hub exposes the live socket hub so the process can run it.
func (s *Server) Hub() *Hub { return s.hub }

// Handler is the server's root handler, with the boundary checks applied.
func (s *Server) Handler() http.Handler { return s.boundary(s.mux) }

const maxBodyBytes = 16384

// boundary enforces the saleroom's own origin, the published body limit and
// the JSON content type on every state-changing request.
func (s *Server) boundary(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		stateChanging := r.Method == http.MethodPost || r.Method == http.MethodPut ||
			r.Method == http.MethodDelete
		isUpgrade := strings.EqualFold(r.Header.Get("Upgrade"), "websocket")
		if (stateChanging || isUpgrade) && !s.sameOrigin(r) {
			if isUpgrade || strings.HasPrefix(r.URL.Path, "/api/") {
				writeError(w, http.StatusForbidden, "forbidden_origin", domain.MsgForbiddenOrigin, nil)
				return
			}
			http.Error(w, domain.MsgForbiddenOrigin, http.StatusForbidden)
			return
		}
		if stateChanging {
			if r.ContentLength > maxBodyBytes {
				writeError(w, http.StatusRequestEntityTooLarge, "body_too_large",
					"That request body is larger than the saleroom accepts.", nil)
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes+1)
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	return origin == s.ownOrigin(r)
}

// ownOrigin is the saleroom's own origin, from APP_PUBLIC_URL when it is set
// and otherwise from the request itself.
func (s *Server) ownOrigin(r *http.Request) string {
	if s.cfg.PublicURL != "" {
		return strings.TrimSuffix(s.cfg.PublicURL, "/")
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if forwarded := r.Header.Get("X-Forwarded-Proto"); forwarded != "" {
		scheme = forwarded
	}
	return scheme + "://" + r.Host
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	raw, err := json.Marshal(body)
	if err != nil {
		log.Printf("httpapi: encode response: %v", err)
		writeError(w, http.StatusInternalServerError, "server_error", domain.MsgUnexpectedFailure, nil)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write(raw)
}

func writeRaw(w http.ResponseWriter, status int, raw []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write(raw)
}

// writeError produces every API error through one shape.
func writeError(w http.ResponseWriter, status int, code, message string, fields map[string]string) {
	body := map[string]any{"error": code, "message": message}
	if fields != nil {
		body["fields"] = fields
	}
	writeJSON(w, status, body)
}

// fail turns a saleroom error into the API error it stands for.
func fail(w http.ResponseWriter, err error) {
	var conflictErr *saleroom.Conflict
	var invalid *saleroom.Invalid
	switch {
	case errors.Is(err, saleroom.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "That is not in this saleroom.", nil)
	case errors.Is(err, saleroom.ErrKeyReused):
		writeError(w, http.StatusConflict, "idempotency_key_reused",
			"That idempotency key was already used with a different bid.", nil)
	case errors.As(err, &conflictErr):
		body := map[string]any{"error": conflictErr.Code, "message": conflictErr.Message}
		if conflictErr.Lot != nil {
			body["lot"] = conflictErr.Lot
		}
		writeJSON(w, http.StatusConflict, body)
	case errors.As(err, &invalid):
		writeError(w, http.StatusUnprocessableEntity, "invalid",
			"Check the highlighted fields.", invalid.Fields)
	default:
		log.Printf("httpapi: %v", err)
		writeError(w, http.StatusInternalServerError, "server_error", domain.MsgUnexpectedFailure, nil)
	}
}

// decodeBody reads a JSON request body into a generic object, refusing
// anything that is not JSON.
func decodeBody(w http.ResponseWriter, r *http.Request) (map[string]json.RawMessage, []byte, bool) {
	contentType := r.Header.Get("Content-Type")
	mediaType, _, _ := strings.Cut(contentType, ";")
	mediaType = strings.TrimSpace(strings.ToLower(mediaType))
	raw, err := readBody(r)
	if err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "body_too_large",
			"That request body is larger than the saleroom accepts.", nil)
		return nil, nil, false
	}
	if mediaType != "application/json" && !(mediaType == "" && len(raw) == 0) {
		writeError(w, http.StatusUnsupportedMediaType, "unsupported_media_type",
			"Send the request as application/json.", nil)
		return nil, nil, false
	}
	if len(raw) == 0 {
		return map[string]json.RawMessage{}, raw, true
	}
	var body map[string]json.RawMessage
	if err := json.Unmarshal(raw, &body); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid", "Check the highlighted fields.",
			map[string]string{"body": "Send a JSON object."})
		return nil, nil, false
	}
	return body, raw, true
}

func readBody(r *http.Request) ([]byte, error) {
	defer r.Body.Close()
	buf := make([]byte, 0, 1024)
	chunk := make([]byte, 4096)
	for {
		n, err := r.Body.Read(chunk)
		buf = append(buf, chunk[:n]...)
		if len(buf) > maxBodyBytes {
			return nil, fmt.Errorf("request body is larger than %d bytes", maxBodyBytes)
		}
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return nil, err
			}
			return buf, nil
		}
	}
}

// wholeEuros reads a JSON integer in whole euros. Any other JSON value counts
// as not a whole number.
func wholeEuros(body map[string]json.RawMessage, field string) *int {
	raw, ok := body[field]
	if !ok {
		return nil
	}
	var v int64
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil
	}
	if strings.ContainsAny(string(raw), ".eE") {
		return nil
	}
	n := int(v)
	return &n
}

func stringField(body map[string]json.RawMessage, field string) string {
	raw, ok := body[field]
	if !ok {
		return ""
	}
	var v string
	if err := json.Unmarshal(raw, &v); err != nil {
		return ""
	}
	return v
}

func stringsField(body map[string]json.RawMessage, field string) []string {
	raw, ok := body[field]
	if !ok {
		return nil
	}
	var v []string
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil
	}
	return v
}
