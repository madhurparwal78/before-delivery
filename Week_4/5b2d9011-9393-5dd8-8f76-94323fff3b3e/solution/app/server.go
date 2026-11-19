package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"unicode"
	"unicode/utf8"
)

const (
	buildID       = "2026.11.06"
	bodyLimit     = 16384
	roleFounder   = "founder"
	rolePlayer    = "player"
	sessionCookie = "hf_session"
)

type server struct {
	cfg     config
	clock   *wallClock
	store   *store
	reg     *registry
	deps    *dependencies
	hub     *hub
	mail    *mailer
	persist *persister

	sessionMu sync.Mutex
	sessions  map[string]player
	prices    atomic.Pointer[priceBook]
}

type bodyKey struct{}

func bodyOf(r *http.Request) []byte {
	body, _ := r.Context().Value(bodyKey{}).([]byte)
	return body
}

// typeMessages is each field's published validation copy (Feedback states), so a value of the wrong JSON type
// (a string or fraction for a whole number, a number for a callsign) reads as that field's own 422 message.
var typeMessages = map[string]string{
	"aim":            "Use an aim from 0 to 360.",
	"callsign":       "Use 3 to 16 letters, digits, spaces, hyphens or underscores.",
	"capacity":       "Use 1 to 64.",
	"effects_volume": "Use a whole number from 0 to 100.",
	"heading":        "Use a heading from 0 to 360.",
	"master_volume":  "Use a whole number from 0 to 100.",
	"price":          "Use a whole number from 1 to 5000.",
	"seq":            "Use a whole number from 1.",
	"weeks":          "Use 1 to 26.",
}

// decodeBody reads the JSON body (already known to be well-formed) into dst; a value of the
// wrong type becomes a field error.
func decodeBody(r *http.Request, dst any) error {
	body := bodyOf(r)
	if len(body) == 0 {
		return nil
	}
	if err := json.Unmarshal(body, dst); err != nil {
		var typeErr *json.UnmarshalTypeError
		if errors.As(err, &typeErr) {
			field := typeErr.Field
			if field == "" {
				field = "body"
			}
			if msg, ok := typeMessages[field]; ok {
				return failFields(map[string]string{field: msg})
			}
			return failFields(map[string]string{field: "Use a " + typeErr.Type.String() + "."})
		}
		return fail("bad_json")
	}
	return nil
}

// guard enforces the transport rules of the API: same origin, body size, content type, JSON.
func (s *server) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if origin := r.Header.Get("Origin"); origin != "" {
				u, err := url.Parse(origin)
				if err != nil || u.Host != r.Host {
					writeError(w, fail("cross_origin"))
					return
				}
			}
		}
		data, err := io.ReadAll(io.LimitReader(r.Body, bodyLimit+1))
		if err != nil {
			writeError(w, fail("bad_json"))
			return
		}
		if len(data) > bodyLimit {
			writeError(w, fail("body_too_large"))
			return
		}
		if len(data) > 0 {
			media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
			if err != nil || media != "application/json" {
				writeError(w, fail("unsupported_media_type"))
				return
			}
			if !json.Valid(data) {
				writeError(w, fail("bad_json"))
				return
			}
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), bodyKey{}, data)))
	})
}

type handlerFunc func(w http.ResponseWriter, r *http.Request) error

// api adapts a handler that returns an error to http.HandlerFunc; writeError is the one place
// an error becomes a status code and body.
func api(h handlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := h(w, r); err != nil {
			writeError(w, err)
		}
	}
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", api(s.getHealth))
	mux.HandleFunc("GET /api/status", api(s.getStatus))
	mux.HandleFunc("GET /api/studio", api(s.getStudio))
	mux.HandleFunc("GET /api/clock", api(s.getClock))
	if s.cfg.clockControl {
		mux.HandleFunc("PUT /api/clock", api(s.putClock))
		mux.HandleFunc("DELETE /api/clock", api(s.deleteClock))
	}
	mux.HandleFunc("POST /api/sessions", api(s.postSession))
	mux.HandleFunc("DELETE /api/sessions", api(s.deleteSession))
	mux.HandleFunc("GET /api/me", api(s.getMe))
	mux.HandleFunc("GET /api/me/settings", api(s.getSettings))
	mux.HandleFunc("PUT /api/me/settings", api(s.putSettings))

	h := s.hub
	mux.HandleFunc("POST /api/rooms", api(h.postRoom))
	mux.HandleFunc("GET /api/rooms/{code}", api(h.getRoom))
	mux.HandleFunc("GET /api/rooms/{code}/stream", api(h.streamRoom))
	mux.HandleFunc("POST /api/rooms/{code}/join", api(h.postJoin))
	mux.HandleFunc("POST /api/rooms/{code}/ready", api(h.postReady))
	mux.HandleFunc("POST /api/rooms/{code}/start", api(h.postStart))
	mux.HandleFunc("POST /api/rooms/{code}/end", api(h.postEnd))
	mux.HandleFunc("POST /api/rooms/{code}/heartbeat", api(h.postHeartbeat))
	mux.HandleFunc("POST /api/rooms/{code}/leave", api(h.postLeave))
	mux.HandleFunc("POST /api/rooms/{code}/input", api(h.postInput))
	mux.HandleFunc("POST /api/rooms/{code}/reports", api(h.postReport))
	mux.HandleFunc("POST /api/rooms/{code}/reports/batch", api(h.postReportBatch))
	mux.HandleFunc("POST /api/rooms/{code}/pose", api(h.postPose))
	mux.HandleFunc("POST /api/rooms/{code}/purchases", api(h.postPurchase))
	mux.HandleFunc("GET /api/rooms/{code}/ledger", api(h.getLedger))

	mux.HandleFunc("GET /api/history", api(s.getHistory))
	mux.HandleFunc("GET /api/laps", api(s.getLaps))
	mux.HandleFunc("GET /api/maps/{id}", api(s.getMap))

	mux.HandleFunc("GET /api/prices", api(s.getPrices))
	mux.HandleFunc("POST /api/prices", api(s.postPrice))
	mux.HandleFunc("DELETE /api/prices/{id}", api(s.deletePrice))

	mux.HandleFunc("GET /api/nights", api(s.listNights))
	mux.HandleFunc("POST /api/nights/series", api(s.postSeries))
	mux.HandleFunc("GET /api/nights/{id}", api(s.getNight))
	mux.HandleFunc("POST /api/nights/{id}/signups", api(s.postSignup))
	mux.HandleFunc("GET /api/nights/{id}/signups", api(s.listSignups))
	mux.HandleFunc("/api/", api(func(http.ResponseWriter, *http.Request) error { return fail("not_found") }))
	mux.HandleFunc("/", s.serveStatic)
	return s.guard(mux)
}

// ---- platform

func (s *server) getHealth(w http.ResponseWriter, r *http.Request) error {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	return nil
}

func upDown(up bool) string {
	if up {
		return "up"
	}
	return "down"
}

func (s *server) getStatus(w http.ResponseWriter, r *http.Request) error {
	writeJSON(w, http.StatusOK, map[string]any{
		"build": buildID, "tick_hz": tickHz,
		"services": map[string]string{
			"postgres": upDown(s.deps.postgres.Load()),
			"valkey":   upDown(s.reg.available()),
			"mail":     upDown(s.deps.mail.Load()),
		},
		"mail_queued": s.mail.queued.Load(), "server_time": formatInstant(s.clock.Now()), "studio_zone": studioZone,
	})
	return nil
}

func (s *server) getStudio(w http.ResponseWriter, r *http.Request) error {
	writeJSON(w, http.StatusOK, map[string]string{"name": studioName, "zone": studioZone})
	return nil
}

func (s *server) clockBody() map[string]any {
	now := s.clock.Now()
	return map[string]any{"now": formatInstant(now), "studio_local": now.In(studioLoc).Format("2006-01-02T15:04:05"),
		"studio_zone": studioZone, "overridden": s.clock.Overridden()}
}

func (s *server) getClock(w http.ResponseWriter, r *http.Request) error {
	writeJSON(w, http.StatusOK, s.clockBody())
	return nil
}

func (s *server) putClock(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Now string `json:"now"`
	}
	if err := decodeBody(r, &body); err != nil {
		return err
	}
	at, err := parseInstant(body.Now)
	if err != nil {
		return failFields(map[string]string{"now": "Use an RFC 3339 instant with an offset."})
	}
	s.clock.Set(at)
	writeJSON(w, http.StatusOK, s.clockBody())
	return nil
}

func (s *server) deleteClock(w http.ResponseWriter, r *http.Request) error {
	s.clock.Clear()
	writeJSON(w, http.StatusOK, s.clockBody())
	return nil
}

// ---- sessions

func tokenOf(r *http.Request) string {
	if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimSpace(auth[len("Bearer "):])
	}
	if c, err := r.Cookie(sessionCookie); err == nil {
		return c.Value
	}
	return ""
}

func (s *server) requirePlayer(r *http.Request) (player, error) {
	token := tokenOf(r)
	if token == "" {
		return player{}, fail("unauthenticated")
	}
	key := hashSecret(token)
	s.sessionMu.Lock()
	cached, ok := s.sessions[key]
	s.sessionMu.Unlock()
	if ok {
		return cached, nil
	}
	p, found, err := s.store.sessionPlayer(r.Context(), token)
	if err != nil {
		return player{}, err
	}
	if !found {
		return player{}, fail("unauthenticated")
	}
	s.sessionMu.Lock()
	s.sessions[key] = p
	s.sessionMu.Unlock()
	return p, nil
}

func (s *server) requireFounder(r *http.Request) (player, error) {
	p, err := s.requirePlayer(r)
	if err != nil {
		return player{}, err
	}
	if p.Role != roleFounder {
		return player{}, fail("founder_only")
	}
	return p, nil
}

func validCallsign(name string) bool {
	if n := utf8.RuneCountInString(name); n < 3 || n > 16 {
		return false
	}
	for _, c := range name {
		if !unicode.IsLetter(c) && !unicode.IsDigit(c) && c != ' ' && c != '-' && c != '_' {
			return false
		}
	}
	return true
}

func (s *server) postSession(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Callsign  string `json:"callsign"`
		StudioKey string `json:"studio_key"`
	}
	if err := decodeBody(r, &body); err != nil {
		return err
	}
	if !s.deps.postgres.Load() {
		return errStorageDown
	}
	role := rolePlayer
	if body.StudioKey != "" {
		matches, err := s.store.studioKeyMatches(r.Context(), body.StudioKey)
		if err != nil {
			return err
		}
		if !matches {
			return fail("studio_key_invalid")
		}
		role = roleFounder
	}
	if !validCallsign(body.Callsign) {
		return failFields(map[string]string{"callsign": "Use 3 to 16 letters, digits, spaces, hyphens or underscores."})
	}
	token, p, err := s.store.createSession(r.Context(), body.Callsign, role)
	if err != nil {
		return err
	}
	s.sessionMu.Lock()
	s.sessions[hashSecret(token)] = p
	s.sessionMu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode})
	writeJSON(w, http.StatusCreated, map[string]any{"token": token, "player": p})
	return nil
}

func (s *server) deleteSession(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.requirePlayer(r); err != nil {
		return err
	}
	token := tokenOf(r)
	if err := s.store.deleteSession(r.Context(), token); err != nil {
		return err
	}
	s.sessionMu.Lock()
	delete(s.sessions, hashSecret(token))
	s.sessionMu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *server) getMe(w http.ResponseWriter, r *http.Request) error {
	p, err := s.requirePlayer(r)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"player": p})
	return nil
}

// ---- settings

var bindingActions = []string{"move_up", "move_down", "move_left", "move_right", "aim_left", "aim_right",
	"fire", "reload", "grenade", "revive", "shop", "timers"}

var defaultKeys = []string{"KeyW", "KeyS", "KeyA", "KeyD", "KeyQ", "KeyE", "Space", "KeyR", "KeyG", "KeyF", "KeyB", "KeyT"}

type settings struct {
	Bindings      map[string]string `json:"bindings"`
	MasterVolume  *int              `json:"master_volume"`
	EffectsVolume *int              `json:"effects_volume"`
	ReduceEffects *bool             `json:"reduce_effects"`
	ScreenShake   *bool             `json:"screen_shake"`
	CameraBob     *bool             `json:"camera_bob"`
}

func defaultSettings() settings {
	bindings := map[string]string{}
	for i, action := range bindingActions {
		bindings[action] = defaultKeys[i]
	}
	volume, off, on := 80, false, true
	return settings{Bindings: bindings, MasterVolume: &volume, EffectsVolume: &volume, ReduceEffects: &off, ScreenShake: &on, CameraBob: &on}
}

func (v settings) validate() map[string]string {
	fields := map[string]string{}
	seen := map[string]bool{}
	valid := len(v.Bindings) == len(bindingActions)
	for _, action := range bindingActions {
		key, ok := v.Bindings[action]
		if !ok || key == "" || key == "Escape" || seen[key] {
			valid = false
		}
		seen[key] = true
	}
	if !valid {
		fields["bindings"] = "Give every action its own key; Escape can't be bound."
	}
	if v.MasterVolume == nil || *v.MasterVolume < 0 || *v.MasterVolume > 100 {
		fields["master_volume"] = "Use a whole number from 0 to 100."
	}
	if v.EffectsVolume == nil || *v.EffectsVolume < 0 || *v.EffectsVolume > 100 {
		fields["effects_volume"] = "Use a whole number from 0 to 100."
	}
	for name, flag := range map[string]*bool{"reduce_effects": v.ReduceEffects, "screen_shake": v.ScreenShake, "camera_bob": v.CameraBob} {
		if flag == nil {
			fields[name] = "Send true or false."
		}
	}
	return fields
}

func (s *server) getSettings(w http.ResponseWriter, r *http.Request) error {
	p, err := s.requirePlayer(r)
	if err != nil {
		return err
	}
	stored, found, err := s.store.loadSettings(r.Context(), p.ID)
	if err != nil {
		return err
	}
	if !found {
		writeJSON(w, http.StatusOK, defaultSettings())
		return nil
	}
	writeStatus(w, http.StatusOK, stored)
	return nil
}

func (s *server) putSettings(w http.ResponseWriter, r *http.Request) error {
	p, err := s.requirePlayer(r)
	if err != nil {
		return err
	}
	var body settings
	if err := decodeBody(r, &body); err != nil {
		return err
	}
	if !s.deps.postgres.Load() {
		return errStorageDown
	}
	if fields := body.validate(); len(fields) > 0 {
		return failFields(fields)
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	if err := s.store.saveSettings(r.Context(), p.ID, string(payload)); err != nil {
		return err
	}
	writeStatus(w, http.StatusOK, string(payload))
	return nil
}

// ---- history and laps

func limitParam(r *http.Request, fallback int) (int, error) {
	raw := r.URL.Query().Get("limit")
	if raw == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 || n > 50 {
		return 0, failFields(map[string]string{"limit": "Use 1 to 50."})
	}
	return n, nil
}

func (s *server) getHistory(w http.ResponseWriter, r *http.Request) error {
	limit, err := limitParam(r, 20)
	if err != nil {
		return err
	}
	matches, err := s.store.history(r.Context(), limit)
	if err != nil {
		return err
	}
	out := make([]map[string]any, 0, len(matches))
	for _, m := range matches {
		players := make([]map[string]any, 0, len(m.Players))
		for _, p := range m.Players {
			var best any
			if p.BestLapMs != nil {
				best = *p.BestLapMs
			}
			players = append(players, map[string]any{"callsign": p.Callsign, "score": p.Score, "kills": p.Kills,
				"credits_earned": p.CreditsEarned, "best_lap_ms": best})
		}
		var night any
		if m.NightID.Valid {
			night = m.NightID.String
		}
		out = append(out, map[string]any{"id": m.ID, "code": m.Code, "mode": m.Mode, "result": m.Result,
			"waves_cleared": m.WavesCleared, "night_id": night, "started_at": formatInstant(m.StartedAt),
			"ended_at": formatInstant(m.EndedAt), "players": players})
	}
	writeJSON(w, http.StatusOK, map[string]any{"matches": out})
	return nil
}

func (s *server) getLaps(w http.ResponseWriter, r *http.Request) error {
	limit, err := limitParam(r, 10)
	if err != nil {
		return err
	}
	rows, err := s.store.lapBoard(r.Context(), limit)
	if err != nil {
		return err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, l := range rows {
		out = append(out, map[string]any{"rank": l.Rank, "callsign": l.Callsign, "lap_ms": l.LapMs,
			"set_at": formatInstant(l.SetAt), "match_id": l.MatchID})
	}
	writeJSON(w, http.StatusOK, map[string]any{"laps": out})
	return nil
}

// ---- price cache for the shop display

func (s *server) refreshPrices() {
	ctx, cancel := ctxTimeout(3)
	defer cancel()
	rows, err := s.store.priceSchedule(ctx)
	if err != nil {
		log.Printf("price schedule: %v", err)
		return
	}
	s.prices.Store(&priceBook{rows: rows})
}

func (s *server) priceBookSnapshot() priceBook {
	if book := s.prices.Load(); book != nil {
		return *book
	}
	return priceBook{rows: seedPriceChanges()}
}
