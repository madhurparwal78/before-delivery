// Package api serves the desk: one same-origin Go server for the JSON API and
// the built browser assets.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/marlowquill/interline-desk/internal/aiengine"
	"github.com/marlowquill/interline-desk/internal/config"
	"github.com/marlowquill/interline-desk/internal/githost"
	"github.com/marlowquill/interline-desk/internal/probe"
	"github.com/marlowquill/interline-desk/internal/s3lite"
	"github.com/marlowquill/interline-desk/internal/store"
	"github.com/marlowquill/interline-desk/internal/svixclient"
)

const (
	sessionCookie  = "desk_session"
	sessionTTL     = 12 * time.Hour
	maxJSONBody    = 1_000_000
	maxUploadFile  = 5_000_000
	maxMultipart   = 5_100_000
	publishTimeout = 30 * time.Second
)

type Server struct {
	cfg      *config.Config
	store    *store.Store
	objects  *s3lite.Client
	git      *githost.Client
	ai       *aiengine.Client
	webhooks *svixclient.Client
	prober   *probe.Prober
	assets   fs.FS
	ready    func() bool

	eventQueued chan string
}

func New(cfg *config.Config, st *store.Store, assets fs.FS, ready func() bool) *Server {
	objects := s3lite.New(cfg.S3Endpoint, cfg.S3Region, cfg.S3Bucket, cfg.S3PathStyle, cfg.S3AccessKeyID, cfg.S3SecretKey)
	git := githost.New(cfg.GitHostURL)
	ai := aiengine.New(cfg.AIEngineURL)
	hooks := svixclient.New(cfg.SvixURL, cfg.SvixAPIKey)
	return &Server{
		cfg: cfg, store: st, objects: objects, git: git, ai: ai, webhooks: hooks,
		prober: probe.New(git.Health, ai.Health, hooks.Health),
		assets: assets, ready: ready,
		eventQueued: make(chan string, 64),
	}
}

type access int

const (
	accessPublic access = iota
	accessSession
	accessOwner
	accessCI
)

// call carries what the wrapper already worked out about a request.
type call struct {
	user       *store.User
	sessionID  string
	project    *store.Project
	tokenID    string
	tokenLabel string
}

type handler func(w http.ResponseWriter, r *http.Request, c *call) *apiError

// Handler builds the one same-origin router.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", s.wrap(accessPublic, false, s.handleHealth))
	mux.HandleFunc("POST /api/session", s.wrap(accessPublic, false, s.handleSignIn))
	mux.HandleFunc("DELETE /api/session", s.wrap(accessSession, false, s.handleSignOut))
	mux.HandleFunc("GET /api/me", s.wrap(accessSession, false, s.handleMe))
	mux.HandleFunc("GET /api/integrations", s.wrap(accessSession, false, s.handleIntegrations))
	mux.HandleFunc("GET /api/workspace/stats", s.wrap(accessOwner, false, s.handleWorkspaceStats))
	mux.HandleFunc("GET /api/audit", s.wrap(accessOwner, false, s.handleAudit))
	mux.HandleFunc("GET /api/audit.csv", s.wrap(accessOwner, false, s.handleAuditCSV))

	mux.HandleFunc("GET /api/projects", s.wrap(accessSession, false, s.handleListProjects))
	mux.HandleFunc("POST /api/projects", s.wrap(accessOwner, false, s.handleCreateProject))
	mux.HandleFunc("GET /api/projects/{slug}", s.wrap(accessSession, false, s.handleGetProject))
	mux.HandleFunc("PATCH /api/projects/{slug}", s.wrap(accessOwner, false, s.handlePatchProject))
	mux.HandleFunc("DELETE /api/projects/{slug}", s.wrap(accessOwner, false, s.handleDeleteProject))

	mux.HandleFunc("GET /api/projects/{slug}/branches", s.wrap(accessOwner, false, s.handleListBranches))
	mux.HandleFunc("POST /api/projects/{slug}/branches", s.wrap(accessOwner, false, s.handleCreateBranch))
	mux.HandleFunc("POST /api/projects/{slug}/branches/{branch}/transitions", s.wrap(accessOwner, false, s.handleBranchTransition))
	mux.HandleFunc("GET /api/projects/{slug}/branches/{branch}/keys", s.wrap(accessOwner, false, s.handleListKeys))
	mux.HandleFunc("POST /api/projects/{slug}/branches/{branch}/keys", s.wrap(accessOwner, false, s.handleCreateKey))
	mux.HandleFunc("PATCH /api/projects/{slug}/branches/{branch}/keys/{key_id}", s.wrap(accessOwner, false, s.handlePatchKey))
	mux.HandleFunc("DELETE /api/projects/{slug}/branches/{branch}/keys/{key_id}", s.wrap(accessOwner, false, s.handleDeleteKey))
	mux.HandleFunc("GET /api/projects/{slug}/keys/{key_id}/history", s.wrap(accessOwner, false, s.handleKeyHistory))
	mux.HandleFunc("POST /api/projects/{slug}/branches/{branch}/drafts", s.wrap(accessOwner, false, s.handleDrafts))
	mux.HandleFunc("POST /api/projects/{slug}/tm/match", s.wrap(accessOwner, false, s.handleTMMatch))

	mux.HandleFunc("GET /api/segments/{id}", s.wrap(accessSession, false, s.handleGetSegment))
	mux.HandleFunc("PUT /api/segments/{id}/value", s.wrap(accessSession, false, s.handleSegmentValue))
	mux.HandleFunc("POST /api/segments/{id}/score", s.wrap(accessSession, false, s.handleSegmentScore))
	mux.HandleFunc("POST /api/segments/{id}/issues", s.wrap(accessSession, false, s.handleSegmentIssue))
	mux.HandleFunc("POST /api/segments/{id}/approve", s.wrap(accessSession, false, s.handleSegmentApprove))
	mux.HandleFunc("POST /api/segments/{id}/correct", s.wrap(accessSession, false, s.handleSegmentCorrect))
	mux.HandleFunc("POST /api/segments/{id}/comments", s.wrap(accessSession, false, s.handleSegmentComment))

	mux.HandleFunc("GET /api/projects/{slug}/branches/{branch}/merge-preview", s.wrap(accessOwner, false, s.handleMergePreview))
	mux.HandleFunc("POST /api/projects/{slug}/branches/{branch}/conflicts/{conflict_id}/hold", s.wrap(accessOwner, false, s.handleHold))
	mux.HandleFunc("PUT /api/projects/{slug}/branches/{branch}/conflicts/{conflict_id}", s.wrap(accessOwner, false, s.handleResolve))
	mux.HandleFunc("POST /api/projects/{slug}/branches/{branch}/merge", s.wrap(accessOwner, false, s.handleMerge))
	mux.HandleFunc("GET /api/projects/{slug}/operations", s.wrap(accessOwner, false, s.handleOperations))
	mux.HandleFunc("POST /api/projects/{slug}/operations/{op_id}/restore", s.wrap(accessOwner, false, s.handleRestore))

	mux.HandleFunc("GET /api/projects/{slug}/tm", s.wrap(accessOwner, false, s.handleListTM))
	mux.HandleFunc("POST /api/projects/{slug}/tm/imports", s.wrap(accessOwner, true, s.handleTMImport))
	mux.HandleFunc("GET /api/projects/{slug}/tm/imports", s.wrap(accessOwner, false, s.handleListTMImports))
	mux.HandleFunc("GET /api/projects/{slug}/tm/imports/{import_id}/original", s.wrap(accessOwner, false, s.handleTMImportOriginal))
	mux.HandleFunc("POST /api/projects/{slug}/branches/{branch}/source-files", s.wrap(accessOwner, true, s.handleSourceFileUpload))
	mux.HandleFunc("GET /api/projects/{slug}/source-files", s.wrap(accessOwner, false, s.handleListSourceFiles))
	mux.HandleFunc("GET /api/projects/{slug}/source-files/{file_id}/original", s.wrap(accessOwner, false, s.handleSourceFileOriginal))

	mux.HandleFunc("GET /api/projects/{slug}/reviewers", s.wrap(accessOwner, false, s.handleListReviewers))
	mux.HandleFunc("POST /api/projects/{slug}/reviewers", s.wrap(accessOwner, false, s.handleInviteReviewer))
	mux.HandleFunc("DELETE /api/projects/{slug}/reviewers/{id}", s.wrap(accessOwner, false, s.handleRemoveReviewer))
	mux.HandleFunc("POST /api/projects/{slug}/assignments", s.wrap(accessOwner, false, s.handleCreateAssignment))
	mux.HandleFunc("GET /api/projects/{slug}/assignments", s.wrap(accessOwner, false, s.handleListAssignments))
	mux.HandleFunc("GET /api/review-queue", s.wrap(accessSession, false, s.handleReviewQueue))

	mux.HandleFunc("POST /api/projects/{slug}/publishes", s.wrap(accessOwner, false, s.handleCreatePublish))
	mux.HandleFunc("GET /api/projects/{slug}/publishes", s.wrap(accessOwner, false, s.handleListPublishes))
	mux.HandleFunc("GET /api/projects/{slug}/publishes/{id}", s.wrap(accessOwner, false, s.handleGetPublish))
	mux.HandleFunc("GET /api/projects/{slug}/tokens", s.wrap(accessOwner, false, s.handleListTokens))
	mux.HandleFunc("POST /api/projects/{slug}/tokens", s.wrap(accessOwner, false, s.handleCreateToken))
	mux.HandleFunc("DELETE /api/projects/{slug}/tokens/{id}", s.wrap(accessOwner, false, s.handleRevokeToken))
	mux.HandleFunc("PUT /api/projects/{slug}/webhook", s.wrap(accessOwner, false, s.handleSaveWebhook))
	mux.HandleFunc("GET /api/projects/{slug}/webhook", s.wrap(accessOwner, false, s.handleGetWebhook))
	mux.HandleFunc("GET /api/projects/{slug}/events", s.wrap(accessOwner, false, s.handleListEvents))
	mux.HandleFunc("GET /api/ci/projects/{slug}/locales/{lang}", s.wrap(accessCI, false, s.handleCILocale))

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { writeError(w, errNotFound()) })
	mux.HandleFunc("/", s.serveAsset)

	return mux
}

// wrap applies the published error precedence before a handler runs: body
// limits, then authentication, then scope, then role, then content type.
func (s *Server) wrap(acc access, upload bool, h handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit := int64(maxJSONBody)
		if upload {
			limit = maxMultipart
		}
		if r.ContentLength > limit {
			writeError(w, errPayloadTooLarge())
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, limit)

		c := &call{}
		if fail := s.authenticate(r, acc, c); fail != nil {
			writeError(w, fail)
			return
		}
		if fail := s.resolveProject(r, acc, c); fail != nil {
			writeError(w, fail)
			return
		}
		if acc == accessOwner && c.user != nil && c.user.Role != "owner" {
			writeError(w, errForbidden())
			return
		}
		if fail := checkContentType(r, upload); fail != nil {
			writeError(w, fail)
			return
		}
		if fail := h(w, r, c); fail != nil {
			writeError(w, fail)
		}
	}
}

func (s *Server) authenticate(r *http.Request, acc access, c *call) *apiError {
	ctx := r.Context()
	switch acc {
	case accessPublic:
		return nil
	case accessCI:
		header := r.Header.Get("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			return errUnauthenticated()
		}
		id, label, projectID, err := s.store.TokenByValue(ctx, strings.TrimPrefix(header, "Bearer "))
		if errors.Is(err, store.ErrNotFound) {
			return errUnauthenticated()
		}
		if err != nil {
			return errInternal(err)
		}
		c.tokenID, c.tokenLabel = id, label
		project, err := s.store.ProjectByID(ctx, s.store.Pool, projectID)
		if err != nil {
			return errNotFound()
		}
		c.project = project
		return nil
	default:
		cookie, err := r.Cookie(sessionCookie)
		if err != nil {
			return errUnauthenticated()
		}
		user, err := s.store.UserBySession(ctx, cookie.Value)
		if errors.Is(err, store.ErrNotFound) {
			return errUnauthenticated()
		}
		if err != nil {
			return errInternal(err)
		}
		c.user = user
		c.sessionID = cookie.Value
		return nil
	}
}

func (s *Server) resolveProject(r *http.Request, acc access, c *call) *apiError {
	slug := r.PathValue("slug")
	if slug == "" || acc == accessCI {
		return nil
	}
	ctx := r.Context()
	project, err := s.store.ProjectBySlug(ctx, s.store.Pool, slug)
	if errors.Is(err, store.ErrNotFound) {
		return errNotFound()
	}
	if err != nil {
		return errInternal(err)
	}
	if c.user != nil && c.user.Role == "reviewer" {
		inScope, err := s.store.ReviewerInScope(ctx, c.user.ID, project.ID)
		if err != nil {
			return errInternal(err)
		}
		if !inScope {
			return errNotFound()
		}
	}
	c.project = project
	return nil
}

func checkContentType(r *http.Request, upload bool) *apiError {
	switch r.Method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
	default:
		return nil
	}
	raw := r.Header.Get("Content-Type")
	if raw == "" {
		if r.ContentLength > 0 {
			return errUnsupportedMediaType()
		}
		return nil
	}
	mediaType, _, err := mime.ParseMediaType(raw)
	if err != nil {
		return errUnsupportedMediaType()
	}
	want := "application/json"
	if upload {
		want = "multipart/form-data"
	}
	if mediaType != want {
		return errUnsupportedMediaType()
	}
	return nil
}

// readJSON decodes a JSON body, enforcing the body limit.
func readJSON(r *http.Request, into any) *apiError {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return errPayloadTooLarge()
		}
		return errField("body", "The desk could not read that request body.")
	}
	if len(body) == 0 {
		body = []byte("{}")
	}
	if err := json.Unmarshal(body, into); err != nil {
		return errField("body", "That request body is not valid JSON.")
	}
	return nil
}

func (s *Server) setSessionCookie(w http.ResponseWriter, id string) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: id, Path: "/", HttpOnly: true,
		SameSite: http.SameSiteLaxMode, Expires: store.Now().Add(sessionTTL), MaxAge: int(sessionTTL.Seconds()),
	})
}

func (s *Server) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: "", Path: "/", HttpOnly: true,
		SameSite: http.SameSiteLaxMode, MaxAge: -1,
	})
}

// appRoutes are the screens the browser app serves; anything else is unknown.
var appRoutes = map[string]bool{
	"/": true, "/sign-in": true, "/desk": true, "/review": true, "/audit": true,
}

var projectRoutes = map[string]bool{
	"": true, "tm": true, "editor": true, "merge": true, "settings": true,
}

func (s *Server) serveAsset(w http.ResponseWriter, r *http.Request) {
	clean := path.Clean(r.URL.Path)
	if file, err := fs.ReadFile(s.assets, strings.TrimPrefix(clean, "/")); err == nil && clean != "/" {
		w.Header().Set("Content-Type", contentTypeOf(clean))
		if strings.HasPrefix(clean, "/assets/") || strings.HasPrefix(clean, "/fonts/") {
			w.Header().Set("Cache-Control", "public, max-age=3600")
		}
		_, _ = w.Write(file)
		return
	}
	status := http.StatusOK
	if !s.knownScreen(r) {
		status = http.StatusNotFound
	}
	page, err := fs.ReadFile(s.assets, "index.html")
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write(page)
}

func (s *Server) knownScreen(r *http.Request) bool {
	clean := strings.TrimSuffix(path.Clean(r.URL.Path), "/")
	if clean == "" {
		return true
	}
	if appRoutes[clean] {
		return true
	}
	parts := strings.Split(strings.TrimPrefix(clean, "/"), "/")
	if len(parts) < 2 || parts[0] != "projects" {
		return false
	}
	tail := ""
	if len(parts) == 3 {
		tail = parts[2]
	} else if len(parts) > 3 {
		return false
	}
	if !projectRoutes[tail] {
		return false
	}
	return s.projectVisible(r, parts[1])
}

// projectVisible reports whether the caller may see a project, so that an
// unknown or out-of-scope project URL is served with 404.
func (s *Server) projectVisible(r *http.Request, slug string) bool {
	ctx := r.Context()
	project, err := s.store.ProjectBySlug(ctx, s.store.Pool, slug)
	if err != nil {
		return false
	}
	cookie, err := r.Cookie(sessionCookie)
	if err != nil {
		return true
	}
	user, err := s.store.UserBySession(ctx, cookie.Value)
	if err != nil {
		return true
	}
	if user.Role != "reviewer" {
		return true
	}
	inScope, err := s.store.ReviewerInScope(ctx, user.ID, project.ID)
	return err == nil && inScope
}

func contentTypeOf(name string) string {
	switch path.Ext(name) {
	case ".html":
		return "text/html; charset=utf-8"
	case ".js":
		return "text/javascript; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".woff2":
		return "font/woff2"
	case ".svg":
		return "image/svg+xml"
	case ".json":
		return "application/json; charset=utf-8"
	case ".ico":
		return "image/x-icon"
	}
	return "application/octet-stream"
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request, _ *call) *apiError {
	if !s.ready() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "starting"})
		return nil
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	return nil
}

func (s *Server) handleIntegrations(w http.ResponseWriter, r *http.Request, _ *call) *apiError {
	writeJSON(w, http.StatusOK, s.prober.Status(r.Context()))
	return nil
}

// withTimeout carries a request deadline into Postgres, MinIO and HTTP calls.
func withTimeout(ctx context.Context, d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, d)
}

func fmtInt(n int) string { return fmt.Sprintf("%d", n) }
