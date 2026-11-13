package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/marlowquill/interline-desk/internal/domain"
)

type SegmentRevision struct {
	At    time.Time `json:"at"`
	Actor string    `json:"actor"`
	From  string    `json:"from"`
	To    string    `json:"to"`
	Value *string   `json:"value"`
}

// SegmentRecord is one segment with the key, branch and project around it.
type SegmentRecord struct {
	ID          string
	ProjectID   string
	ProjectSlug string
	BranchID    string
	BranchName  string
	BranchState string
	BranchMain  bool
	KeyID       string
	KeyName     string
	KeySource   string
	KeyDeleted  bool
	Language    string
	Value       *string
	Status      string
	Score       *int
	Origin      *string
	Issues      []domain.Issue
	Comments    []domain.Comment
	History     []SegmentRevision
}

const segmentSelect = `select s.id, s.project_id, p.slug, s.branch_id, b.name, b.state, b.is_main,
        s.key_id, k.name, k.source, k.deleted, s.language, s.value, s.status, s.score, s.origin
        from segments s
        join projects p on p.id = s.project_id
        join branches b on b.id = s.branch_id
        join keys k on k.branch_id = s.branch_id and k.key_id = s.key_id`

// Segment reads one segment with everything the editor shows.
func (s *Store) Segment(ctx context.Context, db DB, id string) (*SegmentRecord, error) {
	rec := &SegmentRecord{Issues: []domain.Issue{}, Comments: []domain.Comment{}, History: []SegmentRevision{}}
	err := db.QueryRow(ctx, segmentSelect+` where s.id = $1`, id).Scan(
		&rec.ID, &rec.ProjectID, &rec.ProjectSlug, &rec.BranchID, &rec.BranchName, &rec.BranchState,
		&rec.BranchMain, &rec.KeyID, &rec.KeyName, &rec.KeySource, &rec.KeyDeleted, &rec.Language,
		&rec.Value, &rec.Status, &rec.Score, &rec.Origin)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read segment: %w", err)
	}
	issues, err := s.SegmentIssues(ctx, db, id)
	if err != nil {
		return nil, err
	}
	rec.Issues = issues
	comments, err := s.SegmentComments(ctx, db, id)
	if err != nil {
		return nil, err
	}
	rec.Comments = comments
	rows, err := db.Query(ctx, `select at, actor, from_status, to_status, value from segment_history
	        where segment_id = $1 order by at, id`, id)
	if err != nil {
		return nil, fmt.Errorf("read segment history: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var rev SegmentRevision
		if err := rows.Scan(&rev.At, &rev.Actor, &rev.From, &rev.To, &rev.Value); err != nil {
			return nil, fmt.Errorf("scan segment revision: %w", err)
		}
		rev.At = rev.At.UTC()
		rec.History = append(rec.History, rev)
	}
	return rec, rows.Err()
}

func (s *Store) SegmentIssues(ctx context.Context, db DB, segmentID string) ([]domain.Issue, error) {
	rows, err := db.Query(ctx, `select category, severity, note from segment_issues
	        where segment_id = $1 order by ord`, segmentID)
	if err != nil {
		return nil, fmt.Errorf("read issues: %w", err)
	}
	defer rows.Close()
	issues := []domain.Issue{}
	for rows.Next() {
		var issue domain.Issue
		if err := rows.Scan(&issue.Category, &issue.Severity, &issue.Note); err != nil {
			return nil, fmt.Errorf("scan issue: %w", err)
		}
		issues = append(issues, issue)
	}
	return issues, rows.Err()
}

func (s *Store) SegmentComments(ctx context.Context, db DB, segmentID string) ([]domain.Comment, error) {
	rows, err := db.Query(ctx, `select id, author, body, at from segment_comments
	        where segment_id = $1 order by at, id`, segmentID)
	if err != nil {
		return nil, fmt.Errorf("read comments: %w", err)
	}
	defer rows.Close()
	comments := []domain.Comment{}
	for rows.Next() {
		var comment domain.Comment
		if err := rows.Scan(&comment.ID, &comment.Author, &comment.Body, &comment.At); err != nil {
			return nil, fmt.Errorf("scan comment: %w", err)
		}
		comment.At = comment.At.UTC()
		comments = append(comments, comment)
	}
	return comments, rows.Err()
}

// WriteSegment stores a segment's value, status, score and origin.
func (s *Store) WriteSegment(ctx context.Context, db DB, id string, value *string, status string, score *int, origin *string) error {
	if _, err := db.Exec(ctx, `update segments set value = $2, status = $3, score = $4, origin = $5
	        where id = $1`, id, value, status, score, origin); err != nil {
		return fmt.Errorf("write segment: %w", err)
	}
	return nil
}

func (s *Store) SetSegmentStatus(ctx context.Context, db DB, id, status string) error {
	if _, err := db.Exec(ctx, `update segments set status = $2 where id = $1`, id, status); err != nil {
		return fmt.Errorf("set segment status: %w", err)
	}
	return nil
}

// ReplaceIssues writes a segment's issue list.
func (s *Store) ReplaceIssues(ctx context.Context, db DB, segmentID string, issues []domain.Issue) error {
	if _, err := db.Exec(ctx, `delete from segment_issues where segment_id = $1`, segmentID); err != nil {
		return fmt.Errorf("clear issues: %w", err)
	}
	for i, issue := range issues {
		if _, err := db.Exec(ctx, `insert into segment_issues (id, segment_id, ord, category, severity, note)
		        values ($1,$2,$3,$4,$5,$6)`, NewID(), segmentID, i, issue.Category, issue.Severity, issue.Note); err != nil {
			return fmt.Errorf("write issue: %w", err)
		}
	}
	return nil
}

func (s *Store) AddComment(ctx context.Context, db DB, segmentID, author, body string, at time.Time) (domain.Comment, error) {
	comment := domain.Comment{ID: NewID(), Author: author, Body: body, At: at}
	if _, err := db.Exec(ctx, `insert into segment_comments (id, segment_id, author, body, at)
	        values ($1,$2,$3,$4,$5)`, comment.ID, segmentID, author, body, at); err != nil {
		return comment, fmt.Errorf("add comment: %w", err)
	}
	return comment, nil
}

// KeyRevisions reads a key's history across every branch, in time order.
func (s *Store) KeyRevisions(ctx context.Context, projectID, keyID string) ([]map[string]any, error) {
	rows, err := s.Pool.Query(ctx, `select at, branch, field, from_value, to_value, actor from key_history
	        where project_id = $1 and key_id = $2 order by at, id`, projectID, keyID)
	if err != nil {
		return nil, fmt.Errorf("read key history: %w", err)
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var at time.Time
		var branch, field, actor string
		var from, to *string
		if err := rows.Scan(&at, &branch, &field, &from, &to, &actor); err != nil {
			return nil, fmt.Errorf("scan key revision: %w", err)
		}
		out = append(out, map[string]any{"at": at.UTC(), "branch": branch, "field": field,
			"from": from, "to": to, "actor": actor})
	}
	return out, rows.Err()
}

// KeyExists reports whether a key id is known to the project at all.
func (s *Store) KeyExists(ctx context.Context, projectID, keyID string) (bool, error) {
	var n int
	if err := s.Pool.QueryRow(ctx, `select count(*) from keys where project_id = $1 and key_id = $2`,
		projectID, keyID).Scan(&n); err != nil {
		return false, fmt.Errorf("count key: %w", err)
	}
	return n > 0, nil
}

// SegmentByKeyLanguage finds one segment of a key on a branch.
func (s *Store) SegmentByKeyLanguage(ctx context.Context, db DB, branchID, keyID, language string) (*SegmentRecord, error) {
	var id string
	err := db.QueryRow(ctx, `select id from segments where branch_id = $1 and key_id = $2 and language = $3`,
		branchID, keyID, language).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("find segment: %w", err)
	}
	return s.Segment(ctx, db, id)
}
