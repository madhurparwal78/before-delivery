package main

import (
	"context"
	"database/sql"
	"io"
	"net"
	"net/http"
	"os"
	"path"
	"strings"
	"time"
)

type Server struct {
	cfg     Config
	db      *sql.DB
	store   *Store
	storage *Storage
	git     *GitHost
	ai      *AIEngine
	svix    *SvixService
	healthy func() bool
}

func NewServer(cfg Config, db *sql.DB) *Server {
	st := NewStore(db)
	return &Server{
		cfg:     cfg,
		db:      db,
		store:   st,
		storage: NewStorage(cfg),
		git:     NewGitHost(cfg),
		ai:      NewAIEngine(cfg),
		svix:    NewSvix(cfg),
	}
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()

	// platform
	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("POST /api/session", s.expectJSON(s.handleSignIn, 0))
	mux.HandleFunc("DELETE /api/session", s.handleSignOut)
	mux.HandleFunc("GET /api/me", s.handleMe)
	mux.HandleFunc("GET /api/integrations", s.handleIntegrations)
	mux.HandleFunc("GET /api/workspace/stats", s.ownerOnly(s.handleWorkspaceStats))
	mux.HandleFunc("GET /api/audit", s.ownerOnly(s.handleAuditList))
	mux.HandleFunc("GET /api/audit.csv", s.ownerOnly(s.handleAuditCSV))

	// projects
	mux.HandleFunc("GET /api/projects", s.sessionScope(s.handleProjectsList))
	mux.HandleFunc("POST /api/projects", s.ownerOnly(s.expectJSON(s.handleProjectCreate, MaxJSONBody)))
	mux.HandleFunc("GET /api/projects/{slug}", s.sessionScope(s.handleProjectGet))
	mux.HandleFunc("PATCH /api/projects/{slug}", s.ownerOnly(s.expectJSON(s.handleProjectPatch, MaxJSONBody)))
	mux.HandleFunc("DELETE /api/projects/{slug}", s.ownerOnly(s.expectJSON(s.handleProjectDelete, MaxJSONBody)))

	// branches
	mux.HandleFunc("GET /api/projects/{slug}/branches", s.ownerOnly(s.handleBranchesList))
	mux.HandleFunc("POST /api/projects/{slug}/branches", s.ownerOnly(s.expectJSON(s.handleBranchCreate, MaxJSONBody)))
	mux.HandleFunc("POST /api/projects/{slug}/branches/{branch}/transitions", s.ownerOnly(s.expectJSON(s.handleBranchTransition, MaxJSONBody)))
	mux.HandleFunc("GET /api/projects/{slug}/branches/{branch}/keys", s.ownerOnly(s.handleKeysList))
	mux.HandleFunc("POST /api/projects/{slug}/branches/{branch}/keys", s.ownerOnly(s.expectJSON(s.handleKeyCreate, MaxJSONBody)))
	mux.HandleFunc("PATCH /api/projects/{slug}/branches/{branch}/keys/{key_id}", s.ownerOnly(s.expectJSON(s.handleKeyPatch, MaxJSONBody)))
	mux.HandleFunc("DELETE /api/projects/{slug}/branches/{branch}/keys/{key_id}", s.ownerOnly(s.handleKeyDelete))
	mux.HandleFunc("GET /api/projects/{slug}/keys/{key_id}/history", s.ownerOnly(s.handleKeyHistory))
	mux.HandleFunc("GET /api/projects/{slug}/branches/{branch}/merge-preview", s.ownerOnly(s.handleMergePreview))
	mux.HandleFunc("POST /api/projects/{slug}/branches/{branch}/merge", s.ownerOnly(s.expectJSON(s.handleMerge, MaxJSONBody)))

	// conflicts, holds, merge preview pieces
	mux.HandleFunc("POST /api/projects/{slug}/branches/{branch}/conflicts/{conflict_id}/hold", s.ownerOnly(s.expectJSON(s.handleConflictHold, MaxJSONBody)))
	mux.HandleFunc("PUT /api/projects/{slug}/branches/{branch}/conflicts/{conflict_id}", s.ownerOnly(s.expectJSON(s.handleConflictResolve, MaxJSONBody)))

	// segments
	mux.HandleFunc("GET /api/segments/{id}", s.sessionScope(s.handleSegmentGet))
	mux.HandleFunc("PUT /api/segments/{id}/value", s.ownerOnly(s.expectJSON(s.handleSegmentValue, MaxJSONBody)))
	mux.HandleFunc("POST /api/segments/{id}/score", s.ownerOnly(s.expectJSON(s.handleSegmentScore, MaxJSONBody)))
	mux.HandleFunc("POST /api/segments/{id}/issues", s.ownerOnly(s.expectJSON(s.handleSegmentIssue, MaxJSONBody)))
	mux.HandleFunc("POST /api/segments/{id}/approve", s.sessionScope(s.expectJSON(s.handleSegmentApprove, MaxJSONBody)))
	mux.HandleFunc("POST /api/segments/{id}/correct", s.sessionScope(s.expectJSON(s.handleSegmentCorrect, MaxJSONBody)))
	mux.HandleFunc("POST /api/segments/{id}/comments", s.sessionScope(s.expectJSON(s.handleSegmentComment, MaxJSONBody)))
	mux.HandleFunc("POST /api/projects/{slug}/branches/{branch}/drafts", s.ownerOnly(s.expectJSON(s.handleDrafts, MaxJSONBody)))

	// TM
	mux.HandleFunc("GET /api/projects/{slug}/tm", s.ownerOnly(s.handleTmList))
	mux.HandleFunc("POST /api/projects/{slug}/tm/imports", s.ownerOnly(s.handleTmImport))
	mux.HandleFunc("GET /api/projects/{slug}/tm/imports", s.ownerOnly(s.handleTmImportsList))
	mux.HandleFunc("GET /api/projects/{slug}/tm/imports/{import_id}/original", s.ownerOnly(s.handleTmOriginal))
	mux.HandleFunc("GET /api/projects/{slug}/tm/imports/{import_id}/report", s.ownerOnly(s.handleTmImportReport))
	mux.HandleFunc("POST /api/projects/{slug}/tm/match", s.ownerOnly(s.expectJSON(s.handleTmMatch, MaxJSONBody)))

	// source files
	mux.HandleFunc("POST /api/projects/{slug}/branches/{branch}/source-files", s.ownerOnly(s.handleSourceUpload))
	mux.HandleFunc("GET /api/projects/{slug}/source-files", s.ownerOnly(s.handleSourceFilesList))
	mux.HandleFunc("GET /api/projects/{slug}/source-files/{file_id}/original", s.ownerOnly(s.handleSourceOriginal))

	// review
	mux.HandleFunc("GET /api/projects/{slug}/reviewers", s.ownerOnly(s.handleReviewersList))
	mux.HandleFunc("POST /api/projects/{slug}/reviewers", s.ownerOnly(s.expectJSON(s.handleReviewerInvite, MaxJSONBody)))
	mux.HandleFunc("DELETE /api/projects/{slug}/reviewers/{id}", s.ownerOnly(s.handleReviewerRemove))
	mux.HandleFunc("POST /api/projects/{slug}/assignments", s.ownerOnly(s.expectJSON(s.handleAssignmentCreate, MaxJSONBody)))
	mux.HandleFunc("GET /api/projects/{slug}/assignments", s.ownerOnly(s.handleAssignmentsList))
	mux.HandleFunc("GET /api/review-queue", s.sessionScope(s.handleReviewQueue))

	// operations
	mux.HandleFunc("GET /api/projects/{slug}/operations", s.ownerOnly(s.handleOperationsList))
	mux.HandleFunc("POST /api/projects/{slug}/operations/{op_id}/restore", s.ownerOnly(s.expectJSON(s.handleOperationRestore, MaxJSONBody)))

	// publishes, tokens, CI, webhooks
	mux.HandleFunc("POST /api/projects/{slug}/publishes", s.ownerOnly(s.expectJSON(s.handlePublishCreate, MaxJSONBody)))
	mux.HandleFunc("GET /api/projects/{slug}/publishes", s.ownerOnly(s.handlePublishesList))
	mux.HandleFunc("GET /api/projects/{slug}/publishes/{id}", s.ownerOnly(s.handlePublishGet))
	mux.HandleFunc("GET /api/projects/{slug}/tokens", s.ownerOnly(s.handleTokensList))
	mux.HandleFunc("POST /api/projects/{slug}/tokens", s.ownerOnly(s.expectJSON(s.handleTokenCreate, MaxJSONBody)))
	mux.HandleFunc("DELETE /api/projects/{slug}/tokens/{id}", s.ownerOnly(s.handleTokenDelete))
	mux.HandleFunc("GET /api/ci/projects/{slug}/locales/{file}", s.handleCILocale)
	mux.HandleFunc("PUT /api/projects/{slug}/webhook", s.ownerOnly(s.expectJSON(s.handleWebhookSave, MaxJSONBody)))
	mux.HandleFunc("GET /api/projects/{slug}/webhook", s.ownerOnly(s.handleWebhookGet))
	mux.HandleFunc("GET /api/projects/{slug}/events", s.ownerOnly(s.handleEventsList))

	// unknown API paths
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		notFoundError(w)
	})

	mux.HandleFunc("/", s.handleStatic)

	return s.securityHeaders(mux)
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "same-origin")
		next.ServeHTTP(w, r)
	})
}

// ---- middleware wrappers ----

type handlerFunc func(w http.ResponseWriter, r *http.Request) (status int, err error)

func (s *Server) ownerOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, err := currentUser(r, s.db)
		if err != nil {
			unauthenticated(w)
			return
		}
		if u.Role != "owner" {
			forbidden(w)
			return
		}
		next(w, r.WithContext(withUser(r.Context(), u)))
	}
}

type ctxKey int

const userKey ctxKey = 1

func withUser(ctx context.Context, u *SessionUser) context.Context {
	return context.WithValue(ctx, userKey, u)
}

func userFrom(ctx context.Context) *SessionUser {
	u, _ := ctx.Value(userKey).(*SessionUser)
	return u
}

func (s *Server) sessionScope(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, err := currentUser(r, s.db)
		if err != nil {
			unauthenticated(w)
			return
		}
		next(w, r.WithContext(withUser(r.Context(), u)))
	}
}

// expectJSON enforces the body limit and JSON content type for JSON endpoints.
func (s *Server) expectJSON(next http.HandlerFunc, limit int64) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if limit > 0 {
			if r.ContentLength > limit {
				payloadTooLarge(w)
				return
			}
			ct := r.Header.Get("Content-Type")
			if ct == "" || !strings.HasPrefix(ct, "application/json") {
				unsupportedMedia(w)
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, limit+1)
		}
		next(w, r)
	}
}

// ---- static assets ----

func (s *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Path
	// never serve sources or dot-directories
	if strings.Contains(p, "..") || path.Ext(p) == ".go" || path.Ext(p) == ".ts" || strings.Contains(p, "/.") || p == "/run.json" {
		s.serveNotFound(w)
		return
	}
	assets := map[string]string{
		"/":           "index.html",
		"/main.js":    "main.js",
		"/styles.css": "styles.css",
		"/fonts.css":  "fonts.css",
		"/index.html": "index.html",
	}
	if p == "/favicon.ico" {
		w.Header().Set("Content-Type", "image/svg+xml")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, faviconSVG)
		return
	}
	if name, ok := assets[p]; ok {
		s.serveAsset(w, r, name)
		return
	}
	if strings.HasPrefix(p, "/fonts/") {
		s.serveAsset(w, r, "fonts/"+path.Base(p))
		return
	}
	// known page routes serve the SPA shell
	switch p {
	case "/sign-in", "/desk", "/review", "/audit":
		s.serveAsset(w, r, "index.html")
		return
	}
	if strings.HasPrefix(p, "/projects/") {
		// an unknown or out-of-scope project URL serves the not-found screen
		// with status 404
		if !s.projectURLInScope(r) {
			s.serveNotFound(w)
			return
		}
		s.serveAsset(w, r, "index.html")
		return
	}
	s.serveNotFound(w)
}

// projectURLInScope reports whether the project page path names a project the
// caller can see. Signed-out visitors can see any existing project's shell
// because the page itself redirects to sign-in.
func (s *Server) projectURLInScope(r *http.Request) bool {
	parts := strings.SplitN(strings.TrimPrefix(r.URL.Path, "/projects/"), "/", 2)
	slug := parts[0]
	if slug == "" {
		return false
	}
	p, err := s.store.ProjectBySlug(r.Context(), slug)
	if err != nil || p == nil {
		return false
	}
	u, err := currentUser(r, s.db)
	if err != nil {
		// signed out: the shell is served and the app redirects to sign-in
		return true
	}
	if u.Role == "owner" {
		return true
	}
	ok, err := reviewerCanSeeProject(r.Context(), s.db, u.ID, p.ID)
	return err == nil && ok
}

const faviconSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="1" y="1" width="30" height="30" rx="9" fill="#10151f"/><path d="M10 22V10l6 7 6-7v12" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`

var contentTypeByExt = map[string]string{
	".html":  "text/html; charset=utf-8",
	".js":    "text/javascript; charset=utf-8",
	".css":   "text/css; charset=utf-8",
	".woff2": "font/woff2",
	".json":  "application/json; charset=utf-8",
}

func (s *Server) serveAsset(w http.ResponseWriter, r *http.Request, name string) {
	full := path.Join(webDir, name)
	data, err := os.ReadFile(full)
	if err != nil {
		s.serveNotFound(w)
		return
	}
	ext := path.Ext(name)
	ct := contentTypeByExt[ext]
	if ct == "" {
		ct = "application/octet-stream"
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "no-store")
	if strings.HasPrefix(pOrS(name), "index") {
		w.Header().Set("Cache-Control", "no-store")
	}
	_ = r
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func pOrS(s string) string { return s }

func (s *Server) serveNotFound(w http.ResponseWriter) {
	data, err := os.ReadFile(path.Join(webDir, "index.html"))
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusNotFound)
	_, _ = w.Write(data)
}

var webDir = findWebDir()

func findWebDir() string {
	for _, p := range []string{"web/dist/public", "/app/web/dist/public", "./web/dist/public"} {
		if st, err := os.Stat(p); err == nil && st.IsDir() {
			return p
		}
	}
	return "web/dist/public"
}

// ListenAndServe binds 0.0.0.0 on the configured public port.
func (s *Server) ListenAndServe() error {
	srv := &http.Server{
		Addr:              net.JoinHostPort("0.0.0.0", s.cfg.PublicPort),
		Handler:           s.routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	return srv.ListenAndServe()
}
