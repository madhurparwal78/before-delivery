// Package api answers every request the browser makes, and is the one place
// the published rules are applied.
package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"sundialwren/internal/clock"
	"sundialwren/internal/config"
	"sundialwren/internal/domain"
	"sundialwren/internal/live"
	"sundialwren/internal/objstore"
	"sundialwren/internal/printer"
	"sundialwren/internal/store"
)

const (
	sessionCookie  = "wren_session"
	maxJSONBytes   = 1_000_000
	maxUploadBytes = 5_000_000
)

type Server struct {
	Store   *store.Store
	Clock   *clock.Clock
	Hub     *live.Hub
	Objects *objstore.Client
	Printer *printer.Client
	Config  config.Config

	mux *http.ServeMux
}

func New(st *store.Store, ck *clock.Clock, hub *live.Hub, obj *objstore.Client, pr *printer.Client, cfg config.Config) *Server {
	s := &Server{Store: st, Clock: ck, Hub: hub, Objects: obj, Printer: pr, Config: cfg}
	s.routes()
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.URL.Path, "/api/") {
		s.serveApp(w, r)
		return
	}
	if err := s.guard(w, r); err != nil {
		return
	}
	s.mux.ServeHTTP(w, r)
}

// guard runs the first checks of the published order: request size, content
// type and a foreign origin on a state-changing request.
func (s *Server) guard(w http.ResponseWriter, r *http.Request) error {
	limit := int64(maxJSONBytes)
	isUpload := strings.HasSuffix(r.URL.Path, "/imports")
	if isUpload {
		limit = maxUploadBytes
	}
	if r.ContentLength > limit {
		writeError(w, http.StatusRequestEntityTooLarge, "too_large", "That request is larger than this endpoint takes.", nil)
		return errHandled
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit+1)
	if r.ContentLength > 0 && r.Method != http.MethodGet {
		mediaType := strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0])
		want := "application/json"
		if isUpload {
			want = "text/calendar"
		}
		if mediaType != want {
			writeError(w, http.StatusUnsupportedMediaType, "unsupported_media_type",
				"Send "+want+" to this endpoint.", nil)
			return errHandled
		}
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		if origin := r.Header.Get("Origin"); origin != "" && !sameOrigin(origin, r) {
			writeError(w, http.StatusForbidden, "cross_origin", "This app answers its own origin only.", nil)
			return errHandled
		}
	}
	return nil
}

var errHandled = errors.New("handled")

func sameOrigin(origin string, r *http.Request) bool {
	parsed, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return parsed.Host == r.Host
}

// writeError writes the one published error shape.
func writeError(w http.ResponseWriter, status int, code, message string, fields map[string]string) {
	body := map[string]any{"error": code, "message": message}
	if len(fields) > 0 {
		body["fields"] = fields
	}
	writeJSON(w, status, body)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if body != nil {
		_ = json.NewEncoder(w).Encode(body)
	}
}

func readJSON(w http.ResponseWriter, r *http.Request, into any) error {
	data, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "unreadable", "That request could not be read.", nil)
		return errHandled
	}
	if len(data) > maxJSONBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "too_large", "That request is larger than this endpoint takes.", nil)
		return errHandled
	}
	if len(data) == 0 {
		data = []byte("{}")
	}
	if err := json.Unmarshal(data, into); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_json", "That request body is not valid JSON.", nil)
		return errHandled
	}
	return nil
}

func newID(prefix string) string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		panic(err)
	}
	return prefix + "-" + hex.EncodeToString(buf)
}

// Context holds everything one request needs about its caller.
type Context struct {
	Person    domain.Person
	Viewer    domain.Viewer
	Settings  domain.Settings
	Rules     domain.ZoneRules
	Expander  domain.Expander
	Projector domain.Projector
	Now       time.Time
}

func (s *Server) contextFor(ctx context.Context, person domain.Person) (*Context, error) {
	levels, err := s.Store.Levels(ctx, person.ID)
	if err != nil {
		return nil, err
	}
	settings, err := s.Store.Settings(ctx)
	if err != nil {
		return nil, err
	}
	rules, err := s.Store.ZoneRules(ctx)
	if err != nil {
		return nil, err
	}
	now := s.Clock.Now()
	viewer := domain.Viewer{Person: person, Levels: levels, Settings: settings}
	expander := domain.Expander{Rules: rules, Now: now}
	return &Context{
		Person:    person,
		Viewer:    viewer,
		Settings:  settings,
		Rules:     rules,
		Expander:  expander,
		Projector: domain.Projector{Viewer: viewer, Expander: expander, Settings: settings},
		Now:       now,
	}, nil
}

// caller reads the session cookie and loads the caller, whose role and share
// levels are read on every request.
func (s *Server) caller(w http.ResponseWriter, r *http.Request) *Context {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil || cookie.Value == "" {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Sign in to use Wren.", nil)
		return nil
	}
	person, err := s.Store.SessionPerson(r.Context(), cookie.Value)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Sign in to use Wren.", nil)
		return nil
	}
	c, err := s.contextFor(r.Context(), person)
	if err != nil {
		s.fail(w, err)
		return nil
	}
	return c
}

func (s *Server) fail(w http.ResponseWriter, err error) {
	writeError(w, http.StatusInternalServerError, "server_error", "Something went wrong. Try again shortly.", nil)
	fmt.Printf("wren: %v\n", err)
}

func notFound(w http.ResponseWriter) {
	writeError(w, http.StatusNotFound, "not_found", "That is not available.", nil)
}

func forbidden(w http.ResponseWriter, code string) {
	writeError(w, http.StatusForbidden, code, "You do not have access to do that.", nil)
}

func unprocessable(w http.ResponseWriter, fields map[string]string) {
	writeError(w, http.StatusUnprocessableEntity, "invalid", "Check the fields below.", fields)
}

func queryInt(r *http.Request, name string, fallback int) (int, bool) {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return fallback, true
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return 0, false
	}
	return n, true
}

func queryList(r *http.Request, name string) []string {
	raw := strings.TrimSpace(r.URL.Query().Get(name))
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// ifMatch reads the version a caller is writing against.
func ifMatch(w http.ResponseWriter, r *http.Request) (int, bool) {
	raw := strings.Trim(r.Header.Get("If-Match"), `"`)
	if raw == "" {
		writeError(w, http.StatusPreconditionRequired, "version_required", "Send the version you are changing in If-Match.", nil)
		return 0, false
	}
	version, err := strconv.Atoi(raw)
	if err != nil {
		writeError(w, http.StatusPreconditionRequired, "version_required", "Send the version you are changing in If-Match.", nil)
		return 0, false
	}
	return version, true
}

// conflict writes the published 412, carrying the winner's values.
func (s *Server) conflict(w http.ResponseWriter, c *Context, e *domain.Event, key string) {
	name := e.SavedByName
	if name == "" {
		name = e.OrganiserName
	}
	writeJSON(w, http.StatusPreconditionFailed, map[string]any{
		"error":   "version_conflict",
		"message": name + " saved this first.",
		"current": c.Projector.Event(e, key),
	})
}

func (s *Server) withETag(w http.ResponseWriter, version int) {
	w.Header().Set("ETag", `"`+strconv.Itoa(version)+`"`)
}
