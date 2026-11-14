package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	maxBodyBytes   = 65536
	requestTimeout = 90 * time.Second
)

// App is the Yardline server.
type App struct {
	cfg      Config
	pool     *pgxpool.Pool
	clock    *ClubClock
	courtpay *Courtpay
	keycloak *Keycloak
	ready    atomic.Bool
}

// request is one API call after the boundary checks.
type request struct {
	w    http.ResponseWriter
	r    *http.Request
	body []byte
	me   *Identity
}

// result is an answer to write; replayed marks an idempotent replay.
type result struct {
	status   int
	body     any
	replayed bool
}

func ok(body any) result      { return result{status: http.StatusOK, body: body} }
func created(body any) result { return result{status: http.StatusCreated, body: body} }

// routeSpec says who may call a route.
type routeSpec struct {
	roles    []string // any of these; empty means any signed-in person with a club role
	optional bool     // a signed-out caller is allowed
	anyone   bool     // no club role is needed, only a sign-in
	joins    bool     // counts toward the join attempt limit
}

type handlerFunc func(ctx context.Context, rq *request) (result, error)

// route wraps a handler with the boundary checks in their published order: 413 and 415, 401, same origin,
// 429, then 403 for the route's role. The handler continues from 404.
func (a *App) route(spec routeSpec, fn handlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), requestTimeout)
		defer cancel()
		rq := &request{w: w, r: r}
		w.Header().Set("Cache-Control", "no-store")
		res, err := a.serve(ctx, rq, spec, fn)
		if err != nil {
			writeError(w, err)
			return
		}
		if res.replayed {
			w.Header().Set("Idempotent-Replay", "true")
		}
		writeJSON(w, res.status, res.body)
	}
}

func (a *App) serve(ctx context.Context, rq *request, spec routeSpec, fn handlerFunc) (result, error) {
	if err := readBody(rq); err != nil {
		return result{}, err
	}
	me, err := a.authenticate(ctx, rq.r)
	if err != nil {
		return result{}, err
	}
	rq.me = me
	if me == nil && !spec.optional {
		return result{}, fail(codeUnauthenticated)
	}
	if me != nil && !a.sameOrigin(rq.r) {
		return result{}, fail(codeForbidden)
	}
	if spec.joins {
		if err := a.limitJoins(ctx, me); err != nil {
			return result{}, err
		}
	}
	if me != nil && !spec.anyone && !me.hasAnyRole(spec.roles) {
		return result{}, fail(codeForbidden)
	}
	// No stored id holds a NUL or broken UTF-8, so such an address names nothing (and must not reach the database).
	if strings.ContainsRune(rq.r.URL.Path, 0) || !utf8.ValidString(rq.r.URL.Path) {
		return result{}, fail(codeNotFound)
	}
	return fn(ctx, rq)
}

// readBody enforces the size and media type limits of a write route before anything else is decided.
func readBody(rq *request) error {
	if rq.r.Method == http.MethodGet || rq.r.Method == http.MethodHead {
		return nil
	}
	if rq.r.ContentLength > maxBodyBytes {
		return fail(codeTooLarge)
	}
	body, err := io.ReadAll(io.LimitReader(rq.r.Body, maxBodyBytes+1))
	if err != nil {
		return fmt.Errorf("read request body: %w", err)
	}
	if len(body) > maxBodyBytes {
		return fail(codeTooLarge)
	}
	if len(body) > 0 {
		kind, _, err := mime.ParseMediaType(rq.r.Header.Get("Content-Type"))
		if err != nil || kind != "application/json" {
			return fail(codeUnsupportedMedia)
		}
	}
	rq.body = body
	return nil
}

// sameOrigin refuses a state-changing request carried by a session cookie from another origin.
func (a *App) sameOrigin(r *http.Request) bool {
	if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Header.Get("Authorization") != "" {
		return true
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return parsed.Host == r.Host || origin == a.cfg.PublicURL
}

// decodeJSON reads a JSON object body; an empty body is an empty object.
func decodeJSON(rq *request, into any) error {
	if len(bytes.TrimSpace(rq.body)) == 0 {
		return nil
	}
	// A NUL can't be stored in any text field, so a body carrying one is refused like any other malformed body.
	if err := json.Unmarshal(rq.body, into); err != nil || bytes.Contains(rq.body, []byte(`\u0000`)) {
		return failValidation(map[string]string{})
	}
	return nil
}

// ---- routes ----

func (a *App) handler() http.Handler {
	mux := http.NewServeMux()
	player := routeSpec{roles: []string{rolePlayer}}
	desk := routeSpec{roles: []string{roleDesk, roleManager}}
	manager := routeSpec{roles: []string{roleManager}}
	coach := routeSpec{roles: []string{roleCoach}}
	anyRole := routeSpec{}

	mux.HandleFunc("GET /api/health", a.health)
	mux.HandleFunc("GET /login", a.login)
	mux.HandleFunc("GET /auth/callback", a.authCallback)
	mux.HandleFunc("POST /logout", a.logout)

	mux.HandleFunc("GET /api/me", a.route(routeSpec{anyone: true}, a.getMe))
	mux.HandleFunc("GET /api/club", a.route(routeSpec{optional: true}, a.getClub))
	mux.HandleFunc("GET /api/grid", a.route(anyRole, a.getGrid))
	mux.HandleFunc("GET /api/quote", a.route(anyRole, a.getQuote))

	mux.HandleFunc("POST /api/holds", a.route(player, a.postHold))
	mux.HandleFunc("GET /api/bookings/{id}", a.route(routeSpec{roles: []string{rolePlayer, roleManager}}, a.getBooking))
	mux.HandleFunc("POST /api/bookings/{id}/pay", a.route(player, a.postPay))
	mux.HandleFunc("POST /api/bookings/{id}/release", a.route(player, a.postRelease))
	mux.HandleFunc("POST /api/bookings/{id}/cancel", a.route(player, a.postCancel))
	mux.HandleFunc("GET /api/me/bookings", a.route(player, a.getMyBookings))
	mux.HandleFunc("GET /api/me/credits", a.route(player, a.getMyCredits))

	mux.HandleFunc("GET /api/shares/{token}", a.route(player, a.getShare))
	mux.HandleFunc("POST /api/shares/{token}/pay", a.route(player, a.postSharePay))

	mux.HandleFunc("GET /api/matches", a.route(routeSpec{optional: true}, a.getMatches))
	mux.HandleFunc("GET /api/matches/{id}", a.route(routeSpec{optional: true}, a.getMatch))
	mux.HandleFunc("POST /api/matches", a.route(player, a.postMatch))
	mux.HandleFunc("POST /api/matches/{id}/join", a.route(routeSpec{roles: []string{rolePlayer}, joins: true}, a.postJoin))

	mux.HandleFunc("GET /api/desk/bookings", a.route(desk, a.getDeskBookings))
	mux.HandleFunc("POST /api/desk/bookings/{id}/check-in", a.route(desk, a.postCheckIn))
	mux.HandleFunc("POST /api/desk/bookings/{id}/no-show", a.route(desk, a.postNoShow))
	mux.HandleFunc("GET /api/desk/notices", a.route(desk, a.getDeskNotices))

	mux.HandleFunc("POST /api/lessons", a.route(coach, a.postLessons))
	mux.HandleFunc("GET /api/lessons", a.route(coach, a.getLessons))
	mux.HandleFunc("GET /api/lessons/{id}", a.route(routeSpec{roles: []string{roleCoach, roleManager}}, a.getLesson))

	mux.HandleFunc("GET /api/manager/pricing", a.route(manager, a.getPricing))
	mux.HandleFunc("PUT /api/manager/pricing", a.route(manager, a.putPricing))
	mux.HandleFunc("GET /api/manager/cancellation-rule", a.route(manager, a.getCancellationRule))
	mux.HandleFunc("PUT /api/manager/cancellation-rule", a.route(manager, a.putCancellationRule))
	mux.HandleFunc("GET /api/manager/utilisation", a.route(manager, a.getUtilisation))

	mux.HandleFunc("/api/", a.route(routeSpec{optional: true}, func(context.Context, *request) (result, error) {
		return result{}, fail(codeNotFound)
	}))
	mux.HandleFunc("GET /realms/", a.signInServerPage)
	mux.HandleFunc("/", a.servePage)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !a.ready.Load() && r.URL.Path != "/api/health" {
			writeStarting(w)
			return
		}
		mux.ServeHTTP(w, r)
	})
}

// writeStarting is the answer, from every route, until PostgreSQL and Keycloak are reached.
func writeStarting(w http.ResponseWriter) {
	writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "starting"})
}

func (a *App) health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !a.ready.Load() {
		writeStarting(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
