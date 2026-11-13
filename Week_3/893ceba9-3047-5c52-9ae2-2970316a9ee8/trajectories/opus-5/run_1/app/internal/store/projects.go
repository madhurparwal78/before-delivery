package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/marlowquill/interline-desk/internal/domain"
)

// ErrNotFound is returned when a record the caller named does not exist.
var ErrNotFound = errors.New("not found")

const projectColumns = `id, slug, name, client, source_language, target_languages, repository, mqm_threshold, ai_routes, created_at, change_seq`

func scanProject(row pgx.Row) (*Project, error) {
	p := &Project{}
	var routes []byte
	err := row.Scan(&p.ID, &p.Slug, &p.Name, &p.Client, &p.SourceLanguage, &p.TargetLanguages,
		&p.Repository, &p.MQMThreshold, &routes, &p.CreatedAt, &p.ChangeSeq)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("scan project: %w", err)
	}
	if err := json.Unmarshal(routes, &p.AIRoutes); err != nil {
		return nil, fmt.Errorf("decode ai routes: %w", err)
	}
	p.CreatedAt = p.CreatedAt.UTC()
	return p, nil
}

func (s *Store) ProjectBySlug(ctx context.Context, db DB, slug string) (*Project, error) {
	return scanProject(db.QueryRow(ctx, `select `+projectColumns+` from projects where slug = $1`, slug))
}

func (s *Store) ProjectByID(ctx context.Context, db DB, id string) (*Project, error) {
	return scanProject(db.QueryRow(ctx, `select `+projectColumns+` from projects where id = $1`, id))
}

func (s *Store) Projects(ctx context.Context, user *User) ([]*Project, error) {
	query := `select ` + projectColumns + ` from projects order by created_at`
	args := []any{}
	if user.Role == "reviewer" {
		query = `select ` + projectColumns + ` from projects
		         where id in (select project_id from reviewer_scopes where user_id = $1)
		         order by created_at`
		args = append(args, user.ID)
	}
	rows, err := s.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list projects: %w", err)
	}
	defer rows.Close()
	var out []*Project
	for rows.Next() {
		p, err := scanProject(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) InsertProject(ctx context.Context, db DB, p *Project) error {
	routes, err := json.Marshal(p.AIRoutes)
	if err != nil {
		return fmt.Errorf("encode ai routes: %w", err)
	}
	_, err = db.Exec(ctx, `insert into projects (id, slug, name, client, source_language, target_languages,
	        repository, mqm_threshold, ai_routes, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		p.ID, p.Slug, p.Name, p.Client, p.SourceLanguage, p.TargetLanguages, p.Repository,
		p.MQMThreshold, routes, p.CreatedAt)
	if err != nil {
		return fmt.Errorf("insert project: %w", err)
	}
	return nil
}

// BumpChangeSeq marks main or the translation memory as changed, which is what
// decides whether an earlier operation can still be restored exactly.
func (s *Store) BumpChangeSeq(ctx context.Context, db DB, projectID string) (int64, error) {
	var seq int64
	err := db.QueryRow(ctx, `update projects set change_seq = change_seq + 1 where id = $1 returning change_seq`,
		projectID).Scan(&seq)
	if err != nil {
		return 0, fmt.Errorf("bump change sequence: %w", err)
	}
	return seq, nil
}

func (s *Store) ChangeSeq(ctx context.Context, db DB, projectID string) (int64, error) {
	var seq int64
	if err := db.QueryRow(ctx, `select change_seq from projects where id = $1`, projectID).Scan(&seq); err != nil {
		return 0, fmt.Errorf("read change sequence: %w", err)
	}
	return seq, nil
}

// Branches lists every branch of a project, main first, then creation order.
func (s *Store) Branches(ctx context.Context, db DB, projectID string) ([]*Branch, error) {
	rows, err := db.Query(ctx, `select id, project_id, name, state, is_main, created_at from branches
	        where project_id = $1 order by is_main desc, created_at`, projectID)
	if err != nil {
		return nil, fmt.Errorf("list branches: %w", err)
	}
	defer rows.Close()
	var out []*Branch
	for rows.Next() {
		b := &Branch{}
		if err := rows.Scan(&b.ID, &b.ProjectID, &b.Name, &b.State, &b.IsMain, &b.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan branch: %w", err)
		}
		b.CreatedAt = b.CreatedAt.UTC()
		out = append(out, b)
	}
	return out, rows.Err()
}

func (s *Store) BranchByName(ctx context.Context, db DB, projectID, name string) (*Branch, error) {
	b := &Branch{}
	var base []byte
	err := db.QueryRow(ctx, `select id, project_id, name, state, is_main, created_at, base from branches
	        where project_id = $1 and name = $2`, projectID, name).
		Scan(&b.ID, &b.ProjectID, &b.Name, &b.State, &b.IsMain, &b.CreatedAt, &base)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read branch: %w", err)
	}
	b.CreatedAt = b.CreatedAt.UTC()
	if len(base) > 0 {
		if err := json.Unmarshal(base, &b.Base); err != nil {
			return nil, fmt.Errorf("decode branch base: %w", err)
		}
	}
	return b, nil
}

func (s *Store) InsertBranch(ctx context.Context, db DB, b *Branch) error {
	base, err := json.Marshal(b.Base)
	if err != nil {
		return fmt.Errorf("encode branch base: %w", err)
	}
	if _, err := db.Exec(ctx, `insert into branches (id, project_id, name, state, is_main, base, created_at)
	        values ($1,$2,$3,$4,$5,$6,$7)`, b.ID, b.ProjectID, b.Name, b.State, b.IsMain, base, b.CreatedAt); err != nil {
		return fmt.Errorf("insert branch: %w", err)
	}
	return nil
}

func (s *Store) SetBranchState(ctx context.Context, db DB, branchID, state string) error {
	if _, err := db.Exec(ctx, `update branches set state = $2 where id = $1`, branchID, state); err != nil {
		return fmt.Errorf("set branch state: %w", err)
	}
	return nil
}

// OpenBranchCount counts the feature branches that hold a slot of the five.
func (s *Store) OpenBranchCount(ctx context.Context, db DB, projectID string) (int, error) {
	var n int
	err := db.QueryRow(ctx, `select count(*) from branches where project_id = $1 and not is_main
	        and state in ('open','in_review')`, projectID).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("count open branches: %w", err)
	}
	return n, nil
}

// LoadKeySet reads a branch's live working copy.
func (s *Store) LoadKeySet(ctx context.Context, db DB, branchID string) (domain.KeySet, error) {
	set := domain.KeySet{}
	rows, err := db.Query(ctx, `select key_id, name, source from keys where branch_id = $1 and not deleted`, branchID)
	if err != nil {
		return nil, fmt.Errorf("load keys: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		k := &domain.Key{Segments: map[string]*domain.Segment{}}
		if err := rows.Scan(&k.KeyID, &k.Name, &k.Source); err != nil {
			return nil, fmt.Errorf("scan key: %w", err)
		}
		set[k.KeyID] = k
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	segments, err := s.loadSegments(ctx, db, branchID)
	if err != nil {
		return nil, err
	}
	for keyID, byLang := range segments {
		if k, ok := set[keyID]; ok {
			k.Segments = byLang
		}
	}
	return set, nil
}

func (s *Store) loadSegments(ctx context.Context, db DB, branchID string) (map[string]map[string]*domain.Segment, error) {
	rows, err := db.Query(ctx, `select id, key_id, language, value, status, score, origin from segments
	        where branch_id = $1`, branchID)
	if err != nil {
		return nil, fmt.Errorf("load segments: %w", err)
	}
	defer rows.Close()
	out := map[string]map[string]*domain.Segment{}
	ids := []string{}
	index := map[string]*domain.Segment{}
	for rows.Next() {
		seg := &domain.Segment{Issues: []domain.Issue{}, Comments: []domain.Comment{}}
		var keyID string
		if err := rows.Scan(&seg.ID, &keyID, &seg.Language, &seg.Value, &seg.Status, &seg.Score, &seg.Origin); err != nil {
			return nil, fmt.Errorf("scan segment: %w", err)
		}
		if out[keyID] == nil {
			out[keyID] = map[string]*domain.Segment{}
		}
		out[keyID][seg.Language] = seg
		ids = append(ids, seg.ID)
		index[seg.ID] = seg
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return out, nil
	}
	issueRows, err := db.Query(ctx, `select segment_id, category, severity, note from segment_issues
	        where segment_id = any($1) order by ord`, ids)
	if err != nil {
		return nil, fmt.Errorf("load issues: %w", err)
	}
	defer issueRows.Close()
	for issueRows.Next() {
		var segmentID string
		var issue domain.Issue
		if err := issueRows.Scan(&segmentID, &issue.Category, &issue.Severity, &issue.Note); err != nil {
			return nil, fmt.Errorf("scan issue: %w", err)
		}
		if seg, ok := index[segmentID]; ok {
			seg.Issues = append(seg.Issues, issue)
		}
	}
	if err := issueRows.Err(); err != nil {
		return nil, err
	}
	commentRows, err := db.Query(ctx, `select segment_id, id, author, body, at from segment_comments
	        where segment_id = any($1) order by at, id`, ids)
	if err != nil {
		return nil, fmt.Errorf("load comments: %w", err)
	}
	defer commentRows.Close()
	for commentRows.Next() {
		var segmentID string
		var c domain.Comment
		if err := commentRows.Scan(&segmentID, &c.ID, &c.Author, &c.Body, &c.At); err != nil {
			return nil, fmt.Errorf("scan comment: %w", err)
		}
		c.At = c.At.UTC()
		if seg, ok := index[segmentID]; ok {
			seg.Comments = append(seg.Comments, c)
		}
	}
	return out, commentRows.Err()
}

// InsertKey writes one key with one untranslated segment per target language.
func (s *Store) InsertKey(ctx context.Context, db DB, p *Project, branchID, keyID, name, source string) error {
	if _, err := db.Exec(ctx, `insert into keys (id, project_id, branch_id, key_id, name, source)
	        values ($1,$2,$3,$4,$5,$6)`, NewID(), p.ID, branchID, keyID, name, source); err != nil {
		return fmt.Errorf("insert key: %w", err)
	}
	for _, lang := range p.TargetLanguages {
		if _, err := db.Exec(ctx, `insert into segments (id, project_id, branch_id, key_id, language, status)
		        values ($1,$2,$3,$4,$5,'untranslated')`, NewID(), p.ID, branchID, keyID, lang); err != nil {
			return fmt.Errorf("insert segment: %w", err)
		}
	}
	return nil
}

// AddKeyRevision records one revision in a key's history.
func (s *Store) AddKeyRevision(ctx context.Context, db DB, projectID, keyID, branch, field string, from, to *string, actor string, at time.Time) error {
	if _, err := db.Exec(ctx, `insert into key_history (project_id, key_id, at, branch, field, from_value, to_value, actor)
	        values ($1,$2,$3,$4,$5,$6,$7,$8)`, projectID, keyID, at, branch, field, from, to, actor); err != nil {
		return fmt.Errorf("insert key revision: %w", err)
	}
	return nil
}

// AddSegmentRevision records one status move in a segment's history.
func (s *Store) AddSegmentRevision(ctx context.Context, db DB, segmentID, actor, from, to string, value *string, at time.Time) error {
	if _, err := db.Exec(ctx, `insert into segment_history (segment_id, at, actor, from_status, to_status, value)
	        values ($1,$2,$3,$4,$5,$6)`, segmentID, at, actor, from, to, value); err != nil {
		return fmt.Errorf("insert segment revision: %w", err)
	}
	return nil
}

// AddAudit writes the one audit entry a state change owes.
func (s *Store) AddAudit(ctx context.Context, db DB, actor, action, projectSlug, detail string, projectID *string) error {
	if _, err := db.Exec(ctx, `insert into audit (id, at, actor, action, project, detail, project_id)
	        values ($1,$2,$3,$4,$5,$6,$7)`, NewID(), Now(), actor, action, projectSlug, detail, projectID); err != nil {
		return fmt.Errorf("insert audit entry: %w", err)
	}
	return nil
}
