package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"
	"time"

	_ "github.com/lib/pq"
)

const (
	jsonLimit   = 1000000
	importLimit = 5000000
	writeLock   = 4242
	cookieName  = "wren_session"
)

// Server holds everything a handler needs.
type Server struct {
	cfg   Config
	clock *Clock
	db    *sql.DB
	ready atomic.Bool
	hub   *Hub
	files *ObjectStore
	mux   *http.ServeMux
}

// APIError is the one published error shape.
type APIError struct {
	Status  int
	Code    string
	Message string
	Fields  map[string]string
	Current any
}

func (e *APIError) Error() string { return e.Message }

func apiErr(status int, code, message string) *APIError {
	return &APIError{Status: status, Code: code, Message: message}
}

func fieldErrors(fields map[string]string) *APIError {
	return &APIError{Status: 422, Code: "validation_failed", Message: "Check the highlighted fields and try again.", Fields: fields}
}

func fieldErr(field, message string) *APIError { return fieldErrors(map[string]string{field: message}) }

var (
	errUnauthenticated = apiErr(401, "unauthenticated", "Sign in to continue.")
	errNotFound        = apiErr(404, "not_found", "That could not be found.")
	errForbidden       = apiErr(403, "forbidden", "You do not have access to do that.")
)

// Req is one request in flight.
type Req struct {
	S     *Server
	W     http.ResponseWriter
	R     *http.Request
	Me    *Person
	raw   []byte
	world *World
}

func (rq *Req) ctx() context.Context { return rq.R.Context() }

func (rq *Req) World() (*World, error) {
	if rq.world == nil {
		w, err := loadWorld(rq.ctx(), rq.S.db, rq.S.clock.Now())
		if err != nil {
			return nil, err
		}
		rq.world = w
		if rq.Me != nil {
			rq.Me = w.People[rq.Me.ID]
		}
	}
	return rq.world, nil
}

func (rq *Req) decode(into any) error {
	if len(bytes.TrimSpace(rq.raw)) == 0 {
		return apiErr(400, "invalid_json", "Send a JSON body.")
	}
	if err := json.Unmarshal(rq.raw, into); err != nil {
		return apiErr(400, "invalid_json", "The request body is not valid JSON for this endpoint.")
	}
	return nil
}

// fields decodes the body into a map so a handler can tell which fields were sent.
func (rq *Req) fields() (map[string]json.RawMessage, error) {
	var m map[string]json.RawMessage
	if err := rq.decode(&m); err != nil {
		return nil, err
	}
	if m == nil {
		return nil, apiErr(400, "invalid_json", "Send a JSON object.")
	}
	return m, nil
}

func (rq *Req) json(status int, v any) error {
	rq.W.Header().Set("Content-Type", "application/json")
	rq.W.WriteHeader(status)
	return json.NewEncoder(rq.W).Encode(v)
}

func (rq *Req) noContent() error {
	rq.W.WriteHeader(http.StatusNoContent)
	return nil
}

type handlerFunc func(rq *Req) error

// route registers an /api endpoint with the published order of checks.
func (s *Server) route(pattern string, public bool, fn handlerFunc) {
	s.mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
		rq := &Req{S: s, W: w, R: r}
		if err := s.guard(rq, public); err == nil {
			// A NUL byte in a path value can never name a record, and Postgres refuses it in text.
			if strings.ContainsRune(r.URL.Path, 0) {
				if strings.HasPrefix(r.URL.Path, "/api/share/") {
					s.finish(rq, apiErr(404, "not_found", "This link no longer works."))
				} else {
					s.finish(rq, errNotFound)
				}
				return
			}
			err = fn(rq)
			s.finish(rq, err)
		} else {
			s.finish(rq, err)
		}
	})
}

func (s *Server) finish(rq *Req, err error) {
	if err == nil {
		return
	}
	var ae *APIError
	if !errors.As(err, &ae) {
		log.Printf("%s %s: %v", rq.R.Method, rq.R.URL.Path, err)
		ae = apiErr(500, "internal_error", "Something went wrong on our side. Try again shortly.")
	}
	body := map[string]any{"error": ae.Code, "message": ae.Message}
	if ae.Fields != nil {
		body["fields"] = ae.Fields
	}
	if ae.Current != nil {
		body["current"] = ae.Current
	}
	rq.W.Header().Set("Content-Type", "application/json")
	rq.W.WriteHeader(ae.Status)
	json.NewEncoder(rq.W).Encode(body)
}

// guard runs the order of checks that precedes every handler: size and type, origin, then sign-in.
func (s *Server) guard(rq *Req, public bool) error {
	r := rq.R
	if !s.ready.Load() {
		return apiErr(503, "starting", "The service is starting. Try again shortly.")
	}
	limit := int64(jsonLimit)
	isImport := strings.HasSuffix(r.URL.Path, "/imports")
	if isImport {
		limit = importLimit
	}
	if r.ContentLength > limit {
		return apiErr(413, "payload_too_large", "That request is too large.")
	}
	if r.ContentLength != 0 {
		raw, err := io.ReadAll(http.MaxBytesReader(rq.W, r.Body, limit))
		if err != nil {
			return apiErr(413, "payload_too_large", "That request is too large.")
		}
		rq.raw = raw
		if len(raw) > 0 {
			media, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
			want := "application/json"
			if isImport {
				want = "text/calendar"
			}
			if media != want {
				return apiErr(415, "unsupported_media_type", "Send "+want+".")
			}
		}
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		if origin := r.Header.Get("Origin"); origin != "" {
			if u, err := url.Parse(origin); err != nil || u.Host != r.Host {
				return apiErr(403, "cross_origin", "Requests from other origins are not accepted.")
			}
		}
	}
	if public {
		return nil
	}
	me, err := s.sessionPerson(r)
	if err != nil {
		return err
	}
	rq.Me = me
	return nil
}

func (s *Server) sessionPerson(r *http.Request) (*Person, error) {
	c, err := r.Cookie(cookieName)
	if err != nil || c.Value == "" {
		return nil, errUnauthenticated
	}
	p := &Person{}
	err = s.db.QueryRowContext(r.Context(), `SELECT p.id, p.name, p.email, p.zone, p.role, p.week_start, p.hide_weekends, p.custom_days, p.second_zone
		FROM sessions s JOIN people p ON p.id = s.person_id WHERE s.token = $1`, c.Value).
		Scan(&p.ID, &p.Name, &p.Email, &p.Zone, &p.Role, &p.WeekStart, &p.HideWeekends, &p.CustomDays, &p.SecondZone)
	if err == sql.ErrNoRows {
		return nil, errUnauthenticated
	}
	return p, err
}

// tx runs fn as one serialised write transaction and wakes the live feed once it commits.
func (s *Server) tx(ctx context.Context, fn func(tx *sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock($1)`, writeLock); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.hub.wake()
	return nil
}

func newID(prefix string) string {
	b := make([]byte, 8)
	rand.Read(b)
	return prefix + hex.EncodeToString(b)
}

func newToken() string {
	b := make([]byte, 24)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func run(ctx context.Context, cfg Config) error {
	s := &Server{cfg: cfg, clock: newClock(cfg), mux: http.NewServeMux()}
	s.hub = newHub(s)
	s.files = newObjectStore(cfg)
	s.registerRoutes()
	go s.connectLoop(ctx)
	srv := &http.Server{Addr: "0.0.0.0:" + cfg.Port, Handler: s.mux}
	go func() {
		<-ctx.Done()
		srv.Shutdown(context.Background())
	}()
	err := srv.ListenAndServe()
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

// connectLoop keeps trying Postgres once a second, then applies the schema and seed and starts the workers.
func (s *Server) connectLoop(ctx context.Context) {
	for ctx.Err() == nil {
		if err := s.openAndMigrate(ctx); err != nil {
			log.Printf("waiting for postgres: %v", err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Second):
			}
			continue
		}
		s.ready.Store(true)
		go s.hub.poll(ctx)
		go s.reminderLoop(ctx)
		go s.purgeLoop(ctx)
		log.Printf("ready on :%s", s.cfg.Port)
		return
	}
}

func (s *Server) openAndMigrate(ctx context.Context) error {
	db, err := sql.Open("postgres", withPlainTransport(s.cfg.DatabaseURL))
	if err != nil {
		return err
	}
	pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		db.Close()
		return err
	}
	db.SetMaxOpenConns(12)
	conn, err := db.Conn(ctx)
	if err != nil {
		db.Close()
		return err
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, `SELECT pg_advisory_lock($1)`, writeLock+1); err != nil {
		db.Close()
		return err
	}
	defer conn.ExecContext(context.Background(), `SELECT pg_advisory_unlock($1)`, writeLock+1)
	if _, err := conn.ExecContext(ctx, schemaSQL); err != nil {
		db.Close()
		return err
	}
	s.db = db
	if err := s.seed(ctx, conn); err != nil {
		db.Close()
		s.db = nil
		return err
	}
	return nil
}

// withPlainTransport asks for a plain connection unless the address names an ssl mode, as the services are on a private network.
func withPlainTransport(address string) string {
	if strings.Contains(address, "sslmode=") {
		return address
	}
	if strings.Contains(address, "?") {
		return address + "&sslmode=disable"
	}
	return address + "?sslmode=disable"
}
