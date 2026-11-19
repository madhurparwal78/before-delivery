// Package api serves the app and the JSON API from one origin.
package api

import (
	"encoding/json"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/cinderlatch/holdfast/internal/apierr"
	"github.com/cinderlatch/holdfast/internal/clockx"
	"github.com/cinderlatch/holdfast/internal/config"
	"github.com/cinderlatch/holdfast/internal/mailer"
	"github.com/cinderlatch/holdfast/internal/pricing"
	"github.com/cinderlatch/holdfast/internal/registry"
	"github.com/cinderlatch/holdfast/internal/sim"
	"github.com/cinderlatch/holdfast/internal/store"
)

// maxBody is the inclusive request body limit.
const maxBody = 16384

// sessionCookie is the session cookie name.
const sessionCookie = "hf_session"

// Server holds everything the handlers need.
type Server struct {
	cfg      config.Config
	clock    *clockx.Clock
	store    *store.Store
	registry *registry.Registry
	mail     *mailer.Mailer
	outbox   *mailer.Outbox
	prices   *pricing.Cache
	rooms    *sim.Manager
	zone     *time.Location
	assets   fs.FS

	// sessions caches resolved sessions so a live room keeps answering while
	// Postgres is away.
	sessionsMu sync.RWMutex
	sessions   map[string]store.Player

	handler http.Handler
}

// Deps are the services the server is built on.
type Deps struct {
	Config   config.Config
	Clock    *clockx.Clock
	Store    *store.Store
	Registry *registry.Registry
	Mail     *mailer.Mailer
	Outbox   *mailer.Outbox
	Prices   *pricing.Cache
	Rooms    *sim.Manager
	Zone     *time.Location
	Assets   fs.FS
}

// New wires the routes.
func New(deps Deps) *Server {
	s := &Server{
		cfg: deps.Config, clock: deps.Clock, store: deps.Store,
		registry: deps.Registry, mail: deps.Mail, outbox: deps.Outbox,
		prices: deps.Prices, rooms: deps.Rooms, zone: deps.Zone,
		assets: deps.Assets, sessions: map[string]store.Player{},
	}

	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("GET /api/status", s.handleStatus)
	mux.HandleFunc("GET /api/studio", s.handleStudio)
	mux.HandleFunc("GET /api/clock", s.handleGetClock)
	mux.HandleFunc("PUT /api/clock", s.handlePutClock)
	mux.HandleFunc("DELETE /api/clock", s.handleDeleteClock)

	mux.HandleFunc("POST /api/sessions", s.handleCreateSession)
	mux.HandleFunc("DELETE /api/sessions", s.handleDeleteSession)
	mux.HandleFunc("GET /api/me", s.handleMe)
	mux.HandleFunc("GET /api/me/settings", s.handleGetSettings)
	mux.HandleFunc("PUT /api/me/settings", s.handlePutSettings)

	mux.HandleFunc("POST /api/rooms", s.handleCreateRoom)
	mux.HandleFunc("GET /api/rooms/{code}", s.handleRoomState)
	mux.HandleFunc("GET /api/rooms/{code}/stream", s.handleRoomStream)
	mux.HandleFunc("POST /api/rooms/{code}/join", s.handleJoinRoom)
	mux.HandleFunc("POST /api/rooms/{code}/ready", s.handleReady)
	mux.HandleFunc("POST /api/rooms/{code}/start", s.handleStart)
	mux.HandleFunc("POST /api/rooms/{code}/end", s.handleEnd)
	mux.HandleFunc("POST /api/rooms/{code}/heartbeat", s.handleHeartbeat)
	mux.HandleFunc("POST /api/rooms/{code}/leave", s.handleLeave)
	mux.HandleFunc("POST /api/rooms/{code}/input", s.handleInput)
	mux.HandleFunc("POST /api/rooms/{code}/reports", s.handleReport)
	mux.HandleFunc("POST /api/rooms/{code}/reports/batch", s.handleReportBatch)
	mux.HandleFunc("POST /api/rooms/{code}/pose", s.handlePose)
	mux.HandleFunc("POST /api/rooms/{code}/purchases", s.handlePurchase)
	mux.HandleFunc("GET /api/rooms/{code}/ledger", s.handleLedger)

	mux.HandleFunc("GET /api/history", s.handleHistory)
	mux.HandleFunc("GET /api/laps", s.handleLaps)
	mux.HandleFunc("GET /api/maps/{id}", s.handleMap)

	mux.HandleFunc("GET /api/prices", s.handleGetPrices)
	mux.HandleFunc("POST /api/prices", s.handlePostPrice)
	mux.HandleFunc("DELETE /api/prices/{id}", s.handleDeletePrice)

	mux.HandleFunc("GET /api/nights", s.handleNights)
	mux.HandleFunc("GET /api/nights/{id}", s.handleNight)
	mux.HandleFunc("POST /api/nights/series", s.handleCreateSeries)
	mux.HandleFunc("POST /api/nights/{id}/signups", s.handleCreateSignup)
	mux.HandleFunc("GET /api/nights/{id}/signups", s.handleListSignups)

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		apierr.Write(w, apierr.NotFound())
	})
	mux.HandleFunc("/", s.handleStatic)

	s.handler = s.sameOrigin(mux)
	return s
}

// Handler reports the server's HTTP handler.
func (s *Server) Handler() http.Handler { return s.handler }

// sameOrigin refuses a state-changing request that names another origin. The
// server sends no cross-origin permission headers at all.
func (s *Server) sameOrigin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
		default:
			if origin := r.Header.Get("Origin"); origin != "" && !sameHost(origin, r) {
				apierr.Write(w, apierr.CrossOrigin())
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func sameHost(origin string, r *http.Request) bool {
	trimmed := strings.TrimSuffix(origin, "/")
	for _, scheme := range []string{"http://", "https://"} {
		if strings.EqualFold(trimmed, scheme+r.Host) {
			return true
		}
	}
	return false
}

// readBody reads a request body under the published size and content-type limits.
func readBody(r *http.Request) ([]byte, *apierr.Error) {
	if r.ContentLength > maxBody {
		return nil, apierr.BodyTooLarge()
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
	if err != nil {
		return nil, apierr.BadJSON()
	}
	if len(data) > maxBody {
		return nil, apierr.BodyTooLarge()
	}
	if len(data) > 0 && !isJSON(r.Header.Get("Content-Type")) {
		return nil, apierr.UnsupportedMediaType()
	}
	return data, nil
}

func isJSON(header string) bool {
	mediaType, _, err := mime.ParseMediaType(header)
	return err == nil && mediaType == "application/json"
}

// decode reads a JSON request body into dst.
func decode(r *http.Request, dst any) *apierr.Error {
	data, failure := readBody(r)
	if failure != nil {
		return failure
	}
	if len(data) == 0 {
		data = []byte("{}")
	}
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	if err := decoder.Decode(dst); err != nil {
		return apierr.BadJSON()
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// appRoutes are the three paths that serve the app itself.
func isAppRoute(urlPath string) bool {
	switch urlPath {
	case "/", "/nights":
		return true
	}
	return strings.HasPrefix(urlPath, "/room/") && !strings.Contains(strings.TrimPrefix(urlPath, "/room/"), "/")
}

// handleStatic serves the built frontend and the three app routes. Nothing else
// outside the build is ever served.
func (s *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	if isAppRoute(r.URL.Path) {
		s.serveIndex(w)
		return
	}
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if name == "" || strings.HasPrefix(path.Base(name), ".") {
		http.NotFound(w, r)
		return
	}
	file, err := s.assets.Open(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer func() { _ = file.Close() }()
	info, err := file.Stat()
	if err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}
	seeker, ok := file.(io.ReadSeeker)
	if !ok {
		http.NotFound(w, r)
		return
	}
	if strings.HasPrefix(name, "fonts/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	http.ServeContent(w, r, info.Name(), info.ModTime(), seeker)
}

func (s *Server) serveIndex(w http.ResponseWriter) {
	data, err := fs.ReadFile(s.assets, "index.html")
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	_, _ = w.Write(data)
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
