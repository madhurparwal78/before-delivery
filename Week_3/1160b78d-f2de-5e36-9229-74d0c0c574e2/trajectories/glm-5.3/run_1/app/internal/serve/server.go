// Package serve runs the one process: intake, workers, timers, HTTP and the
// socket. Pages are rendered here in Go.
package serve

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"sync"
	"time"

	"switchlamp/internal/cache"
	"switchlamp/internal/clock"
	"switchlamp/internal/config"
	"switchlamp/internal/domain"
	"switchlamp/internal/engine"
	"switchlamp/internal/mailer"
	"switchlamp/internal/store"
)

// Server holds every long-lived dependency of the one serve process.
type Server struct {
	cfg     *config.Config
	store   *store.Store
	clock   *clock.Clock
	cache   *cache.Cache
	engine  *engine.Engine
	mailer  *mailer.Sender
	live    *Live
	mailQ   *MailQueue
	hooks   *Webhooks
	upgrade *Upgrade
	broker  Broker

	httpClient *http.Client

	mu sync.Mutex
}

// Broker is the subset of the broker package the server needs.
type Broker interface {
	PublishConfirm(ctx context.Context, body []byte) error
	PublishDead(ctx context.Context, body []byte) error
	Up() bool
}

// Options carries the wired dependencies.
type Options struct {
	Cfg    *config.Config
	Store  *store.Store
	Clock  *clock.Clock
	Cache  *cache.Cache
	Broker Broker
}

// New wires the server together.
func New(o Options) *Server {
	s := &Server{
		cfg:        o.Cfg,
		store:      o.Store,
		clock:      o.Clock,
		cache:      o.Cache,
		broker:     o.Broker,
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
	s.engine = &engine.Engine{Store: o.Store, Clock: o.Clock}
	s.live = NewLive(o.Store, o.Clock)
	s.mailQ = NewMailQueue(o.Store, &mailer.Sender{Host: o.Cfg.SMTPHost, Port: o.Cfg.SMTPPort, From: o.Cfg.MailFrom}, o.Cache, o.Clock, o.Cfg.PublicURL)
	s.hooks = NewWebhooks(o.Store, o.Cfg, s.httpClient, o.Clock)
	s.upgrade = NewUpgrade(o.Store)
	// Engine hooks reach the serve layer without the engine knowing about it.
	s.engine.OnTimeline = func(ctx context.Context, incidentID string, e domain.TimelineEntry) {
		s.live.AnnounceTimeline(ctx, incidentID, e)
	}
	s.engine.OnIncident = func(ctx context.Context, inc *domain.Incident) {
		s.live.PublishIncident(ctx, inc)
	}
	s.engine.OnWebhook = func(ctx context.Context, inc *domain.Incident, kind string, at time.Time) {
		s.hooks.Enqueue(ctx, inc, kind, at)
	}
	return s
}

// Start runs the background workers: timers, mail, webhooks and the upgrade.
func (s *Server) Start(ctx context.Context) {
	go s.timerLoop(ctx)
	go s.mailQ.Run(ctx)
	go s.hooks.Run(ctx)
	go s.upgrade.Run(ctx)
}

func (s *Server) timerLoop(ctx context.Context) {
	tick := time.NewTicker(250 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			_ = s.engine.RunTimerPass(ctx)
		}
	}
}

// writeJSON writes one JSON answer.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// apiError writes the one published error shape.
func apiError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

// errorsBody writes the field error shape.
func errorsBody(w http.ResponseWriter, status int, fields map[string]string) {
	writeJSON(w, status, map[string]map[string]string{"errors": fields})
}

func parseUint(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}

// LoadSeq resumes the live sequence from the durable log.
func (s *Server) LoadSeq(ctx context.Context) error { return s.live.LoadSeq(ctx) }

// ConsumeEvents wires the broker's events queue to the worker.
func (s *Server) ConsumeEventsFrom(br interface {
ConsumeEvents(ctx context.Context, handle func(body []byte))
}) {
	br.ConsumeEvents(context.Background(), func(body []byte) { s.ConsumeEvents(context.Background(), body) })
}

// Handler builds the full HTTP handler: API routes, pages and static files.
func (s *Server) Handler() http.Handler {
	m := s.Routes()
	s.scheduleRoutes(m)
	s.statusRoutes(m)
	m.HandleFunc("GET /api/live", s.handleLive)
	s.keyRoutes(m)
	s.pageRoutes(m)
	m.HandleFunc("GET /ack/{token}", s.handleAckPage)
	m.HandleFunc("POST /ack/{token}", s.handleAckPost)
	return s.pageRouter(m)
}
