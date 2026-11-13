package api

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/marlowquill/interline-desk/internal/domain"
	"github.com/marlowquill/interline-desk/internal/store"
)

func projectBody(p *store.Project) map[string]any {
	return map[string]any{
		"id": p.ID, "slug": p.Slug, "name": p.Name, "client": p.Client,
		"source_language": p.SourceLanguage, "target_languages": p.TargetLanguages,
		"repository": p.Repository, "mqm_threshold": p.MQMThreshold, "ai_routes": p.AIRoutes,
		"created_at": p.CreatedAt,
	}
}

func (s *Server) handleListProjects(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	projects, err := s.store.Projects(r.Context(), c.user)
	if err != nil {
		return errInternal(err)
	}
	bodies := []map[string]any{}
	for _, project := range projects {
		bodies = append(bodies, projectBody(project))
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": bodies})
	return nil
}

func (s *Server) handleGetProject(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	ctx := r.Context()
	branches, err := s.store.Branches(ctx, s.store.Pool, c.project.ID)
	if err != nil {
		return errInternal(err)
	}
	open := []*store.Branch{}
	for _, branch := range branches {
		if branch.IsMain || !domain.BranchFinal(branch.State) {
			open = append(open, branch)
		}
	}
	var entries int
	if err := s.store.Pool.QueryRow(ctx, `select count(*) from tm_entries where project_id = $1`,
		c.project.ID).Scan(&entries); err != nil {
		return errInternal(fmt.Errorf("count memory entries: %w", err))
	}
	last, err := s.store.LastPublish(ctx, c.project.ID)
	if err != nil {
		return errInternal(err)
	}
	body := projectBody(c.project)
	body["branches"] = branchBodies(open)
	body["tm_entries"] = entries
	body["last_publish"] = last
	writeJSON(w, http.StatusOK, body)
	return nil
}

func branchBodies(branches []*store.Branch) []map[string]any {
	out := []map[string]any{}
	for _, branch := range branches {
		out = append(out, map[string]any{
			"name": branch.Name, "state": branch.Reported(), "is_main": branch.IsMain,
			"created_at": branch.CreatedAt,
		})
	}
	return out
}

func (s *Server) handleCreateProject(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	var body struct {
		Slug            string            `json:"slug"`
		Name            string            `json:"name"`
		Client          string            `json:"client"`
		SourceLanguage  string            `json:"source_language"`
		TargetLanguages []string          `json:"target_languages"`
		Repository      string            `json:"repository"`
		MQMThreshold    *int              `json:"mqm_threshold"`
		AIRoutes        map[string]string `json:"ai_routes"`
	}
	if fail := readJSON(r, &body); fail != nil {
		return fail
	}
	fields := map[string]string{}
	body.Slug = strings.TrimSpace(body.Slug)
	body.Name = strings.TrimSpace(body.Name)
	body.Client = strings.TrimSpace(body.Client)
	if !validSlug(body.Slug) {
		fields["slug"] = "Use 2 to 40 lowercase letters, digits or hyphens, starting with a letter or digit."
	}
	if !lengthBetween(body.Name, 1, 80) {
		fields["name"] = "Give the project a name of 1 to 80 characters."
	}
	if !lengthBetween(body.Client, 1, 80) {
		fields["client"] = "Give the client a name of 1 to 80 characters."
	}
	if !validLanguage(body.SourceLanguage) {
		fields["source_language"] = "Use a language code such as en or pt-BR."
	}
	targets := []string{}
	seen := map[string]bool{}
	for _, lang := range body.TargetLanguages {
		lang = strings.TrimSpace(lang)
		if lang == "" {
			continue
		}
		if !validLanguage(lang) || lang == body.SourceLanguage || seen[lang] {
			fields["target_languages"] = "Use 1 to 10 distinct language codes, none the source language."
			break
		}
		seen[lang] = true
		targets = append(targets, lang)
	}
	if len(targets) < 1 || len(targets) > 10 {
		fields["target_languages"] = "Use 1 to 10 distinct language codes, none the source language."
	}
	if !validRepository(body.Repository) {
		fields["repository"] = "Use the form owner/repository."
	}
	threshold := 90
	if body.MQMThreshold != nil {
		threshold = *body.MQMThreshold
		if threshold < 0 || threshold > 100 {
			fields["mqm_threshold"] = "Use a whole number from 0 to 100."
		}
	}
	routes := map[string]string{}
	for _, lang := range targets {
		routes[lang] = "lexa-general"
	}
	for lang, engine := range body.AIRoutes {
		if !seen[lang] || !validEngine(engine) {
			fields["ai_routes"] = "Route each target language to an engine name."
			break
		}
		routes[lang] = engine
	}
	if len(fields) > 0 {
		return errValidation(fields)
	}

	project := &store.Project{
		ID: store.NewID(), Slug: body.Slug, Name: body.Name, Client: body.Client,
		SourceLanguage: body.SourceLanguage, TargetLanguages: targets, Repository: body.Repository,
		MQMThreshold: threshold, AIRoutes: routes, CreatedAt: store.Now(),
	}
	err := s.store.InTx(r.Context(), func(tx pgx.Tx) error {
		if err := s.store.InsertProject(r.Context(), tx, project); err != nil {
			return err
		}
		main := &store.Branch{ID: store.NewID(), ProjectID: project.ID, Name: "main",
			State: domain.BranchOpen, IsMain: true, CreatedAt: project.CreatedAt, Base: domain.KeySet{}}
		if err := s.store.InsertBranch(r.Context(), tx, main); err != nil {
			return err
		}
		return s.store.AddAudit(r.Context(), tx, c.user.Email, "project.created", project.Slug,
			project.Name, &project.ID)
	})
	if err != nil {
		if uniqueViolation(err) {
			return &apiError{Status: http.StatusConflict, Code: "slug_taken",
				Message: "That slug is already used by another project.",
				Fields:  map[string]string{"slug": "That slug is already used by another project."}}
		}
		return errInternal(err)
	}
	writeJSON(w, http.StatusCreated, projectBody(project))
	return nil
}

func (s *Server) handlePatchProject(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	var body struct {
		Name     *string           `json:"name"`
		Client   *string           `json:"client"`
		AIRoutes map[string]string `json:"ai_routes"`
	}
	if fail := readJSON(r, &body); fail != nil {
		return fail
	}
	project := c.project
	fields := map[string]string{}
	if body.Name != nil {
		name := strings.TrimSpace(*body.Name)
		if !lengthBetween(name, 1, 80) {
			fields["name"] = "Give the project a name of 1 to 80 characters."
		} else {
			project.Name = name
		}
	}
	if body.Client != nil {
		client := strings.TrimSpace(*body.Client)
		if !lengthBetween(client, 1, 80) {
			fields["client"] = "Give the client a name of 1 to 80 characters."
		} else {
			project.Client = client
		}
	}
	for lang, engine := range body.AIRoutes {
		if !validEngine(engine) || !containsString(project.TargetLanguages, lang) {
			fields["ai_routes"] = "Route each target language to an engine name."
			break
		}
		project.AIRoutes[lang] = engine
	}
	if len(fields) > 0 {
		return errValidation(fields)
	}
	ctx := r.Context()
	routes, err := jsonBytes(project.AIRoutes)
	if err != nil {
		return errInternal(err)
	}
	if _, err := s.store.Pool.Exec(ctx, `update projects set name = $2, client = $3, ai_routes = $4 where id = $1`,
		project.ID, project.Name, project.Client, routes); err != nil {
		return errInternal(fmt.Errorf("update project: %w", err))
	}
	if err := s.store.AddAudit(ctx, s.store.Pool, c.user.Email, "project.updated", project.Slug,
		project.Name, &project.ID); err != nil {
		return errInternal(err)
	}
	writeJSON(w, http.StatusOK, projectBody(project))
	return nil
}

func (s *Server) handleDeleteProject(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	var body struct {
		Confirm string `json:"confirm"`
	}
	if fail := readJSON(r, &body); fail != nil {
		return fail
	}
	if body.Confirm != c.project.Slug {
		return errField("confirm", "Type the project slug exactly to confirm.")
	}
	ctx := r.Context()
	if err := s.objects.DeletePrefix(ctx, "projects/"+c.project.ID+"/"); err != nil {
		return errStorageUnavailable()
	}
	appUID := "idk-" + c.project.ID
	if err := s.store.EraseProject(ctx, c.project, appUID); err != nil {
		return errInternal(err)
	}
	if err := s.webhooks.DeleteApplication(ctx, appUID); err != nil {
		if queueErr := s.store.QueueAppDeletion(ctx, appUID); queueErr != nil {
			return errInternal(queueErr)
		}
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func containsString(list []string, want string) bool {
	for _, item := range list {
		if item == want {
			return true
		}
	}
	return false
}
