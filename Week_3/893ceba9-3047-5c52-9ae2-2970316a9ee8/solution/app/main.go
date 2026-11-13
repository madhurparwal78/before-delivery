package main

import (
	"bytes"
	"context"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

// App holds the services every handler uses.
type App struct {
	cfg      Config
	pool     *pgxpool.Pool
	s3       *S3
	svix     *Svix
	git      *Upstream
	ai       *Upstream
	probe    probe
	instance string
	ready    atomic.Bool
	wake     chan struct{}
	dist     fs.FS
	// decoyHash is compared against when an email is unknown, so timing doesn't reveal which emails exist.
	decoyHash []byte
}

func main() {
	cfg := loadConfig()
	a := &App{cfg: cfg, s3: newS3(cfg), svix: newSvix(cfg), git: newUpstream(cfg.GitHostURL), ai: newUpstream(cfg.AIEngineURL),
		instance: newID(), wake: make(chan struct{}, 1), dist: os.DirFS("web/dist")}
	var err error
	if a.decoyHash, err = bcrypt.GenerateFromPassword([]byte("decoy"), bcrypt.DefaultCost); err != nil {
		log.Fatalf("prepare sign-in: %v", err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go a.boot(ctx)
	srv := &http.Server{Addr: "0.0.0.0:" + cfg.Port, Handler: a.routes(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdown); err != nil {
			log.Printf("shutdown: %v", err)
		}
	}()
	log.Printf("Interline Desk listening on port %s", cfg.Port)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("serve: %v", err)
	}
}

// boot connects to Postgres, applies the schema and seed, and only then starts the background loops.
// The server answers pages and `starting` health meanwhile, and keeps trying every 2 seconds.
func (a *App) boot(ctx context.Context) {
	if err := a.connect(ctx); err != nil {
		log.Fatalf("boot: the database settings are not usable")
	}
	defer a.pool.Close()
	for ctx.Err() == nil {
		attempt, cancel := context.WithTimeout(ctx, 30*time.Second)
		err := a.migrate(attempt)
		cancel()
		if err == nil {
			break
		}
		log.Printf("boot: waiting for the database to accept the schema")
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}
	if ctx.Err() != nil {
		return
	}
	a.ready.Store(true)
	go a.deliveryLoop(ctx)
	go a.janitor(ctx)
	<-ctx.Done()
}

func (a *App) handleHealth(w http.ResponseWriter, r *http.Request) {
	if !a.ready.Load() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "starting"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *App) whenReady(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !a.ready.Load() && strings.HasPrefix(r.URL.Path, "/api/") && r.URL.Path != "/api/health" {
			writeError(w, newErr(http.StatusServiceUnavailable, "starting", "The desk is starting. Try again in a moment."))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *App) routes() http.Handler {
	mux := http.NewServeMux()
	api := func(pattern string, fn func(w http.ResponseWriter, r *http.Request) error) {
		mux.HandleFunc(pattern, handler(fn))
	}
	mux.HandleFunc("GET /api/health", a.handleHealth)
	api("POST /api/session", a.handleSignIn)
	api("DELETE /api/session", a.handleSignOut)
	api("GET /api/me", a.handleMe)
	api("GET /api/integrations", a.handleIntegrations)
	api("GET /api/workspace/stats", a.handleStats)
	api("GET /api/audit", a.handleAudit)
	api("GET /api/audit.csv", a.handleAuditCSV)

	api("GET /api/projects", a.handleProjects)
	api("POST /api/projects", a.handleCreateProject)
	api("GET /api/projects/{slug}", a.handleGetProject)
	api("PATCH /api/projects/{slug}", a.handlePatchProject)
	api("DELETE /api/projects/{slug}", a.handleEraseProject)

	api("GET /api/projects/{slug}/branches", a.handleBranches)
	api("POST /api/projects/{slug}/branches", a.handleCreateBranch)
	api("POST /api/projects/{slug}/branches/{branch}/transitions", a.handleTransition)
	api("GET /api/projects/{slug}/branches/{branch}/keys", a.handleKeys)
	api("POST /api/projects/{slug}/branches/{branch}/keys", a.handleCreateKey)
	api("PATCH /api/projects/{slug}/branches/{branch}/keys/{key_id}", a.handlePatchKey)
	api("DELETE /api/projects/{slug}/branches/{branch}/keys/{key_id}", a.handleDeleteKey)
	api("GET /api/projects/{slug}/keys/{key_id}/history", a.handleKeyHistory)

	api("GET /api/segments/{id}", a.handleGetSegment)
	api("PUT /api/segments/{id}/value", a.handlePutValue)
	api("POST /api/segments/{id}/score", a.handleScore)
	api("POST /api/segments/{id}/issues", a.handleAddIssue)
	api("POST /api/segments/{id}/approve", a.handleApprove)
	api("POST /api/segments/{id}/correct", a.handleCorrect)
	api("POST /api/segments/{id}/comments", a.handleComment)
	api("POST /api/projects/{slug}/branches/{branch}/drafts", a.handleDraft)
	api("POST /api/projects/{slug}/tm/match", a.handleTMMatch)

	api("GET /api/projects/{slug}/branches/{branch}/merge-preview", a.handlePreview)
	api("POST /api/projects/{slug}/branches/{branch}/conflicts/{conflict_id}/hold", a.handleHold)
	api("PUT /api/projects/{slug}/branches/{branch}/conflicts/{conflict_id}", a.handleResolve)
	api("POST /api/projects/{slug}/branches/{branch}/merge", a.handleMerge)
	api("GET /api/projects/{slug}/operations", a.handleOperations)
	api("POST /api/projects/{slug}/operations/{op_id}/restore", a.handleRestore)

	api("GET /api/projects/{slug}/tm", a.handleTMList)
	api("POST /api/projects/{slug}/tm/imports", a.handleTMImport)
	api("GET /api/projects/{slug}/tm/imports", a.handleTMImports)
	api("GET /api/projects/{slug}/tm/imports/{import_id}/original", a.handleTMOriginal)
	api("POST /api/projects/{slug}/branches/{branch}/source-files", a.handleSourceUpload)
	api("GET /api/projects/{slug}/source-files", a.handleSourceFiles)
	api("GET /api/projects/{slug}/source-files/{file_id}/original", a.handleSourceOriginal)

	api("GET /api/projects/{slug}/reviewers", a.handleReviewers)
	api("POST /api/projects/{slug}/reviewers", a.handleInvite)
	api("DELETE /api/projects/{slug}/reviewers/{id}", a.handleRemoveReviewer)
	api("POST /api/projects/{slug}/assignments", a.handleAssign)
	api("GET /api/projects/{slug}/assignments", a.handleAssignments)
	api("GET /api/review-queue", a.handleReviewQueue)

	api("POST /api/projects/{slug}/publishes", a.handleCreatePublish)
	api("GET /api/projects/{slug}/publishes", a.handlePublishes)
	api("GET /api/projects/{slug}/publishes/{id}", a.handlePublish)
	api("GET /api/projects/{slug}/tokens", a.handleTokens)
	api("POST /api/projects/{slug}/tokens", a.handleCreateToken)
	api("DELETE /api/projects/{slug}/tokens/{id}", a.handleRevokeToken)
	api("GET /api/ci/projects/{slug}/locales/{file}", a.handleLocalePull)
	api("PUT /api/projects/{slug}/webhook", a.handlePutWebhook)
	api("GET /api/projects/{slug}/webhook", a.handleGetWebhook)
	api("GET /api/projects/{slug}/events", a.handleEvents)

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || (r.Method != http.MethodGet && r.Method != http.MethodHead) {
			writeError(w, errNotFound())
			return
		}
		a.handlePage(w, r)
	})
	return securityHeaders(a.whenReady(withDeadline(limitBody(mux))))
}

// projectPages are the project sub-pages the app serves.
var projectPages = map[string]bool{"editor": true, "tm": true, "merge": true, "settings": true}

// handlePage serves the single-page app: known routes with 200, an erased or out-of-scope project and
// every unknown path with 404, and built assets from web/dist.
func (a *App) handlePage(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Path
	if strings.HasPrefix(p, "/assets/") {
		a.serveAsset(w, r, strings.TrimPrefix(p, "/"))
		return
	}
	status := http.StatusNotFound
	switch parts := strings.Split(strings.Trim(p, "/"), "/"); {
	case p == "/" || p == "/sign-in" || p == "/desk" || p == "/audit" || p == "/review":
		status = http.StatusOK
	case parts[0] == "projects" && len(parts) >= 2 && len(parts) <= 3 && (len(parts) == 2 || projectPages[parts[2]]):
		status = http.StatusOK
		if a.ready.Load() {
			if pr, err := a.authn(r); err == nil {
				if _, err := a.scopedProject(r, pr, parts[1]); err != nil {
					status = http.StatusNotFound
				}
			}
		}
	}
	index, err := fs.ReadFile(a.dist, "index.html")
	if err != nil {
		http.Error(w, "the app is not built", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if r.Method != http.MethodHead {
		writeBody(w, index)
	}
}

func (a *App) serveAsset(w http.ResponseWriter, r *http.Request, name string) {
	name = path.Clean(name)
	if strings.HasSuffix(name, ".map") || strings.Contains(name, "..") {
		http.NotFound(w, r)
		return
	}
	data, err := fs.ReadFile(a.dist, name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
}
