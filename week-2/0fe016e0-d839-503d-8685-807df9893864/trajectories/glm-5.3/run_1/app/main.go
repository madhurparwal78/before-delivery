package main

import (
	"log"
	"net/http"
	"os"
	"time"
)

// routeName gives each idempotent route the identity stored under its key.
const (
	routePromote     = "POST /api/promotion"
	routeForceEnable = "POST /api/promotion/force-enable"
	routeRollback    = "POST /api/promotion/rollback"
)

func (a *app) routes() http.Handler {
	mux := &http.ServeMux{}

	mux.HandleFunc("GET /api/health", a.handleHealth)

	mux.HandleFunc("GET /api/capability_flag", a.handleFlagList)
	mux.HandleFunc("GET /api/cohort", a.handleCohortList)
	mux.HandleFunc("GET /api/device", a.handleDeviceList)
	mux.HandleFunc("GET /api/promotion", a.handlePromotionList)
	mux.HandleFunc("GET /api/adverse_event", a.handleEventList)
	mux.HandleFunc("GET /api/evidence_pack", a.handleEvidencePackList)

	for _, entity := range []string{"capability_flag", "cohort", "device", "promotion", "adverse_event", "evidence_pack"} {
		mux.HandleFunc("GET /api/"+entity+"/summary", func(w http.ResponseWriter, r *http.Request) {
			a.handleSummary(w, r, entity)
		})
	}

	mux.HandleFunc("GET /api/capability_flag/{flag_code}", a.handleFlagDetailRoute)
	mux.HandleFunc("PATCH /api/capability_flag/{flag_code}", a.handlePatchFlag)
	mux.HandleFunc("PATCH /api/cohort/{cohort_code}", a.handlePatchCohort)

	mux.HandleFunc("POST /api/promotion", func(w http.ResponseWriter, r *http.Request) {
		a.handlePromotionWrite(w, r, promotionRequest{
			route: routePromote,
			allowed: map[string]bool{
				"flag_code": true, "cohort_code": true, "attestation_reference": true,
			},
			required: []string{"flag_code", "cohort_code"},
		})
	})
	mux.HandleFunc("POST /api/promotion/force-enable", func(w http.ResponseWriter, r *http.Request) {
		a.handlePromotionWrite(w, r, promotionRequest{
			route:           routeForceEnable,
			allowed:         map[string]bool{"flag_code": true, "cohort_code": true},
			required:        []string{"flag_code", "cohort_code"},
			skipAttestation: true,
		})
	})
	mux.HandleFunc("POST /api/promotion/rollback", a.handleRollback)
	mux.HandleFunc("POST /api/adverse_event", a.handleAdverseEvent)

	for _, dp := range []string{"DP-09", "DP-10", "DP-11"} {
		mux.HandleFunc("POST /api/"+dp+"/render", func(w http.ResponseWriter, r *http.Request) {
			a.handleRender(w, r, dp)
		})
		mux.HandleFunc("GET /api/"+dp+"/latest", func(w http.ResponseWriter, r *http.Request) {
			a.handleLatest(w, r, dp)
		})
	}
	for _, journey := range []string{"WF-01", "WF-02", "WF-03", "WF-04"} {
		mux.HandleFunc("GET /api/"+journey+"/events", func(w http.ResponseWriter, r *http.Request) {
			a.handleJourneyEvents(w, r, journey)
		})
	}

	mux.HandleFunc("GET /static/", func(w http.ResponseWriter, r *http.Request) {
		name := r.URL.Path[len("/static/"):]
		if name != "console.js" && name != "styles.css" {
			writeError(w, 404, "not found")
			return
		}
		http.ServeFile(w, r, "static/"+name)
	})

	mux.HandleFunc("GET /{$}", a.handleHome)
	mux.HandleFunc("GET /capability_flag", a.readerFlagPage)
	mux.HandleFunc("GET /cohort", a.readerCohortPage)
	mux.HandleFunc("GET /device", a.readerDevicePage)
	mux.HandleFunc("GET /promotion", a.readerPromotionPage)
	mux.HandleFunc("GET /adverse_event", a.readerAdverseEventPage)
	mux.HandleFunc("GET /evidence_pack", a.readerEvidencePackPage)
	mux.HandleFunc("GET /console", a.handleConsole)

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, 404, "not found")
	})

	return mux
}

// boot connects the database, creates any missing tables, loads the seed
// exactly once and keeps retrying until the store is ready. The server
// listens before the store is ready, so health answers 503 meanwhile.
func boot(dbURL string) (*app, error) {
	db, err := openDB()
	if err != nil {
		return nil, err
	}
	a := &app{db: db, svc: &service{db: db, clock: serverClock{}}}
	return a, nil
}

func main() {
	port := os.Getenv("APP_PUBLIC_PORT")
	if port == "" {
		port = "4173"
	}
	a, err := boot(os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}

	// The store comes up in the background: health answers 503 until the
	// database is reachable, the schema exists and the seed is in place.
	go func() {
		for {
			if err := ensureSchema(a.db); err == nil {
				if err := seedOnce(a.db); err == nil {
					if ok, err := seeded(a.db); err == nil && ok {
						a.ready.Store(true)
						return
					}
				}
			}
			time.Sleep(500 * time.Millisecond)
		}
	}()

	server := &http.Server{
		Addr:              "0.0.0.0:" + port,
		Handler:           a.routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("listening on 0.0.0.0:%s", port)
	log.Fatal(server.ListenAndServe())
}
