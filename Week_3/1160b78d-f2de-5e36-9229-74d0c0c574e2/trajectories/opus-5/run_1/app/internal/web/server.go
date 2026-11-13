// Package web serves the Switchlamp screens and its API from one origin.
package web

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"switchlamp/internal/core"
)

//go:embed templates/*.html
var templateFS embed.FS

//go:embed all:static
var staticFS embed.FS

const sessionCookie = "switchlamp_session"

const (
	accessPublic   = "public"
	accessSignedIn = "signed-in"
	accessReader   = "reader"
	accessLead     = "lead"
	accessAdmin    = "admin"
)

type Server struct {
	app       *core.App
	templates *template.Template
	mux       *http.ServeMux
}

// session is who is making one request.
type session struct {
	Actor core.Actor
	Token string
	Body  []byte
	JSON  map[string]any
}

func (s *session) User() *core.User { return s.Actor.User }

func New(app *core.App) (*Server, error) {
	templates, err := template.New("").Funcs(templateFuncs()).ParseFS(templateFS, "templates/*.html")
	if err != nil {
		return nil, fmt.Errorf("parse templates: %w", err)
	}
	server := &Server{app: app, templates: templates, mux: http.NewServeMux()}
	server.routes()
	return server, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if recovered := recover(); recovered != nil {
			log.Printf("panic serving %s: %v", r.URL.Path, recovered)
			http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
		}
	}()
	s.mux.ServeHTTP(w, r)
}

// readBody applies the published size limits and the one JSON check.
func (s *Server) readBody(r *http.Request, limit int64) ([]byte, *core.APIError) {
	if r.Body == nil {
		return nil, nil
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil {
		return nil, &core.APIError{Status: 400, Body: map[string]any{"error": "invalid_json"}}
	}
	if int64(len(body)) > limit {
		return nil, &core.APIError{Status: 413, Body: map[string]any{"error": "body_too_large"}}
	}
	return body, nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if value == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Printf("write json: %v", err)
	}
}

func writeAPIError(w http.ResponseWriter, err error) {
	var apiErr *core.APIError
	if errors.As(err, &apiErr) {
		writeJSON(w, apiErr.Status, apiErr.Body)
		return
	}
	log.Printf("request failed: %v", err)
	writeJSON(w, 500, map[string]any{"error": "internal"})
}

type apiFunc func(w http.ResponseWriter, r *http.Request, s *session) (any, error)

// api wraps one endpoint in the one published error order.
func (s *Server) api(access string, fn apiFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.app.Ready() {
			writeJSON(w, 503, map[string]any{"status": "starting"})
			return
		}
		limit := int64(1000000)
		body, sizeErr := s.readBody(r, limit)
		if sizeErr != nil {
			writeJSON(w, sizeErr.Status, sizeErr.Body)
			return
		}
		state := &session{Body: body}
		if len(body) > 0 {
			if err := json.Unmarshal(body, &state.JSON); err != nil {
				writeJSON(w, 400, map[string]any{"error": "invalid_json"})
				return
			}
		}
		actor, token, authErr := s.actorFor(r)
		if authErr != nil {
			writeJSON(w, authErr.Status, authErr.Body)
			return
		}
		if actor != nil {
			state.Actor = *actor
			state.Token = token
		}
		if access != accessPublic {
			if actor == nil {
				writeJSON(w, 401, map[string]any{"error": "unauthenticated"})
				return
			}
			if err := checkAccess(*actor, access); err != nil {
				writeAPIError(w, err)
				return
			}
			if !actor.CanWrite() && isWrite(r.Method) {
				writeJSON(w, 403, map[string]any{"error": "forbidden"})
				return
			}
		}
		if origin := crossOrigin(r); origin {
			writeJSON(w, 403, map[string]any{"error": "cross_origin"})
			return
		}
		if err := s.app.Tick(r.Context()); err != nil {
			log.Printf("timers: %v", err)
		}
		result, err := fn(w, r, state)
		if err != nil {
			writeAPIError(w, err)
			return
		}
		if result == nil {
			return
		}
		if status, ok := result.(statusValue); ok {
			writeJSON(w, status.status, status.value)
			return
		}
		writeJSON(w, 200, result)
	}
}

type statusValue struct {
	status int
	value  any
}

func created(value any) statusValue  { return statusValue{status: 201, value: value} }
func accepted(value any) statusValue { return statusValue{status: 202, value: value} }
func noContent() statusValue         { return statusValue{status: 204, value: nil} }

func isWrite(method string) bool {
	return method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch || method == http.MethodDelete
}

// checkAccess enforces the published role rights.
func checkAccess(actor core.Actor, access string) error {
	role := actor.Role()
	switch access {
	case accessSignedIn:
		return nil
	case accessReader:
		if role == "stakeholder" {
			return &core.APIError{Status: 403, Body: map[string]any{"error": "forbidden"}}
		}
	case accessLead:
		if role != "lead" && role != "admin" {
			return &core.APIError{Status: 403, Body: map[string]any{"error": "forbidden"}}
		}
	case accessAdmin:
		if role != "admin" {
			return &core.APIError{Status: 403, Body: map[string]any{"error": "forbidden"}}
		}
	}
	return nil
}

func requireRole(actor core.Actor, access string) error { return checkAccess(actor, access) }

// actorFor answers who is making the request: a signed-in person or an API key.
func (s *Server) actorFor(r *http.Request) (*core.Actor, string, *core.APIError) {
	if header := r.Header.Get("Authorization"); strings.HasPrefix(header, "Bearer ") {
		key := strings.TrimPrefix(header, "Bearer ")
		actor, err := s.app.ActorForKey(r.Context(), key)
		if err != nil {
			return nil, "", &core.APIError{Status: 500, Body: map[string]any{"error": "internal"}}
		}
		if actor == nil {
			return nil, "", &core.APIError{Status: 401, Body: map[string]any{"error": "invalid_api_key"}}
		}
		return actor, "", nil
	}
	cookie, err := r.Cookie(sessionCookie)
	if err != nil || cookie.Value == "" {
		return nil, "", nil
	}
	user, err := s.app.UserBySession(r.Context(), cookie.Value)
	if err != nil {
		return nil, "", &core.APIError{Status: 500, Body: map[string]any{"error": "internal"}}
	}
	if user == nil {
		return nil, "", nil
	}
	return &core.Actor{User: user}, cookie.Value, nil
}

// crossOrigin refuses a state-changing cookie request from another origin.
func crossOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return false
	}
	if _, err := r.Cookie(sessionCookie); err != nil {
		return false
	}
	if !isWrite(r.Method) {
		return false
	}
	return !sameOrigin(origin, r)
}

func sameOrigin(origin string, r *http.Request) bool {
	trimmed := strings.TrimPrefix(strings.TrimPrefix(origin, "http://"), "https://")
	return trimmed == r.Host
}

func pathValue(r *http.Request, name string) string { return r.PathValue(name) }

func queryInt(r *http.Request, name string, fallback int) int {
	value := r.URL.Query().Get(name)
	if value == "" {
		return fallback
	}
	n, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return n
}

func stringField(body map[string]any, name string) string {
	if body == nil {
		return ""
	}
	value, _ := body[name].(string)
	return value
}

func stringPointer(body map[string]any, name string) *string {
	if body == nil {
		return nil
	}
	raw, ok := body[name]
	if !ok || raw == nil {
		return nil
	}
	value, ok := raw.(string)
	if !ok || value == "" {
		return nil
	}
	return &value
}

func intField(body map[string]any, name string) int {
	if body == nil {
		return 0
	}
	value, _ := body[name].(float64)
	return int(value)
}

func intPointer(body map[string]any, name string) *int {
	if body == nil {
		return nil
	}
	raw, ok := body[name]
	if !ok || raw == nil {
		return nil
	}
	value, ok := raw.(float64)
	if !ok {
		return nil
	}
	n := int(value)
	return &n
}

func stringList(body map[string]any, name string) []string {
	if body == nil {
		return nil
	}
	raw, ok := body[name].([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		if value, ok := item.(string); ok {
			out = append(out, value)
		}
	}
	return out
}

func parseInstant(value string) (time.Time, bool) {
	t, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}, false
	}
	return t.UTC().Truncate(time.Second), true
}

func ifMatchVersion(r *http.Request) (int, error) {
	raw := strings.Trim(r.Header.Get("If-Match"), `"`)
	if raw == "" {
		return 0, &core.APIError{Status: 428, Body: map[string]any{"error": "version_required"}}
	}
	version, err := strconv.Atoi(raw)
	if err != nil {
		return 0, &core.APIError{Status: 428, Body: map[string]any{"error": "version_required"}}
	}
	return version, nil
}

// etagFor answers a record read with its version, and 304 when it matches.
func etagFor(w http.ResponseWriter, r *http.Request, version int) bool {
	tag := `"` + strconv.Itoa(version) + `"`
	w.Header().Set("ETag", tag)
	if match := r.Header.Get("If-None-Match"); match == tag {
		w.WriteHeader(http.StatusNotModified)
		return true
	}
	return false
}

// idempotent returns a replayed key's stored response before any state check.
func (s *Server) idempotent(ctx context.Context, r *http.Request, state *session, route string, run func() (any, int, error)) (any, error) {
	key := r.Header.Get("Idempotency-Key")
	if key == "" {
		value, status, err := run()
		if err != nil {
			return nil, err
		}
		return statusValue{status: status, value: value}, nil
	}
	stored, status, found, err := s.app.StoredResponse(ctx, route, key, state.Body)
	if err != nil {
		return nil, err
	}
	if found {
		return statusValue{status: status, value: json.RawMessage(stored)}, nil
	}
	value, status, err := run()
	if err != nil {
		return nil, err
	}
	if err := s.app.StoreResponse(ctx, route, key, state.Body, value, status); err != nil {
		return nil, err
	}
	return statusValue{status: status, value: value}, nil
}
