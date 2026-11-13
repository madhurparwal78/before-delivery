package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
)

type User struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
	Role  string `json:"role"`
}

type Project struct {
	ID              string
	Slug            string
	Name            string
	Client          string
	SourceLanguage  string
	TargetLanguages []string
	Repository      string
	MQMThreshold    int
	AIRoutes        map[string]string
	MainRev         int64
	CreatedAt       time.Time
}

func (p *Project) json() map[string]any {
	return map[string]any{
		"id": p.ID, "slug": p.Slug, "name": p.Name, "client": p.Client, "source_language": p.SourceLanguage,
		"target_languages": p.TargetLanguages, "repository": p.Repository, "mqm_threshold": p.MQMThreshold,
		"ai_routes": p.AIRoutes, "created_at": fmtTime(p.CreatedAt),
	}
}

const projectColumns = "id, slug, name, client, source_language, target_languages, repository, mqm_threshold, ai_routes, main_rev, created_at"

func scanProject(row pgx.Row) (*Project, error) {
	var p Project
	err := row.Scan(&p.ID, &p.Slug, &p.Name, &p.Client, &p.SourceLanguage, &p.TargetLanguages, &p.Repository,
		&p.MQMThreshold, &p.AIRoutes, &p.MainRev, &p.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func projectBySlug(ctx context.Context, q db, slug string) (*Project, error) {
	p, err := scanProject(q.QueryRow(ctx, "SELECT "+projectColumns+" FROM projects WHERE slug = $1", slug))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errNotFound()
	}
	if err != nil {
		return nil, fmt.Errorf("load project %q: %w", slug, err)
	}
	return p, nil
}

func projectByID(ctx context.Context, q db, id string) (*Project, error) {
	p, err := scanProject(q.QueryRow(ctx, "SELECT "+projectColumns+" FROM projects WHERE id = $1", id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errNotFound()
	}
	if err != nil {
		return nil, fmt.Errorf("load project %s: %w", id, err)
	}
	return p, nil
}

type Branch struct {
	ID        string
	ProjectID string
	Name      string
	State     string
	IsMain    bool
	CreatedAt time.Time
}

func (b *Branch) json() map[string]any {
	return map[string]any{"name": b.Name, "state": b.State, "is_main": b.IsMain, "created_at": fmtTime(b.CreatedAt)}
}

const (
	stateOpen      = "open"
	stateInReview  = "in_review"
	stateMerged    = "merged"
	stateAbandoned = "abandoned"
)

const branchColumns = "id, project_id, name, state, is_main, created_at"

func scanBranch(row pgx.Row) (*Branch, error) {
	var b Branch
	if err := row.Scan(&b.ID, &b.ProjectID, &b.Name, &b.State, &b.IsMain, &b.CreatedAt); err != nil {
		return nil, err
	}
	return &b, nil
}

func branchByName(ctx context.Context, q db, projectID, name string) (*Branch, error) {
	b, err := scanBranch(q.QueryRow(ctx, "SELECT "+branchColumns+" FROM branches WHERE project_id = $1 AND name = $2", projectID, name))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errNotFound()
	}
	if err != nil {
		return nil, fmt.Errorf("load branch %q: %w", name, err)
	}
	return b, nil
}

func branchByID(ctx context.Context, q db, id string) (*Branch, error) {
	b, err := scanBranch(q.QueryRow(ctx, "SELECT "+branchColumns+" FROM branches WHERE id = $1", id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errNotFound()
	}
	if err != nil {
		return nil, fmt.Errorf("load branch %s: %w", id, err)
	}
	return b, nil
}

func mainBranch(ctx context.Context, q db, projectID string) (*Branch, error) {
	b, err := scanBranch(q.QueryRow(ctx, "SELECT "+branchColumns+" FROM branches WHERE project_id = $1 AND is_main", projectID))
	if err != nil {
		return nil, fmt.Errorf("load main branch of %s: %w", projectID, err)
	}
	return b, nil
}

func listBranches(ctx context.Context, q db, projectID string) ([]*Branch, error) {
	rows, err := q.Query(ctx, "SELECT "+branchColumns+" FROM branches WHERE project_id = $1 ORDER BY is_main DESC, seq", projectID)
	if err != nil {
		return nil, fmt.Errorf("list branches: %w", err)
	}
	defer rows.Close()
	var out []*Branch
	for rows.Next() {
		b, err := scanBranch(rows)
		if err != nil {
			return nil, fmt.Errorf("scan branch: %w", err)
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// requireEditable is the branch-state rule for key edits, values, drafts and uploads: only `open` accepts them.
func (b *Branch) requireEditable() error {
	switch b.State {
	case stateOpen:
		return nil
	case stateInReview:
		return newErr(http.StatusConflict, "branch_not_open", "This branch is in review, so keys and translations are locked.")
	default:
		return b.errClosed()
	}
}

// requireLive is the rule for scoring, approving, holds and resolutions: `open` and `in_review` accept them.
func (b *Branch) requireLive() error {
	if b.State == stateMerged || b.State == stateAbandoned {
		return b.errClosed()
	}
	return nil
}

func (b *Branch) errClosed() error {
	return newErr(http.StatusConflict, "branch_closed", "This branch is merged or abandoned, so it can't change.")
}

// Key is one key as it stands on one branch.
type Key struct {
	ID      string
	Name    string
	Source  string
	Deleted bool
}

func liveKeys(ctx context.Context, q db, branchID string) ([]Key, error) {
	rows, err := q.Query(ctx, "SELECT key_id, name, source FROM branch_keys WHERE branch_id = $1 AND NOT deleted", branchID)
	if err != nil {
		return nil, fmt.Errorf("list keys: %w", err)
	}
	defer rows.Close()
	var keys []Key
	for rows.Next() {
		var k Key
		if err := rows.Scan(&k.ID, &k.Name, &k.Source); err != nil {
			return nil, fmt.Errorf("scan key: %w", err)
		}
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i].Name < keys[j].Name })
	return keys, rows.Err()
}

func keyOnBranch(ctx context.Context, q db, branchID, keyID string) (*Key, error) {
	var k Key
	err := q.QueryRow(ctx, "SELECT key_id, name, source, deleted FROM branch_keys WHERE branch_id = $1 AND key_id = $2", branchID, keyID).
		Scan(&k.ID, &k.Name, &k.Source, &k.Deleted)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errNotFound()
	}
	if err != nil {
		return nil, fmt.Errorf("load key: %w", err)
	}
	return &k, nil
}

func bumpMainRev(ctx context.Context, q db, projectID string) (int64, error) {
	var rev int64
	if err := q.QueryRow(ctx, "UPDATE projects SET main_rev = main_rev + 1 WHERE id = $1 RETURNING main_rev", projectID).Scan(&rev); err != nil {
		return 0, fmt.Errorf("bump main revision: %w", err)
	}
	return rev, nil
}

// touch records that main (or the TM) changed, which is what makes older operations unrestorable.
func touch(ctx context.Context, q db, projectID string, b *Branch) error {
	if b != nil && !b.IsMain {
		return nil
	}
	_, err := bumpMainRev(ctx, q, projectID)
	return err
}

func addRevision(ctx context.Context, q db, projectID, keyID, branch, field string, from, to *string, actor string) error {
	_, err := q.Exec(ctx, `INSERT INTO key_revisions (project_id, key_id, at, branch, field, from_value, to_value, actor)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, projectID, keyID, time.Now().UTC(), branch, field, from, to, actor)
	if err != nil {
		return fmt.Errorf("add %s revision: %w", field, err)
	}
	return nil
}
