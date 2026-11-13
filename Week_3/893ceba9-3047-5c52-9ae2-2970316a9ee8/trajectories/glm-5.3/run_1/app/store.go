package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/lib/pq"
)

type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) *Store { return &Store{db: db} }

// ---- records ----

type Project struct {
	ID              string            `json:"id"`
	Slug            string            `json:"slug"`
	Name            string            `json:"name"`
	Client          string            `json:"client"`
	SourceLanguage  string            `json:"source_language"`
	TargetLanguages []string          `json:"target_languages"`
	Repository      string            `json:"repository"`
	MqmThreshold    int               `json:"mqm_threshold"`
	AiRoutes        map[string]string `json:"ai_routes"`
	CreatedAt       time.Time         `json:"created_at"`
}

func (p *Project) scan(s rowScanner) error {
	var routesRaw []byte
	err := s.Scan(&p.ID, &p.Slug, &p.Name, &p.Client, &p.SourceLanguage,
		pq.Array(&p.TargetLanguages), &p.Repository, &p.MqmThreshold, &routesRaw, &p.CreatedAt)
	if err != nil {
		return err
	}
	p.AiRoutes = map[string]string{}
	if len(routesRaw) > 0 {
		_ = json.Unmarshal(routesRaw, &p.AiRoutes)
	}
	return nil
}

type rowScanner interface{ Scan(dest ...any) error }

const projectCols = `id, slug, name, client, source_language, target_languages, repository, mqm_threshold, ai_routes, created_at`

func (s *Store) ProjectBySlug(ctx context.Context, slug string) (*Project, error) {
	row := s.db.QueryRowContext(ctx, `SELECT `+projectCols+` FROM projects WHERE slug = $1`, slug)
	var p Project
	if err := p.scan(row); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}

func (s *Store) ProjectsForOwner(ctx context.Context) ([]*Project, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+projectCols+` FROM projects ORDER BY created_at, slug`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []*Project
	for rows.Next() {
		var p Project
		if err := p.scan(rows); err != nil {
			return nil, err
		}
		out = append(out, &p)
	}
	return out, rows.Err()
}

func (s *Store) ProjectsForReviewer(ctx context.Context, reviewerID string) ([]*Project, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+projectColsFromScope()+` FROM projects p
		JOIN reviewer_scopes rs ON rs.project_id = p.id WHERE rs.reviewer_id = $1 ORDER BY p.created_at, p.slug`, reviewerID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []*Project
	for rows.Next() {
		var p Project
		if err := p.scan(rows); err != nil {
			return nil, err
		}
		out = append(out, &p)
	}
	return out, rows.Err()
}

func projectColsFromScope() string { return projectCols }

type Branch struct {
	Name      string    `json:"name"`
	State     string    `json:"state"`
	IsMain    bool      `json:"is_main"`
	CreatedAt time.Time `json:"created_at"`
}

func (s *Store) Branches(ctx context.Context, projectID string) ([]*Branch, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT name, state, is_main, created_at FROM branches WHERE project_id = $1
		ORDER BY is_main DESC, created_at, name`, projectID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []*Branch
	for rows.Next() {
		var b Branch
		if err := rows.Scan(&b.Name, &b.State, &b.IsMain, &b.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, &b)
	}
	return out, rows.Err()
}

func (s *Store) BranchByName(ctx context.Context, projectID, name string) (*Branch, string, error) {
	var b Branch
	var id string
	err := s.db.QueryRowContext(ctx, `SELECT id, name, state, is_main, created_at FROM branches WHERE project_id = $1 AND name = $2`,
		projectID, name).Scan(&id, &b.Name, &b.State, &b.IsMain, &b.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, "", nil
	}
	if err != nil {
		return nil, "", err
	}
	return &b, id, nil
}

type KeyRow struct {
	ID     string
	Name   string
	Source string
}

func (s *Store) KeysByBranch(ctx context.Context, branchID string) ([]*KeyRow, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, source FROM keys WHERE branch_id = $1 AND NOT deleted ORDER BY name`, branchID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []*KeyRow
	for rows.Next() {
		var k KeyRow
		if err := rows.Scan(&k.ID, &k.Name, &k.Source); err != nil {
			return nil, err
		}
		out = append(out, &k)
	}
	return out, rows.Err()
}

type SegmentRow struct {
	ID       string
	KeyID    string
	Language string
	Value    *string
	Status   string
	Score    *int
	Origin   *string
	Issues   []byte
}

func (s *Store) SegmentsByBranch(ctx context.Context, branchID string) ([]*SegmentRow, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, key_id, language, value, status, score, origin, issues FROM segments WHERE branch_id = $1`, branchID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []*SegmentRow
	for rows.Next() {
		var r SegmentRow
		if err := rows.Scan(&r.ID, &r.KeyID, &r.Language, &r.Value, &r.Status, &r.Score, &r.Origin, &r.Issues); err != nil {
			return nil, err
		}
		out = append(out, &r)
	}
	return out, rows.Err()
}

func (s *Store) AuditInsert(ctx context.Context, actor, action, project, detail string) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO audit_log (id, at, actor, action, project, detail) VALUES ($1, now(), $2, $3, $4, $5)`,
		newUUID(), actor, action, project, detail)
	return err
}

func (s *Store) AuditList(ctx context.Context, before time.Time) ([]map[string]any, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, at, actor, action, project, detail FROM audit_log WHERE at >= $1 ORDER BY at DESC LIMIT 500`, before)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []map[string]any
	for rows.Next() {
		var id string
		var at time.Time
		var actor, action, project, detail string
		if err := rows.Scan(&id, &at, &actor, &action, &project, &detail); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "at": at.UTC().Format(time.RFC3339), "actor": actor,
			"action": action, "project": project, "detail": detail,
		})
	}
	return out, rows.Err()
}

// WorkspaceStats computes the dashboard figures.
func (s *Store) WorkspaceStats(ctx context.Context) (map[string]any, error) {
	var projects, tmReused, conflictsOpen, belowThreshold, publishesConfirmed int

	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM projects`).Scan(&projects); err != nil {
		return nil, err
	}
	if err := s.db.QueryRowContext(ctx, `
		SELECT count(*) FROM segments seg
		JOIN branches b ON b.id = seg.branch_id
		JOIN keys k ON k.id = seg.key_id AND k.branch_id = seg.branch_id AND NOT k.deleted
		WHERE seg.origin = 'tm' AND seg.value IS NOT NULL
	`).Scan(&tmReused); err != nil {
		return nil, err
	}
	if err := s.db.QueryRowContext(ctx, `
		SELECT count(*) FROM conflicts c
		WHERE c.resolution IS NULL
		AND c.branch_id IN (SELECT id FROM branches WHERE state IN ('open','in_review'))
	`).Scan(&conflictsOpen); err != nil {
		return nil, err
	}
	if err := s.db.QueryRowContext(ctx, `
		SELECT count(*) FROM segments seg
		JOIN branches b ON b.id = seg.branch_id
		JOIN keys k ON k.id = seg.key_id AND k.branch_id = seg.branch_id AND NOT k.deleted
		JOIN projects p ON p.id = seg.project_id
		WHERE seg.score IS NOT NULL AND seg.score < p.mqm_threshold
		AND (b.is_main = true OR b.state IN ('open','in_review'))
	`).Scan(&belowThreshold); err != nil {
		return nil, err
	}
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM publishes WHERE state = 'published'`).Scan(&publishesConfirmed); err != nil {
		return nil, err
	}
	return map[string]any{
		"projects": projects, "exact_matches_reused": tmReused,
		"conflicts_open": conflictsOpen, "below_threshold": belowThreshold,
		"publishes_confirmed": publishesConfirmed,
	}, nil
}

func fmtTime(t time.Time) string { return t.UTC().Format(time.RFC3339) }

// mainBranchID resolves the project's main branch id.
func mainBranchID(ctx context.Context, db *sql.DB, projectID string) string {
	var id string
	_ = db.QueryRowContext(ctx, `SELECT id FROM branches WHERE project_id = $1 AND is_main`, projectID).Scan(&id)
	return id
}

func (s *Store) withTx(ctx context.Context, fn func(tx *sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

var errConcurrent = fmt.Errorf("concurrent change")
