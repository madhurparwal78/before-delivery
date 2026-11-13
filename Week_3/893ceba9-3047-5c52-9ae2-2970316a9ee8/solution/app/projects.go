package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"slices"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	slugPattern     = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,39}$`)
	languagePattern = regexp.MustCompile(`^[a-z]{2,3}(-[A-Z]{2})?$`)
	repoPattern     = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)
	enginePattern   = regexp.MustCompile(`^[a-z0-9-]{1,40}$`)
	keyNamePattern  = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,120}$`)
	branchPattern   = regexp.MustCompile(`^[a-z0-9][a-z0-9/_-]{0,62}$`)
)

const defaultEngine = "lexa-general"

func (a *App) handleProjects(w http.ResponseWriter, r *http.Request) error {
	pr, err := a.authn(r)
	if err != nil {
		return err
	}
	sql := "SELECT " + projectColumns + " FROM projects ORDER BY seq"
	args := []any{}
	if !pr.isOwner() {
		sql = "SELECT " + projectColumns + " FROM projects WHERE id IN (SELECT project_id FROM reviewer_scopes WHERE user_id = $1) ORDER BY seq"
		args = append(args, pr.ID)
	}
	rows, err := a.pool.Query(r.Context(), sql, args...)
	if err != nil {
		return fmt.Errorf("list projects: %w", err)
	}
	defer rows.Close()
	var projects []*Project
	for rows.Next() {
		p, err := scanProject(rows)
		if err != nil {
			return fmt.Errorf("scan project: %w", err)
		}
		projects = append(projects, p)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read projects: %w", err)
	}
	rows.Close()
	live, err := a.liveBranchNames(r.Context())
	if err != nil {
		return err
	}
	out := []map[string]any{}
	for _, p := range projects {
		item := p.json()
		item["branches"] = append([]map[string]string{}, live[p.ID]...)
		out = append(out, item)
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": out})
	return nil
}

// liveBranchNames lists each project's open and in-review feature branches, for the header's Branches menu.
func (a *App) liveBranchNames(ctx context.Context) (map[string][]map[string]string, error) {
	rows, err := a.pool.Query(ctx, "SELECT project_id, name, state FROM branches WHERE NOT is_main AND state IN ('open', 'in_review') ORDER BY seq")
	if err != nil {
		return nil, fmt.Errorf("list live branches: %w", err)
	}
	defer rows.Close()
	out := map[string][]map[string]string{}
	for rows.Next() {
		var project, name, state string
		if err := rows.Scan(&project, &name, &state); err != nil {
			return nil, fmt.Errorf("scan branch: %w", err)
		}
		out[project] = append(out[project], map[string]string{"name": name, "state": state})
	}
	return out, rows.Err()
}

type projectInput struct {
	Slug            string            `json:"slug"`
	Name            string            `json:"name"`
	Client          string            `json:"client"`
	SourceLanguage  string            `json:"source_language"`
	TargetLanguages []string          `json:"target_languages"`
	Repository      string            `json:"repository"`
	MQMThreshold    *int              `json:"mqm_threshold"`
	AIRoutes        map[string]string `json:"ai_routes"`
}

func validName(field, value string) *apiError {
	if n := utf8.RuneCountInString(value); n < 1 || n > 80 {
		return errField(field, "Use 1 to 80 characters.")
	}
	return nil
}

func validRoutes(targets []string, routes map[string]string) (map[string]string, *apiError) {
	out := map[string]string{}
	for _, t := range targets {
		out[t] = defaultEngine
	}
	for lang, engine := range routes {
		if !slices.Contains(targets, lang) {
			return nil, errField("ai_routes", "Routes may only name target languages.")
		}
		if !enginePattern.MatchString(engine) {
			return nil, errField("ai_routes", "Engine names use lowercase letters, digits and hyphens.")
		}
		out[lang] = engine
	}
	return out, nil
}

func (in *projectInput) validate() *apiError {
	fields := map[string]string{}
	if !slugPattern.MatchString(in.Slug) {
		fields["slug"] = "Use 2 to 40 lowercase letters, digits or hyphens, starting with a letter or digit."
	}
	if e := validName("name", in.Name); e != nil {
		fields["name"] = e.Fields["name"]
	}
	if e := validName("client", in.Client); e != nil {
		fields["client"] = e.Fields["client"]
	}
	if !languagePattern.MatchString(in.SourceLanguage) {
		fields["source_language"] = "Use a language code such as en or pt-BR."
	}
	distinct := map[string]bool{}
	for _, t := range in.TargetLanguages {
		if !languagePattern.MatchString(t) || t == in.SourceLanguage || distinct[t] {
			fields["target_languages"] = "Use 1 to 10 distinct language codes, none equal to the source."
		}
		distinct[t] = true
	}
	if n := len(in.TargetLanguages); n < 1 || n > 10 {
		fields["target_languages"] = "Use 1 to 10 distinct language codes, none equal to the source."
	}
	if !repoPattern.MatchString(in.Repository) {
		fields["repository"] = "Use the form owner/repository."
	}
	threshold := 90
	if in.MQMThreshold != nil {
		threshold = *in.MQMThreshold
		if threshold < 0 || threshold > 100 {
			fields["mqm_threshold"] = "Use a whole number from 0 to 100."
		}
	}
	routes, e := validRoutes(in.TargetLanguages, in.AIRoutes)
	if e != nil {
		fields["ai_routes"] = e.Fields["ai_routes"]
	}
	if len(fields) > 0 {
		return errValidation(fields)
	}
	in.AIRoutes = routes
	in.MQMThreshold = &threshold
	return nil
}

func (a *App) handleCreateProject(w http.ResponseWriter, r *http.Request) error {
	pr, err := a.authn(r)
	if err != nil {
		return err
	}
	if err := pr.requireOwner(); err != nil {
		return err
	}
	var in projectInput
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	ctx := r.Context()
	var taken int
	if err := a.pool.QueryRow(ctx, "SELECT count(*) FROM projects WHERE slug = $1", in.Slug).Scan(&taken); err != nil {
		return fmt.Errorf("check slug: %w", err)
	}
	if taken > 0 {
		return newErr(http.StatusConflict, "slug_taken", "That slug is already used by another project.")
	}
	if ae := in.validate(); ae != nil {
		return ae
	}
	p := &Project{
		ID: newID(), Slug: in.Slug, Name: in.Name, Client: in.Client, SourceLanguage: in.SourceLanguage,
		TargetLanguages: in.TargetLanguages, Repository: in.Repository, MQMThreshold: *in.MQMThreshold,
		AIRoutes: in.AIRoutes, CreatedAt: now(),
	}
	err = a.inTx(ctx, func(tx pgx.Tx) error {
		if err := insertProject(ctx, tx, p); err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				return newErr(http.StatusConflict, "slug_taken", "That slug is already used by another project.")
			}
			return err
		}
		return a.audit(ctx, tx, pr.Email, "project.created", p, p.Repository)
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, p.json())
	return nil
}

func insertProject(ctx context.Context, q db, p *Project) error {
	_, err := q.Exec(ctx, `INSERT INTO projects (id, slug, name, client, source_language, target_languages, repository, mqm_threshold, ai_routes, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, p.ID, p.Slug, p.Name, p.Client, p.SourceLanguage, p.TargetLanguages,
		p.Repository, p.MQMThreshold, p.AIRoutes, p.CreatedAt)
	if err != nil {
		return fmt.Errorf("insert project: %w", err)
	}
	_, err = q.Exec(ctx, "INSERT INTO branches (id, project_id, name, state, is_main, created_at) VALUES ($1, $2, 'main', 'open', true, $3)",
		newID(), p.ID, p.CreatedAt)
	if err != nil {
		return fmt.Errorf("insert main branch: %w", err)
	}
	return nil
}

func (a *App) handleGetProject(w http.ResponseWriter, r *http.Request) error {
	pr, err := a.authn(r)
	if err != nil {
		return err
	}
	p, err := a.scopedProject(r, pr, r.PathValue("slug"))
	if err != nil {
		return err
	}
	ctx := r.Context()
	branches, err := listBranches(ctx, a.pool, p.ID)
	if err != nil {
		return err
	}
	bj := []map[string]any{}
	for _, b := range branches {
		bj = append(bj, b.json())
	}
	var tmEntries int
	if err := a.pool.QueryRow(ctx, "SELECT count(*) FROM tm_entries WHERE project_id = $1", p.ID).Scan(&tmEntries); err != nil {
		return fmt.Errorf("count TM entries: %w", err)
	}
	last, err := a.lastPublish(ctx, p)
	if err != nil {
		return err
	}
	out := p.json()
	out["branches"], out["tm_entries"], out["last_publish"] = bj, tmEntries, last
	writeJSON(w, http.StatusOK, out)
	return nil
}

func (a *App) handlePatchProject(w http.ResponseWriter, r *http.Request) error {
	pr, p, err := a.ownerProject(r)
	if err != nil {
		return err
	}
	var in struct {
		Name     *string           `json:"name"`
		Client   *string           `json:"client"`
		AIRoutes map[string]string `json:"ai_routes"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	fields := map[string]string{}
	if in.Name != nil {
		if e := validName("name", *in.Name); e != nil {
			fields["name"] = e.Fields["name"]
		}
	}
	if in.Client != nil {
		if e := validName("client", *in.Client); e != nil {
			fields["client"] = e.Fields["client"]
		}
	}
	routes := p.AIRoutes
	if in.AIRoutes != nil {
		merged := map[string]string{}
		for k, v := range p.AIRoutes {
			merged[k] = v
		}
		for k, v := range in.AIRoutes {
			merged[k] = v
		}
		var e *apiError
		if routes, e = validRoutes(p.TargetLanguages, merged); e != nil {
			fields["ai_routes"] = e.Fields["ai_routes"]
		}
	}
	if len(fields) > 0 {
		return errValidation(fields)
	}
	if in.Name != nil {
		p.Name = *in.Name
	}
	if in.Client != nil {
		p.Client = *in.Client
	}
	p.AIRoutes = routes
	ctx := r.Context()
	err = a.inProject(ctx, p.ID, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "UPDATE projects SET name = $2, client = $3, ai_routes = $4 WHERE id = $1", p.ID, p.Name, p.Client, p.AIRoutes); err != nil {
			return fmt.Errorf("update project: %w", err)
		}
		return a.audit(ctx, tx, pr.Email, "project.updated", p, p.Slug)
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, p.json())
	return nil
}

func (a *App) handleEraseProject(w http.ResponseWriter, r *http.Request) error {
	pr, p, err := a.ownerProject(r)
	if err != nil {
		return err
	}
	var in struct {
		Confirm string `json:"confirm"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	if in.Confirm != p.Slug {
		return errField("confirm", "Type the project slug exactly to confirm.")
	}
	ctx := r.Context()
	var hadWebhook bool
	err = a.inProject(ctx, p.ID, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM webhooks WHERE project_id = $1)", p.ID).Scan(&hadWebhook); err != nil {
			return fmt.Errorf("check webhook: %w", err)
		}
		if _, err := tx.Exec(ctx, "DELETE FROM audit WHERE project_id = $1 OR project = $2", p.ID, p.Slug); err != nil {
			return fmt.Errorf("erase audit entries: %w", err)
		}
		if _, err := tx.Exec(ctx, "DELETE FROM projects WHERE id = $1", p.ID); err != nil {
			return fmt.Errorf("erase project: %w", err)
		}
		return a.audit(ctx, tx, pr.Email, "project.erased", nil, "")
	})
	if err != nil {
		return err
	}
	cleanup, cancel := detached(ctx)
	defer cancel()
	a.cleanupAfterErase(cleanup, p.ID, hadWebhook)
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (a *App) handleStats(w http.ResponseWriter, r *http.Request) error {
	pr, err := a.authn(r)
	if err != nil {
		return err
	}
	if err := pr.requireOwner(); err != nil {
		return err
	}
	ctx := r.Context()
	var out struct {
		Projects, Reused, Confirmed int
	}
	if err := a.pool.QueryRow(ctx, "SELECT count(*) FROM projects").Scan(&out.Projects); err != nil {
		return fmt.Errorf("count projects: %w", err)
	}
	err = a.pool.QueryRow(ctx, `SELECT count(*) FROM segments s JOIN branch_keys k ON k.branch_id = s.branch_id AND k.key_id = s.key_id
		JOIN branches b ON b.id = s.branch_id WHERE s.origin = 'tm' AND NOT k.deleted AND b.state IN ('open', 'in_review')`).Scan(&out.Reused)
	if err != nil {
		return fmt.Errorf("count reused matches: %w", err)
	}
	if err := a.pool.QueryRow(ctx, "SELECT count(*) FROM publishes WHERE state = $1", publishDone).Scan(&out.Confirmed); err != nil {
		return fmt.Errorf("count publishes: %w", err)
	}
	conflicts, below := 0, 0
	rows, err := a.pool.Query(ctx, "SELECT project_id, id FROM branches WHERE state IN ('open', 'in_review')")
	if err != nil {
		return fmt.Errorf("list live branches: %w", err)
	}
	type ref struct{ project, branch string }
	var refs []ref
	for rows.Next() {
		var x ref
		if err := rows.Scan(&x.project, &x.branch); err != nil {
			rows.Close()
			return fmt.Errorf("scan branch: %w", err)
		}
		refs = append(refs, x)
	}
	rows.Close()
	projects := map[string]*Project{}
	for _, x := range refs {
		p := projects[x.project]
		if p == nil {
			if p, err = projectByID(ctx, a.pool, x.project); err != nil {
				return err
			}
			projects[x.project] = p
		}
		b, err := branchByID(ctx, a.pool, x.branch)
		if err != nil {
			return err
		}
		pv, err := a.computePreview(ctx, a.pool, p, b)
		if err != nil {
			return err
		}
		conflicts += pv.openConflicts()
		below += pv.BelowThreshold
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": out.Projects, "exact_matches_reused": out.Reused,
		"conflicts_open": conflicts, "below_threshold": below, "publishes_confirmed": out.Confirmed})
	return nil
}

// janitor deletes audit entries past retention and expired sessions.
func (a *App) janitor(ctx context.Context) {
	tick := time.NewTicker(5 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			sweep, cancel := context.WithTimeout(ctx, 30*time.Second)
			cutoff := time.Now().UTC().Add(-a.cfg.AuditRetention)
			if _, err := a.pool.Exec(sweep, "DELETE FROM audit WHERE at <= $1", cutoff); err != nil {
				log.Printf("expire audit entries: %v", err)
			}
			if _, err := a.pool.Exec(sweep, "DELETE FROM sessions WHERE expires_at <= $1", time.Now().UTC()); err != nil {
				log.Printf("expire sessions: %v", err)
			}
			cancel()
		}
	}
}
