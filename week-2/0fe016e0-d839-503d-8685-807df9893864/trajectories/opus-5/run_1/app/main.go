package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"sync/atomic"
	"time"
)

type app struct {
	store *store
	ready atomic.Bool
}

func main() {
	log.SetFlags(0)
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL is not set")
	}
	port := os.Getenv("APP_PUBLIC_PORT")
	if port == "" {
		port = "4173"
	}

	application := &app{}
	go application.connect(context.Background(), databaseURL)

	server := &http.Server{
		Addr:              "0.0.0.0:" + port,
		Handler:           application.routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("rungmark listening on %s", server.Addr)
	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("server stopped: %v", err)
	}
}

// connect keeps retrying until the database is reachable, the schema exists and
// the seed is in place.
func (a *app) connect(ctx context.Context, databaseURL string) {
	for {
		if a.store == nil {
			opened, err := openStore(ctx, databaseURL)
			if err == nil {
				a.store = opened
			}
		}
		if a.store != nil {
			prepareCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
			err := a.store.prepare(prepareCtx)
			cancel()
			if err == nil {
				a.ready.Store(true)
				return
			}
			log.Printf("waiting for the rollout store: %v", classify(err))
		}
		time.Sleep(time.Second)
	}
}

func classify(err error) string {
	if unavailable(err) {
		return "unavailable"
	}
	return "schema not ready"
}

func (a *app) routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", a.handleHealth)

	mux.HandleFunc("GET /api/capability_flag", a.handleFlagList)
	mux.HandleFunc("GET /api/capability_flag/summary", a.handleSummary("capability_flag"))
	mux.HandleFunc("GET /api/capability_flag/{flag_code}", a.handleFlagDetail)
	mux.HandleFunc("PATCH /api/capability_flag/{flag_code}", a.handleFlagPatch)

	mux.HandleFunc("GET /api/cohort", a.handleCohortList)
	mux.HandleFunc("GET /api/cohort/summary", a.handleSummary("cohort"))
	mux.HandleFunc("PATCH /api/cohort/{cohort_code}", a.handleCohortPatch)

	mux.HandleFunc("GET /api/device", a.handleDeviceList)
	mux.HandleFunc("GET /api/device/summary", a.handleSummary("device"))

	mux.HandleFunc("GET /api/promotion", a.handlePromotionList)
	mux.HandleFunc("GET /api/promotion/summary", a.handleSummary("promotion"))
	mux.HandleFunc("POST /api/promotion", a.handlePromote)
	mux.HandleFunc("POST /api/promotion/force-enable", a.handleForceEnable)
	mux.HandleFunc("POST /api/promotion/rollback", a.handleRollback)

	mux.HandleFunc("GET /api/adverse_event", a.handleAdverseEventList)
	mux.HandleFunc("GET /api/adverse_event/summary", a.handleSummary("adverse_event"))
	mux.HandleFunc("POST /api/adverse_event", a.handleAdverseEventCreate)

	mux.HandleFunc("GET /api/evidence_pack", a.handleEvidencePackList)
	mux.HandleFunc("GET /api/evidence_pack/summary", a.handleSummary("evidence_pack"))

	for _, deliverable := range deliverables {
		mux.HandleFunc("POST /api/"+deliverable.rule+"/render", a.handleRender(deliverable))
		mux.HandleFunc("GET /api/"+deliverable.rule+"/latest", a.handleLatest(deliverable))
	}

	for _, journey := range journeyCodes {
		mux.HandleFunc("GET /api/"+journey+"/events", a.handleJourneyEvents(journey))
	}

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeFailure(w, failure(http.StatusNotFound, "not found"))
	})

	mux.HandleFunc("GET /{$}", a.handleHome)
	mux.HandleFunc("GET /console", a.handleConsole)
	for _, page := range readerPages {
		mux.HandleFunc("GET /"+page.path, a.handleReaderPage(page))
	}
	mux.Handle("GET /static/", http.StripPrefix("/static/", http.FileServer(http.FS(staticFiles))))

	return mux
}

func (a *app) handleHealth(w http.ResponseWriter, r *http.Request) {
	if !a.ready.Load() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"status": "unavailable"})
		return
	}
	ctx, cancel := withTimeout(r.Context())
	defer cancel()
	if err := a.store.ping(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"status": "unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
}

// snapshotNow reads one consistent view of live state for a read route.
func (a *app) snapshotNow(ctx context.Context) (*snapshot, error) {
	if !a.ready.Load() {
		return nil, errDatabaseUnavailable
	}
	state, err := readSnapshot(ctx, a.store.pool, nowMinutes())
	if err != nil {
		return nil, errDatabaseUnavailable
	}
	return state, nil
}
