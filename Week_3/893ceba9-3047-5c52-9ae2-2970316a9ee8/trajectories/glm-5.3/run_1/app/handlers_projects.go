package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/lib/pq"
)

var slugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,39}$`)
var langRe = regexp.MustCompile(`^[a-z]{2,3}(-[A-Z]{2})?$`)
var repoRe = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)
var engineRe = regexp.MustCompile(`^[a-z0-9-]{1,40}$`)
var keyNameRe = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,120}$`)
var branchNameRe = regexp.MustCompile(`^[a-z0-9][a-z0-9/_-]{0,62}$`)

func (s *Server) handleProjectsList(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	var projects []*Project
	var err error
	if u.Role == "owner" {
		projects, err = s.store.ProjectsForOwner(r.Context())
	} else {
		projects, err = s.store.ProjectsForReviewer(r.Context(), u.ID)
	}
	if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": projects})
}

func (s *Server) handleProjectCreate(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	var body struct {
		Slug            string            `json:"slug"`
		Name            string            `json:"name"`
		Client          string            `json:"client"`
		SourceLanguage  string            `json:"source_language"`
		TargetLanguages []string          `json:"target_languages"`
		Repository      string            `json:"repository"`
		MqmThreshold    *int              `json:"mqm_threshold"`
		AiRoutes        map[string]string `json:"ai_routes"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		validationFailed(w, map[string]string{"slug": "Read the request body again."})
		return
	}
	fields := map[string]string{}
	if !slugRe.MatchString(body.Slug) {
		fields["slug"] = "Use lowercase letters, digits and hyphens, 2 to 40 characters."
	}
	if len(body.Name) < 1 || len(body.Name) > 80 {
		fields["name"] = "Project name must be 1 to 80 characters."
	}
	if len(body.Client) < 1 || len(body.Client) > 80 {
		fields["client"] = "Client must be 1 to 80 characters."
	}
	if !langRe.MatchString(body.SourceLanguage) {
		fields["source_language"] = "Use a language code like en or pt-BR."
	}
	if len(body.TargetLanguages) < 1 || len(body.TargetLanguages) > 10 {
		fields["target_languages"] = "Choose 1 to 10 target languages."
	} else {
		seen := map[string]bool{}
		for _, l := range body.TargetLanguages {
			if !langRe.MatchString(l) {
				fields["target_languages"] = "Use language codes like de or pt-BR."
				break
			}
			if l == body.SourceLanguage {
				fields["target_languages"] = "The source language can't also be a target."
				break
			}
			if seen[l] {
				fields["target_languages"] = "Each target language must be distinct."
				break
			}
			seen[l] = true
		}
	}
	if !repoRe.MatchString(body.Repository) {
		fields["repository"] = "Use owner/repository."
	}
	threshold := 90
	if body.MqmThreshold != nil {
		threshold = *body.MqmThreshold
		if threshold < 0 || threshold > 100 {
			fields["mqm_threshold"] = "The threshold is 0 to 100."
		}
	}
	routes := map[string]string{}
	for _, l := range body.TargetLanguages {
		routes[l] = "lexa-general"
	}
	if body.AiRoutes != nil {
		for l, e := range body.AiRoutes {
			if !engineRe.MatchString(e) {
				fields["ai_routes"] = "Engine names are lowercase letters, digits and hyphens."
				break
			}
			routes[l] = e
		}
	}
	if len(fields) > 0 {
		validationFailed(w, fields)
		return
	}

	var existing string
	if err := s.db.QueryRowContext(r.Context(), `SELECT slug FROM projects WHERE slug = $1`, body.Slug).Scan(&existing); err == nil {
		writeErrorFields(w, http.StatusConflict, "slug_taken", "That slug is already used by another project.", map[string]string{"slug": "That slug is already used by another project."})
		return
	}

	id := newUUID()
	now := time.Now().UTC()
	routesJSON, _ := json.Marshal(routes)
	err := s.store.withTx(r.Context(), func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(r.Context(), `INSERT INTO projects (id, slug, name, client, source_language, target_languages, repository, mqm_threshold, ai_routes, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
			id, body.Slug, body.Name, body.Client, body.SourceLanguage, pq.Array(body.TargetLanguages), body.Repository, threshold, string(routesJSON), now); err != nil {
			return err
		}
		if _, err := tx.ExecContext(r.Context(), `INSERT INTO branches (id, project_id, name, state, is_main, created_at) VALUES ($1,$2,'main','open',true,$3)`,
			newUUID(), id, now); err != nil {
			return err
		}
		if _, err := tx.ExecContext(r.Context(), `INSERT INTO audit_log (id, at, actor, action, project, detail) VALUES ($1,$2,$3,'project.created',$4,$5)`,
			newUUID(), now, u.Email, body.Slug, body.Name); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		if strings.Contains(err.Error(), "projects_slug_key") {
			writeErrorFields(w, http.StatusConflict, "slug_taken", "That slug is already used by another project.", map[string]string{"slug": "That slug is already used by another project."})
			return
		}
		http.Error(w, "internal", 500)
		return
	}
	p, _ := s.store.ProjectBySlug(r.Context(), body.Slug)
	writeJSON(w, http.StatusCreated, p)
}

func (s *Server) handleProjectGet(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	slug := r.PathValue("slug")
	p, err := s.store.ProjectBySlug(r.Context(), slug)
	if err != nil || p == nil {
		notFoundError(w)
		return
	}
	if u.Role == "reviewer" {
		ok, err := reviewerCanSeeProject(r.Context(), s.db, u.ID, p.ID)
		if err != nil || !ok {
			notFoundError(w)
			return
		}
	}
	branches, err := s.store.Branches(r.Context(), p.ID)
	if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	var tmCount int
	if err := s.db.QueryRowContext(r.Context(), `SELECT count(*) FROM tm_entries WHERE project_id = $1`, p.ID).Scan(&tmCount); err != nil {
		http.Error(w, "internal", 500)
		return
	}
	var lastPublish map[string]any
	rows, err := s.db.QueryContext(r.Context(), `SELECT id, branch, state, coalesce(pull_request_number,0), coalesce(pull_request_url,''), created_at, confirmed_at FROM publishes WHERE project_id = $1 AND state = 'published' ORDER BY confirmed_at DESC NULLS LAST LIMIT 1`, p.ID)
	if err == nil {
		for rows.Next() {
			var id, branch, state, created string
			var number int
			var urlStr string
			var confirmed any
			if rows.Scan(&id, &branch, &state, &number, &urlStr, &created, &confirmed) == nil {
				lastPublish = map[string]any{"id": id, "branch": branch, "state": state, "pull_request": map[string]any{"number": number, "url": urlStr}}
			}
		}
		rows.Close()
	}
	body := map[string]any{
		"id": p.ID, "slug": p.Slug, "name": p.Name, "client": p.Client,
		"source_language": p.SourceLanguage, "target_languages": p.TargetLanguages,
		"repository": p.Repository, "mqm_threshold": p.MqmThreshold,
		"ai_routes": p.AiRoutes, "created_at": p.CreatedAt,
		"branches": branches, "tm_entries": tmCount, "last_publish": lastPublish,
	}
	writeJSON(w, http.StatusOK, body)
}

func (s *Server) handleProjectPatch(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	slug := r.PathValue("slug")
	p, err := s.store.ProjectBySlug(r.Context(), slug)
	if err != nil || p == nil {
		notFoundError(w)
		return
	}
	var body struct {
		Name     *string           `json:"name"`
		Client   *string           `json:"client"`
		AiRoutes map[string]string `json:"ai_routes"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		validationFailed(w, map[string]string{"name": "Read the request body again."})
		return
	}
	fields := map[string]string{}
	if body.Name != nil && (len(*body.Name) < 1 || len(*body.Name) > 80) {
		fields["name"] = "Project name must be 1 to 80 characters."
	}
	if body.Client != nil && (len(*body.Client) < 1 || len(*body.Client) > 80) {
		fields["client"] = "Client must be 1 to 80 characters."
	}
	routes := p.AiRoutes
	if body.AiRoutes != nil {
		routes = map[string]string{}
		for l, e := range body.AiRoutes {
			if !engineRe.MatchString(e) {
				fields["ai_routes"] = "Engine names are lowercase letters, digits and hyphens."
				break
			}
			routes[l] = e
		}
	}
	if len(fields) > 0 {
		validationFailed(w, fields)
		return
	}
	if body.Name != nil {
		_, _ = s.db.ExecContext(r.Context(), `UPDATE projects SET name = $1 WHERE id = $2`, *body.Name, p.ID)
	}
	if body.Client != nil {
		_, _ = s.db.ExecContext(r.Context(), `UPDATE projects SET client = $1 WHERE id = $2`, *body.Client, p.ID)
	}
	if body.AiRoutes != nil {
		routesJSON, _ := json.Marshal(routes)
		_, _ = s.db.ExecContext(r.Context(), `UPDATE projects SET ai_routes = $1 WHERE id = $2`, string(routesJSON), p.ID)
	}
	_ = s.store.AuditInsert(r.Context(), u.Email, "project.updated", p.Slug, "")
	updated, _ := s.store.ProjectBySlug(r.Context(), slug)
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleProjectDelete(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	slug := r.PathValue("slug")
	var body struct {
		Confirm string `json:"confirm"`
	}
	if err := decodeJSONBody(r, &body); err != nil || body.Confirm != slug {
		validationFailed(w, map[string]string{"confirm": "Type the project slug exactly to confirm."})
		return
	}
	p, err := s.store.ProjectBySlug(r.Context(), slug)
	if err != nil || p == nil {
		notFoundError(w)
		return
	}
	if err := s.eraseProject(r.Context(), p, u.Email); err != nil {
		http.Error(w, "internal", 500)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) eraseProject(ctx context.Context, p *Project, actor string) error {
	// delete MinIO objects under the project prefix
	if err := s.storage.DeletePrefix(ctx, "projects/"+p.ID+"/"); err != nil {
		// continue; objects are removed when possible
		_ = err
	}
	if err := s.svix.DeleteApplication(ctx, p.ID); err != nil {
		go s.retrySvixDelete(p.ID)
	}
	err := s.store.withTx(ctx, func(tx *sql.Tx) error {
		for _, stmt := range []string{
			`DELETE FROM events WHERE project_id = $1`,
			`DELETE FROM idempotency WHERE project_id = $1`,
			`DELETE FROM publishes WHERE project_id = $1`,
			`DELETE FROM webhook_endpoints WHERE project_id = $1`,
			`DELETE FROM tokens WHERE project_id = $1`,
			`DELETE FROM assignments WHERE project_id = $1`,
			`DELETE FROM conflicts WHERE project_id = $1`,
			`DELETE FROM operations WHERE project_id = $1`,
			`DELETE FROM source_files WHERE project_id = $1`,
			`DELETE FROM tm_imports WHERE project_id = $1`,
			`DELETE FROM tm_entries WHERE project_id = $1`,
			`DELETE FROM comments WHERE segment_id IN (SELECT id FROM segments WHERE project_id = $1)`,
			`DELETE FROM segment_history WHERE segment_id IN (SELECT id FROM segments WHERE project_id = $1)`,
			`DELETE FROM segments WHERE project_id = $1`,
			`DELETE FROM key_revisions WHERE key_id IN (SELECT id FROM keys WHERE project_id = $1)`,
			`DELETE FROM keys WHERE project_id = $1`,
			`DELETE FROM branches WHERE project_id = $1`,
			`DELETE FROM reviewer_scopes WHERE project_id = $1`,
			`DELETE FROM audit_log WHERE project = $1`,
			`DELETE FROM projects WHERE id = $1`,
		} {
			if _, err := tx.ExecContext(ctx, stmt, p.ID); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO audit_log (id, at, actor, action, project, detail) VALUES ($1, now(), $2, 'project.erased', '', '')`,
			newUUID(), actor); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return err
	}
	// reviewers with no project left can no longer sign in
	_, _ = s.db.ExecContext(ctx, `UPDATE users SET access_key = NULL WHERE role = 'reviewer' AND id NOT IN (SELECT reviewer_id FROM reviewer_scopes)`)
	return nil
}

func (s *Server) retrySvixDelete(projectID string) {
	for {
		ctx, cancel := contextWithTimeout(context.Background(), 5*time.Second)
		err := s.svix.DeleteApplication(ctx, projectID)
		cancel()
		if err == nil {
			return
		}
		time.Sleep(s.cfg.WebhookRetry)
	}
}

// projectInScope loads a project for a signed-in user and returns 404 when the
// project is unknown or outside the caller's scope.
func (s *Server) projectInScope(w http.ResponseWriter, r *http.Request, slug string) (*Project, error) {
	u := userFrom(r.Context())
	p, err := s.store.ProjectBySlug(r.Context(), slug)
	if err != nil {
		return nil, err
	}
	if p == nil {
		notFoundError(w)
		return nil, errNotFoundSentinel
	}
	if u.Role == "reviewer" {
		ok, err := reviewerCanSeeProject(r.Context(), s.db, u.ID, p.ID)
		if err != nil {
			return nil, err
		}
		if !ok {
			notFoundError(w)
			return nil, errNotFoundSentinel
		}
	}
	return p, nil
}

var errNotFoundSentinel = errors.New("not found already written")
