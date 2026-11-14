package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"
)

const maxBodyBytes = 65536

// access says who may call a route.
type access int

const (
	anyone   access = iota // signed in or not
	signedIn               // any signed-in person, even with no club role
	withRole               // signed in with one of the route's roles
)

type route struct {
	access     access
	roles      []string
	joinLimit  bool
	idempotent bool
	lookup     func(*call) error
	handle     func(*call) (int, any, error)
}

type call struct {
	a    *app
	r    *http.Request
	ctx  context.Context
	user *identity
	body []byte
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		log.Printf("encode answer: %v", err)
		status, b = http.StatusInternalServerError, []byte(`{"code":"INTERNAL","message":"Something went wrong on our side. Try again."}`)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(b)
}

func asAPIError(err error) *apiError {
	var ae *apiError
	if errors.As(err, &ae) {
		return ae
	}
	log.Printf("request failed: %v", err)
	return fail("INTERNAL")
}

func (a *app) api(mux *http.ServeMux, pattern string, rt route) {
	mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if !a.ready.Load() {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "starting"})
			return
		}
		status, body, replay, err := a.run(r, rt)
		if err != nil {
			writeAPIError(w, asAPIError(err))
			return
		}
		if replay {
			w.Header().Set("Idempotent-Replay", "true")
		}
		if raw, ok := body.(json.RawMessage); ok {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(status)
			_, _ = w.Write(raw)
			return
		}
		writeJSON(w, status, body)
	})
}

// run applies the published order of checks, steps 1 to 6; each handler
// then applies steps 7 to 11 for its own resource.
func (a *app) run(r *http.Request, rt route) (int, any, bool, error) {
	c := &call{a: a, r: r, ctx: context.WithoutCancel(r.Context())}
	if r.Method == http.MethodPost || r.Method == http.MethodPut {
		body, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes+1))
		if err != nil {
			return 0, nil, false, fail("TOO_LARGE")
		}
		if len(body) > maxBodyBytes {
			return 0, nil, false, fail("TOO_LARGE")
		}
		if len(bytes.TrimSpace(body)) > 0 {
			mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
			if err != nil || mt != "application/json" {
				return 0, nil, false, fail("UNSUPPORTED_MEDIA_TYPE")
			}
		}
		c.body = body
		if _, err := r.Cookie(sessionCookie); err == nil && crossOrigin(r) {
			return 0, nil, false, fail("FORBIDDEN")
		}
	}
	user, err := a.identify(c.ctx, r)
	if err != nil {
		return 0, nil, false, err
	}
	c.user = user
	if rt.access != anyone && user == nil {
		return 0, nil, false, fail("UNAUTHENTICATED")
	}
	if rt.joinLimit {
		if err := a.countJoinAttempt(c.ctx, user.Username); err != nil {
			return 0, nil, false, err
		}
	}
	roleless := user != nil && len(user.Roles) == 0 && rt.access != signedIn
	if roleless || (rt.access == withRole && !user.hasAny(rt.roles)) {
		return 0, nil, false, fail("FORBIDDEN")
	}
	if rt.lookup != nil {
		if err := rt.lookup(c); err != nil {
			return 0, nil, false, err
		}
	}
	if rt.idempotent && r.Header.Get("Idempotency-Key") != "" {
		return a.idempotent(c, rt.handle)
	}
	if _, ok := r.Header["Idempotency-Key"]; ok && rt.idempotent {
		return 0, nil, false, invalidField("Idempotency-Key", msgIdempotencyKey)
	}
	status, body, err := rt.handle(c)
	return status, body, false, err
}

// fields decodes a JSON object body; an empty body is an empty object.
func (c *call) fields() (jsonFields, error) {
	f := jsonFields{}
	if len(bytes.TrimSpace(c.body)) == 0 {
		return f, nil
	}
	if err := json.Unmarshal(c.body, &f); err != nil {
		return nil, invalid(map[string]string{})
	}
	return f, nil
}

type jsonFields map[string]json.RawMessage

func (f jsonFields) has(name string) bool {
	v, ok := f[name]
	return ok && string(v) != "null"
}

func (f jsonFields) intField(name string) (int, bool) {
	var n json.Number
	dec := json.NewDecoder(bytes.NewReader(f[name]))
	dec.UseNumber()
	if err := dec.Decode(&n); err != nil {
		return 0, false
	}
	i, err := strconv.Atoi(n.String())
	return i, err == nil
}

func (f jsonFields) floatField(name string) (float64, bool) {
	var v float64
	err := json.Unmarshal(f[name], &v)
	return v, err == nil && f.has(name)
}

func (f jsonFields) stringField(name string) (string, bool) {
	var s string
	err := json.Unmarshal(f[name], &s)
	return s, err == nil
}

func (f jsonFields) stringList(name string) ([]string, bool) {
	var s []string
	err := json.Unmarshal(f[name], &s)
	return s, err == nil
}

// withinTextLimit is the 280 code point limit for notes and descriptions.
func withinTextLimit(s string) bool { return utf8.RuneCountInString(s) <= 280 }

func validLevel(v float64) bool {
	return v >= 1 && v <= 7 && v*2 == float64(int(v*2))
}

func (a *app) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", a.handleHealth)
	mux.HandleFunc("GET /login", a.handleLogin)
	mux.HandleFunc("GET /auth/callback", a.handleCallback)
	mux.HandleFunc("POST /logout", a.handleLogout)

	players, staff, managerOnly := []string{"player"}, []string{"desk", "manager"}, []string{"manager"}
	allRoles := appRoles
	a.api(mux, "GET /api/me", route{access: signedIn, handle: a.getMe})
	a.api(mux, "GET /api/club", route{access: anyone, handle: a.getClub})
	a.api(mux, "GET /api/grid", route{access: withRole, roles: allRoles, handle: a.getGrid})
	a.api(mux, "GET /api/quote", route{access: withRole, roles: allRoles, handle: a.getQuote})
	a.api(mux, "POST /api/holds", route{access: withRole, roles: players, idempotent: true, handle: a.postHold})
	a.api(mux, "GET /api/bookings/{id}", route{access: withRole, roles: []string{"player", "manager"}, lookup: a.lookupBookingReader, handle: a.getBooking})
	a.api(mux, "POST /api/bookings/{id}/pay", route{access: withRole, roles: players, lookup: a.lookupOwnBooking, idempotent: true, handle: a.payBooking})
	a.api(mux, "POST /api/bookings/{id}/release", route{access: withRole, roles: players, lookup: a.lookupOwnBooking, handle: a.releaseBooking})
	a.api(mux, "POST /api/bookings/{id}/cancel", route{access: withRole, roles: players, lookup: a.lookupOwnBooking, handle: a.cancelBooking})
	a.api(mux, "GET /api/me/bookings", route{access: withRole, roles: players, handle: a.getMyBookings})
	a.api(mux, "GET /api/me/credits", route{access: withRole, roles: players, handle: a.getMyCredits})
	a.api(mux, "GET /api/shares/{token}", route{access: withRole, roles: players, lookup: a.lookupOwnShare, handle: a.getShare})
	a.api(mux, "POST /api/shares/{token}/pay", route{access: withRole, roles: players, lookup: a.lookupOwnShare, idempotent: true, handle: a.payShare})
	a.api(mux, "GET /api/matches", route{access: anyone, handle: a.listMatches})
	a.api(mux, "GET /api/matches/{id}", route{access: anyone, lookup: a.lookupMatch, handle: a.getMatch})
	a.api(mux, "POST /api/matches", route{access: withRole, roles: players, idempotent: true, handle: a.createMatch})
	a.api(mux, "POST /api/matches/{id}/join", route{access: withRole, roles: players, joinLimit: true, lookup: a.lookupMatch, idempotent: true, handle: a.joinMatch})
	a.api(mux, "GET /api/desk/bookings", route{access: withRole, roles: staff, handle: a.getDeskBookings})
	a.api(mux, "POST /api/desk/bookings/{id}/check-in", route{access: withRole, roles: staff, lookup: a.lookupDeskBooking, handle: a.checkIn})
	a.api(mux, "POST /api/desk/bookings/{id}/no-show", route{access: withRole, roles: staff, lookup: a.lookupDeskBooking, handle: a.markNoShow})
	a.api(mux, "GET /api/desk/notices", route{access: withRole, roles: staff, handle: a.getNotices})
	a.api(mux, "POST /api/lessons", route{access: withRole, roles: []string{"coach"}, handle: a.createLessons})
	a.api(mux, "GET /api/lessons", route{access: withRole, roles: []string{"coach"}, handle: a.listLessons})
	a.api(mux, "GET /api/lessons/{id}", route{access: withRole, roles: []string{"coach", "manager"}, lookup: a.lookupLesson, handle: a.getLesson})
	a.api(mux, "GET /api/manager/pricing", route{access: withRole, roles: managerOnly, handle: a.getPricing})
	a.api(mux, "PUT /api/manager/pricing", route{access: withRole, roles: managerOnly, handle: a.putPricing})
	a.api(mux, "GET /api/manager/cancellation-rule", route{access: withRole, roles: managerOnly, handle: a.getRule})
	a.api(mux, "PUT /api/manager/cancellation-rule", route{access: withRole, roles: managerOnly, handle: a.putRule})
	a.api(mux, "GET /api/manager/utilisation", route{access: withRole, roles: managerOnly, handle: a.getUtilisation})
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		writeAPIError(w, fail("NOT_FOUND"))
	})
	mux.HandleFunc("/", a.servePage)
	return mux
}

func (a *app) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !a.ready.Load() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "starting"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func pathID(c *call, name string) string { return strings.TrimSpace(c.r.PathValue(name)) }
