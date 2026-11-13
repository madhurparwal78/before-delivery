package main

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"crypto/sha256"

	"github.com/google/uuid"
)

// server.go — the HTTP server, its boundary and the router.

type App struct {
	cfg         *Config
	store       *Store
	clock       *ServerClock
	minio       *MinioClient
	broadcaster *Broadcaster
	printQueue  *PrintQueue
	reminders   *ReminderEngine
	dbReady     bool
	staticDir   string
	http        *http.Server
}

func NewApp(cfg *Config) *App {
	a := &App{cfg: cfg, clock: NewServerClock(cfg), staticDir: "public"}
	SetStoreClock(a.clock)
	return a
}

// Run applies the schema and seed once Postgres answers, then serves.
func (a *App) Run() error {
	a.minio = NewMinioClient(a.cfg)
	a.broadcaster = NewBroadcaster(a.store)

	ctx := context.Background()
	// Postgres may be down at boot; keep retrying every second.
	go func() {
		for {
			st, err := OpenStore(ctx, a.cfg.DatabaseURL)
			if err == nil {
				if err := st.ApplySchema(ctx); err == nil {
					if err := st.ApplySeed(ctx); err != nil {
						log.Printf("seed: %v", err)
					} else {
						if hours, err := st.OfficeHoursAll(ctx); err == nil {
							SetOfficeHours(hours)
						}
						a.store = st
						a.broadcaster.SetStore(st)
						a.printQueue = NewPrintQueue(a)
						a.reminders = NewReminderEngine(a)
						if err := a.EnsureSeedReminders(ctx); err != nil {
							log.Printf("seed reminders: %v", err)
						}
						a.dbReady = true
						log.Print("database ready; schema and seed applied")
						return
					}
				}
			}
			log.Printf("waiting for postgres: %v", err)
			time.Sleep(time.Second)
		}
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("/", a.route)
	mux.HandleFunc("/api/health", a.handleHealth)
	addr := fmt.Sprintf("0.0.0.0:%d", a.cfg.Port)
	a.http = &http.Server{Addr: addr, Handler: mux}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	log.Printf("wren serving on %s", addr)
	return a.http.Serve(ln)
}

// route dispatches between the API, the WebSocket and static pages.
func (a *App) route(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if strings.HasPrefix(r.URL.Path, "/api/") {
		a.apiRoute(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/static/") {
		a.serveStatic(w, r)
		return
	}
	switch r.URL.Path {
	case "/favicon.ico":
		w.WriteHeader(http.StatusNotFound)
	default:
		a.servePage(w, r)
	}
}

func (a *App) serveStatic(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/static/")
	if strings.Contains(name, "..") {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	p := filepath.Join(a.staticDir, filepath.FromSlash(name))
	data, err := os.ReadFile(p)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	switch {
	case strings.HasSuffix(name, ".js"):
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	case strings.HasSuffix(name, ".css"):
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
	case strings.HasSuffix(name, ".woff2"):
		w.Header().Set("Content-Type", "font/woff2")
		w.Header().Set("Cache-Control", "public, max-age=31536000")
	case strings.HasSuffix(name, ".ttf"):
		w.Header().Set("Content-Type", "font/ttf")
	default:
		w.Header().Set("Content-Type", "application/octet-stream")
	}
	w.Write(data)
}

func (a *App) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeJSONStatus(w, http.StatusMethodNotAllowed, errMap("method_not_allowed", "Use GET."))
		return
	}
	if !a.dbReady {
		writeJSONStatus(w, http.StatusServiceUnavailable, map[string]any{"status": "starting"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := a.store.Ping(ctx); err != nil {
		writeJSONStatus(w, http.StatusServiceUnavailable, map[string]any{"status": "starting"})
		return
	}
	writeJSONStatus(w, http.StatusOK, map[string]any{"status": "ok"})
}

// API plumbing --------------------------------------------------------------

func errMap(code, message string) map[string]any {
	return map[string]any{"error": code, "message": message}
}

func fieldErr(code, message string, fields map[string]string) map[string]any {
	return map[string]any{"error": code, "message": message, "fields": fields}
}

type apiError struct {
	status  int
	code    string
	message string
	fields  map[string]string
}

func (e *apiError) Error() string { return e.message }

func apiErr(status int, code, message string) *apiError {
	return &apiError{status: status, code: code, message: message}
}

func apiFieldErr(message string, fields map[string]string) *apiError {
	return &apiError{status: 422, code: "invalid", message: message, fields: fields}
}

func writeJSONStatus(w http.ResponseWriter, status int, v any) {
	b, err := jsonMarshal(v)
	if err != nil {
		http.Error(w, "marshal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(b)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	b, err := jsonMarshal(v)
	if err != nil {
		http.Error(w, "marshal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(b)
}

// apiRoute applies the published order of checks then dispatches.
func (a *App) apiRoute(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if a.dbReady {
		// freshness for office hours (cheap enough per request)
	}
	// size and content-type limits
	var maxBytes int64 = 1_000_000
	if path == "/api/imports" || strings.Contains(path, "/imports") || strings.Contains(path, "/exports") {
		maxBytes = 1_000_000
	}
	if r.Header.Get("Content-Type") != "" && !isAllowedContentType(r) {
		writeJSONStatus(w, http.StatusUnsupportedMediaType, errMap("unsupported_media_type", "Use application/json."))
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 10_000_000)
	defer r.Body.Close()
	// read the whole body first to enforce 413 before anything else
	var body []byte
	var bodyErr error
	if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodDelete {
		limit := maxBytes
		buf := make([]byte, limit+1)
		n, _ := r.Body.Read(buf)
		if int64(n) > limit {
			writeJSONStatus(w, http.StatusRequestEntityTooLarge, errMap("too_large", "That request is too large."))
			return
		}
		rest, err := io.ReadAll(r.Body)
		bodyErr = err
		if len(rest) > 0 {
			writeJSONStatus(w, http.StatusRequestEntityTooLarge, errMap("too_large", "That request is too large."))
			return
		}
		body = buf[:n]
	}
	_ = bodyErr
	// foreign Origin on a state-changing request
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		if origin := r.Header.Get("Origin"); origin != "" {
			host := r.Host
			if !sameOrigin(origin, host) {
				writeJSONStatus(w, http.StatusForbidden, errMap("cross_origin", "Requests from other origins are refused."))
				return
			}
		}
	}
	if !a.dbReady {
		writeJSONStatus(w, http.StatusServiceUnavailable, errMap("starting", "The server is still starting."))
		return
	}
	var resp apiResponse
	resp.body = body
	resp.w = w
	resp.r = r
	if err := a.dispatch(ctxOf(r), &resp, body); err != nil {
		var ae *apiError
		if errors.As(err, &ae) {
			m := map[string]any{"error": ae.code, "message": ae.message}
			if ae.fields != nil {
				m["fields"] = ae.fields
			}
			writeJSONStatus(w, ae.status, m)
			return
		}
		log.Printf("api error: %s %s: %v", r.Method, path, err)
		writeJSONStatus(w, http.StatusInternalServerError, errMap("internal", "Something went wrong."))
		return
	}
}

type apiResponse struct {
	w       http.ResponseWriter
	r       *http.Request
	body    []byte
	Person  *Person
	trashID string
}

func ctxOf(r *http.Request) context.Context { return r.Context() }

func sameOrigin(origin, host string) bool {
	u := strings.TrimPrefix(strings.TrimPrefix(origin, "https://"), "http://")
	return u == host
}

func isAllowedContentType(r *http.Request) bool {
	if strings.HasPrefix(r.URL.Path, "/api/calendars/") && strings.HasSuffix(r.URL.Path, "/imports") {
		return true // text/calendar
	}
	ct := r.Header.Get("Content-Type")
	base := strings.TrimSpace(strings.Split(ct, ";")[0])
	switch base {
	case "application/json", "":
		return true
	}
	return false
}

func hashBody(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

func newID(prefix string) string {
	return prefix + "-" + uuid.NewString()[:8]
}

func personFromRequest(ctx context.Context, s *Store, r *http.Request) (*Person, error) {
	c, err := r.Cookie("wren_session")
	if err != nil {
		return nil, nil
	}
	return s.SessionPerson(ctx, c.Value)
}

// requirePerson gives 401 when no session is present.
func requirePerson(ctx context.Context, s *Store, r *http.Request) (*Person, error) {
	p, err := personFromRequest(ctx, s, r)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, apiErr(http.StatusUnauthorized, "unauthenticated", "Sign in first.")
	}
	return p, nil
}

func requireOfficeManager(p *Person) error {
	if p.Role != "office_manager" {
		return apiErr(http.StatusForbidden, "forbidden", "Only the office manager may do that.")
	}
	return nil
}

func setSessionCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     "wren_session",
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     "wren_session",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}
