package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
)

// access is the lowest role a route admits.
type access int

const (
	accPublic access = iota // anyone
	accAny                  // any signed-in person, stakeholders included
	accStaff                // responder, lead, admin (not stakeholder)
	accLead                 // lead, admin
	accAdmin                // admin
)

const (
	bodyLimit       = 1_000_000
	intakeBodyLimit = 512_000
)

// route is one API endpoint. Handlers return an error; the framework writes it with writeError.
//
// Order of checks (the brief's error precedence): body size, origin, JSON validity, authentication (401),
// the resource named by {id} (404), role and key scope (403), then the handler, which does 428/412, 409, 422.
type route struct {
	Pattern  string // "GET /api/incidents/{id}"
	Access   access
	Resource string // kind of the first path value, checked for existence before permissions ("incident", "policy", ...)
	KeyWrite bool   // a write-scoped API key may call it
	Handler  func(*Req) error
}

// resourceTables maps a Resource kind to the table holding it. Every such table has a text id column.
var resourceTables = map[string]string{
	"incident": "incidents", "policy": "policies", "service": "services", "schedule": "schedules",
	"integration": "integrations", "deadletter": "dead_letters", "webhook": "webhooks",
	"delivery": "webhook_deliveries", "user": "users", "apikey": "api_keys", "window": "maintenance_windows",
	"statusupdate": "status_updates", "job": "analytics_jobs", "request": "responder_requests",
}

// Req is one API request after the framework checks.
type Req struct {
	W     http.ResponseWriter
	R     *http.Request
	A     *App
	Actor *Actor // nil on public routes without a session
	Body  []byte
}

// Ctx is the request context.
func (rq *Req) Ctx() context.Context { return rq.R.Context() }

// Param is a path value.
func (rq *Req) Param(name string) string { return rq.R.PathValue(name) }

// Query is a URL query value.
func (rq *Req) Query(name string) string { return rq.R.URL.Query().Get(name) }

// Decode reads the JSON body into dst; an empty body decodes as {}.
func (rq *Req) Decode(dst any) error {
	body := rq.Body
	if len(bytes.TrimSpace(body)) == 0 {
		body = []byte("{}")
	}
	if err := json.Unmarshal(body, dst); err != nil {
		return errBadJSON()
	}
	return nil
}

// JSON writes a JSON success response.
func (rq *Req) JSON(status int, v any) error {
	writeJSON(rq.W, status, v)
	return nil
}

// NoContent writes a 204.
func (rq *Req) NoContent() error {
	rq.W.WriteHeader(http.StatusNoContent)
	return nil
}

// Record writes a record read with its ETag, answering 304 on a matching If-None-Match.
func (rq *Req) Record(status int, v any, version int) error {
	etag := `"` + strconv.Itoa(version) + `"`
	rq.W.Header().Set("ETag", etag)
	if etagMatches(rq.R.Header.Get("If-None-Match"), etag) {
		rq.W.WriteHeader(http.StatusNotModified)
		return nil
	}
	return rq.JSON(status, v)
}

// IfMatch reads the version a save is made over; a missing or unreadable header is the 428.
func (rq *Req) IfMatch() (int, error) {
	raw := strings.Trim(strings.TrimSpace(rq.R.Header.Get("If-Match")), `"`)
	version, err := strconv.Atoi(raw)
	if err != nil {
		return 0, errVersionRequired()
	}
	return version, nil
}

func etagMatches(header, etag string) bool {
	for _, candidate := range strings.Split(header, ",") {
		candidate = strings.TrimPrefix(strings.TrimSpace(candidate), "W/")
		if candidate == etag || candidate == "*" {
			return true
		}
	}
	return false
}

// starting answers the 503 {"status":"starting"} and reports true while the app is still booting.
func (a *App) starting(w http.ResponseWriter) bool {
	if a.ready.Load() {
		return false
	}
	writeError(w, errStarting())
	return true
}

// route registers one API endpoint on the mux.
func (a *App) route(rt route) {
	a.mux.HandleFunc(rt.Pattern, func(w http.ResponseWriter, r *http.Request) {
		if a.starting(w) {
			return
		}
		if err := a.serveRoute(rt, w, r); err != nil {
			writeError(w, err)
		}
	})
}

func (a *App) serveRoute(rt route, w http.ResponseWriter, r *http.Request) error {
	limit := int64(bodyLimit)
	if rt.Pattern == "POST /api/events" {
		limit = intakeBodyLimit
	}
	body, err := readBody(r, limit)
	if err != nil {
		return fmt.Errorf("read request body: %w", err)
	}
	if rt.Pattern != "POST /api/events" && a.crossOrigin(r) {
		return errCrossOrigin()
	}
	if len(body) > 0 && !json.Valid(body) {
		return errBadJSON()
	}
	rq := &Req{W: w, R: r, A: a, Body: body}
	if rt.Access != accPublic {
		actor, err := a.authenticate(r)
		if err != nil {
			return fmt.Errorf("authenticate request: %w", err)
		}
		rq.Actor = actor
	}
	if rt.Resource != "" {
		found, err := a.resourceExists(r, rt.Resource)
		if err != nil {
			return fmt.Errorf("look up resource: %w", err)
		}
		if !found {
			return errNotFound()
		}
	}
	if rt.Access != accPublic && !rq.Actor.permits(rt.Access, r.Method, rt.KeyWrite) {
		return errForbidden()
	}
	if err := a.settle(r.Context()); err != nil {
		return fmt.Errorf("apply due timers: %w", err)
	}
	if err := rt.Handler(rq); err != nil {
		return fmt.Errorf("handle request: %w", err)
	}
	return nil
}

func readBody(r *http.Request, limit int64) ([]byte, error) {
	if r.ContentLength > limit {
		return nil, errTooLarge()
	}
	if r.Body == nil {
		return nil, nil
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil {
		return nil, fmt.Errorf("read request body: %w", err)
	}
	if int64(len(body)) > limit {
		return nil, errTooLarge()
	}
	return body, nil
}

// crossOrigin reports a state-changing request, or a socket upgrade, whose Origin differs from the app's.
func (a *App) crossOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return false
	}
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		if r.URL.Path != "/api/live" {
			return false
		}
	}
	if strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
		return false
	}
	parsed, err := url.Parse(origin)
	return err != nil || parsed.Host != r.Host
}

func (a *App) resourceExists(r *http.Request, kind string) (bool, error) {
	id := r.PathValue("id")
	table := resourceTables[kind]
	var found bool
	err := a.db.QueryRow(r.Context(), `select exists (select 1 from `+table+` where id = $1)`, id).Scan(&found)
	if err != nil {
		return false, fmt.Errorf("check %s %q: %w", kind, id, err)
	}
	return found, nil
}

// idemFlight serialises requests that share an Idempotency-Key.
var idemFlight sync.Map

// Idempotent runs fn once per Idempotency-Key. The same key and body replays the stored response; the same key with a
// different request answers 409 idempotency_conflict. Without the header fn simply runs.
func (rq *Req) Idempotent(fn func() error) error {
	key := rq.R.Header.Get("Idempotency-Key")
	if key == "" {
		if err := fn(); err != nil {
			return fmt.Errorf("run request: %w", err)
		}
		return nil
	}
	lock, _ := idemFlight.LoadOrStore(key, &sync.Mutex{})
	mutex := lock.(*sync.Mutex)
	mutex.Lock()
	defer mutex.Unlock()

	sum := sha256.Sum256([]byte(rq.R.Method + " " + rq.R.URL.Path + "\n" + string(rq.Body)))
	fingerprint := hex.EncodeToString(sum[:])
	ctx := rq.R.Context()
	var storedFingerprint string
	var status int
	var stored []byte
	err := rq.A.db.QueryRow(ctx, `select fingerprint, status, body from idempotency where key = $1`, key).
		Scan(&storedFingerprint, &status, &stored)
	switch {
	case err == nil:
		if storedFingerprint != fingerprint {
			return errConflict("idempotency_conflict")
		}
		rq.W.Header().Set("Content-Type", "application/json")
		rq.W.WriteHeader(status)
		_, _ = rq.W.Write(stored)
		return nil
	case !isNoRows(err):
		return fmt.Errorf("read idempotency key: %w", err)
	}

	buffered := &recorder{header: http.Header{}, status: http.StatusOK}
	real := rq.W
	rq.W = buffered
	runErr := fn()
	rq.W = real
	if runErr != nil {
		var api *apiError
		if !errors.As(runErr, &api) {
			if err := runErr; err != nil {
				return fmt.Errorf("run request: %w", err)
			}
			return nil
		}
		buffered = &recorder{header: http.Header{}, status: http.StatusOK}
		writeError(buffered, api)
	}
	if buffered.status < 500 {
		_, err = rq.A.db.Exec(ctx, `insert into idempotency (key, fingerprint, status, body, created_at) values ($1, $2, $3, $4, $5)
			on conflict do nothing`, key, fingerprint, buffered.status, buffered.body.Bytes(), rq.A.clock.Now())
		if err != nil {
			return fmt.Errorf("store idempotency key: %w", err)
		}
	}
	for name, values := range buffered.header {
		real.Header()[name] = values
	}
	real.WriteHeader(buffered.status)
	_, _ = real.Write(buffered.body.Bytes())
	return nil
}

// recorder buffers a response so Idempotent can store it.
type recorder struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (r *recorder) Header() http.Header         { return r.header }
func (r *recorder) WriteHeader(status int)      { r.status = status }
func (r *recorder) Write(b []byte) (int, error) { return r.body.Write(b) }
