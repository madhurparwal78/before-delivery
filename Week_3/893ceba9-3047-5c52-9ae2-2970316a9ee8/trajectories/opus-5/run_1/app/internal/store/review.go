package store

import (
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/marlowquill/interline-desk/internal/domain"
)

// InviteReviewer creates the reviewer account on the first invitation and
// widens an existing reviewer's scope on later ones.
func (s *Store) InviteReviewer(ctx context.Context, projectID, name, email string) (*User, string, bool, error) {
	var created bool
	var accessKey string
	user, err := s.UserByEmail(ctx, email)
	switch {
	case errors.Is(err, ErrNotFound):
		accessKey = "rvk_" + RandomToken(24)
		user = &User{ID: NewID(), Name: name, Email: email, Role: "reviewer"}
		if _, err := s.Pool.Exec(ctx, `insert into users (id, name, email, password_hash, role, created_at)
		        values ($1,$2,$3,$4,'reviewer',$5)`, user.ID, name, email, HashPassword(accessKey), Now()); err != nil {
			return nil, "", false, fmt.Errorf("create reviewer: %w", err)
		}
		created = true
	case err != nil:
		return nil, "", false, err
	}
	tag, err := s.Pool.Exec(ctx, `insert into reviewer_scopes (user_id, project_id) values ($1,$2)
	        on conflict do nothing`, user.ID, projectID)
	if err != nil {
		return nil, "", false, fmt.Errorf("widen reviewer scope: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return user, "", false, ErrReviewerExists
	}
	return user, accessKey, created, nil
}

// ErrReviewerExists means the email already has access to this project.
var ErrReviewerExists = errors.New("reviewer already has access")

func (s *Store) RemoveReviewer(ctx context.Context, projectID, reviewerID string) error {
	tag, err := s.Pool.Exec(ctx, `delete from reviewer_scopes where project_id = $1 and user_id = $2`,
		projectID, reviewerID)
	if err != nil {
		return fmt.Errorf("remove reviewer: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	if _, err := s.Pool.Exec(ctx, `update assignments set state = 'cancelled'
	        where project_id = $1 and reviewer_id = $2 and state = 'active'`, projectID, reviewerID); err != nil {
		return fmt.Errorf("cancel assignments: %w", err)
	}
	return nil
}

func reportedAssignmentState(state string, expires time.Time) string {
	if state == "active" && !expires.After(time.Now()) {
		return "expired"
	}
	return state
}

// CreateAssignment takes every unassigned segment that needs review on one
// branch and language. Of simultaneous requests exactly one gets the segments.
func (s *Store) CreateAssignment(ctx context.Context, project *Project, reviewerID, branchName, language string, ttl time.Duration) (*Assignment, error) {
	var assignment *Assignment
	err := s.InTx(ctx, func(tx pgx.Tx) error {
		hash := fnv.New32a()
		_, _ = hash.Write([]byte(project.ID + branchName + language))
		if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock($1)`, int64(hash.Sum32())); err != nil {
			return fmt.Errorf("lock assignment slot: %w", err)
		}
		rows, err := tx.Query(ctx, `select s.id from segments s
		        join branches b on b.id = s.branch_id
		        join keys k on k.branch_id = s.branch_id and k.key_id = s.key_id
		        where b.project_id = $1 and b.name = $2 and s.language = $3 and s.status = 'needs_review'
		          and not k.deleted
		          and s.id not in (select unnest(segment_ids) from assignments
		                           where project_id = $1 and state = 'active' and expires_at > now())
		        order by k.name`, project.ID, branchName, language)
		if err != nil {
			return fmt.Errorf("list reviewable segments: %w", err)
		}
		ids := []string{}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return fmt.Errorf("scan reviewable segment: %w", err)
			}
			ids = append(ids, id)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		if len(ids) == 0 {
			return ErrNoSegmentsToReview
		}
		assignment = &Assignment{ID: NewID(), ReviewerID: reviewerID, Branch: branchName, Language: language,
			SegmentIDs: ids, State: "active", ExpiresAt: Now().Add(ttl)}
		if _, err := tx.Exec(ctx, `insert into assignments (id, project_id, reviewer_id, branch, language,
		        segment_ids, state, expires_at, created_at) values ($1,$2,$3,$4,$5,$6,'active',$7,$8)`,
			assignment.ID, project.ID, reviewerID, branchName, language, ids, assignment.ExpiresAt,
			Now()); err != nil {
			return fmt.Errorf("create assignment: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return assignment, nil
}

// ErrNoSegmentsToReview means nothing was left to assign.
var ErrNoSegmentsToReview = errors.New("no segments to review")

func (s *Store) Assignments(ctx context.Context, projectID string) ([]Assignment, error) {
	rows, err := s.Pool.Query(ctx, `select id, reviewer_id, branch, language, segment_ids, state, expires_at
	        from assignments where project_id = $1 order by created_at desc`, projectID)
	if err != nil {
		return nil, fmt.Errorf("list assignments: %w", err)
	}
	defer rows.Close()
	out := []Assignment{}
	for rows.Next() {
		var a Assignment
		if err := rows.Scan(&a.ID, &a.ReviewerID, &a.Branch, &a.Language, &a.SegmentIDs, &a.State,
			&a.ExpiresAt); err != nil {
			return nil, fmt.Errorf("scan assignment: %w", err)
		}
		a.ExpiresAt = a.ExpiresAt.UTC()
		a.State = reportedAssignmentState(a.State, a.ExpiresAt)
		out = append(out, a)
	}
	return out, rows.Err()
}

// ActiveAssignmentOf finds the live assignment holding a segment for a reviewer.
func (s *Store) ActiveAssignmentOf(ctx context.Context, db DB, segmentID, reviewerID string) (*Assignment, error) {
	var a Assignment
	err := db.QueryRow(ctx, `select id, reviewer_id, branch, language, segment_ids, state, expires_at
	        from assignments where reviewer_id = $1 and state = 'active' and $2 = any(segment_ids)
	        order by created_at desc limit 1`, reviewerID, segmentID).
		Scan(&a.ID, &a.ReviewerID, &a.Branch, &a.Language, &a.SegmentIDs, &a.State, &a.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read assignment of segment: %w", err)
	}
	a.ExpiresAt = a.ExpiresAt.UTC()
	a.State = reportedAssignmentState(a.State, a.ExpiresAt)
	return &a, nil
}

// SegmentEverAssigned reports whether a reviewer was ever given a segment.
func (s *Store) SegmentEverAssigned(ctx context.Context, segmentID, reviewerID string) (bool, error) {
	var n int
	if err := s.Pool.QueryRow(ctx, `select count(*) from assignments where reviewer_id = $1
	        and $2 = any(segment_ids)`, reviewerID, segmentID).Scan(&n); err != nil {
		return false, fmt.Errorf("count assignments of segment: %w", err)
	}
	return n > 0, nil
}

// AssignmentsHolding lists the live assignments that hold a segment.
func (s *Store) AssignmentsHolding(ctx context.Context, db DB, segmentID string) ([]Assignment, error) {
	rows, err := db.Query(ctx, `select id, reviewer_id, branch, language, segment_ids, state, expires_at
	        from assignments where state = 'active' and $1 = any(segment_ids)`, segmentID)
	if err != nil {
		return nil, fmt.Errorf("list assignments holding segment: %w", err)
	}
	defer rows.Close()
	out := []Assignment{}
	for rows.Next() {
		var a Assignment
		if err := rows.Scan(&a.ID, &a.ReviewerID, &a.Branch, &a.Language, &a.SegmentIDs, &a.State,
			&a.ExpiresAt); err != nil {
			return nil, fmt.Errorf("scan assignment: %w", err)
		}
		a.ExpiresAt = a.ExpiresAt.UTC()
		out = append(out, a)
	}
	return out, rows.Err()
}

// CompleteAssignmentIfDone marks an assignment completed once every live
// segment in it is approved, reporting how many were approved.
func (s *Store) CompleteAssignmentIfDone(ctx context.Context, db DB, assignmentID string) (bool, int, error) {
	var ids []string
	var state string
	err := db.QueryRow(ctx, `select segment_ids, state from assignments where id = $1`, assignmentID).
		Scan(&ids, &state)
	if err != nil {
		return false, 0, fmt.Errorf("read assignment: %w", err)
	}
	if state != "active" {
		return false, 0, nil
	}
	rows, err := db.Query(ctx, `select s.status, k.deleted from segments s
	        join keys k on k.branch_id = s.branch_id and k.key_id = s.key_id
	        where s.id = any($1)`, ids)
	if err != nil {
		return false, 0, fmt.Errorf("read assignment segments: %w", err)
	}
	defer rows.Close()
	live, approved := 0, 0
	for rows.Next() {
		var status string
		var deleted bool
		if err := rows.Scan(&status, &deleted); err != nil {
			return false, 0, fmt.Errorf("scan assignment segment: %w", err)
		}
		if deleted {
			continue
		}
		live++
		if status == domain.StatusApproved {
			approved++
		}
	}
	if err := rows.Err(); err != nil {
		return false, 0, err
	}
	if live == 0 || approved < live {
		return false, approved, nil
	}
	if _, err := db.Exec(ctx, `update assignments set state = 'completed' where id = $1`, assignmentID); err != nil {
		return false, 0, fmt.Errorf("complete assignment: %w", err)
	}
	return true, approved, nil
}

func (s *Store) AssignmentByID(ctx context.Context, db DB, id string) (*Assignment, string, error) {
	var a Assignment
	var projectID string
	err := db.QueryRow(ctx, `select id, project_id, reviewer_id, branch, language, segment_ids, state, expires_at
	        from assignments where id = $1`, id).
		Scan(&a.ID, &projectID, &a.ReviewerID, &a.Branch, &a.Language, &a.SegmentIDs, &a.State, &a.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", ErrNotFound
	}
	if err != nil {
		return nil, "", fmt.Errorf("read assignment: %w", err)
	}
	a.ExpiresAt = a.ExpiresAt.UTC()
	return &a, projectID, nil
}

// ReviewQueue lists what a reviewer or the owner should work on.
func (s *Store) ReviewQueue(ctx context.Context, user *User, language string) ([]ReviewRow, error) {
	// The owner sees every segment that needs review plus whatever sits in an
	// active assignment; a reviewer sees only their own active assignments.
	query := `select s.id, p.slug, b.name, s.language, k.name, k.source, k.deleted, s.value, s.status, s.score,
	        a.id, a.expires_at
	        from segments s
	        join projects p on p.id = s.project_id
	        join branches b on b.id = s.branch_id
	        join keys k on k.branch_id = s.branch_id and k.key_id = s.key_id
	        left join assignments a on a.state = 'active' and a.expires_at > now() and s.id = any(a.segment_ids)
	        where (s.status = 'needs_review' or a.id is not null)
	          and (b.is_main or b.state in ('open','in_review'))`
	args := []any{}
	if user.Role == "reviewer" {
		args = append(args, user.ID)
		query = `select s.id, p.slug, b.name, s.language, k.name, k.source, k.deleted, s.value, s.status, s.score,
		        a.id, a.expires_at
		        from assignments a
		        join segments s on s.id = any(a.segment_ids)
		        join projects p on p.id = s.project_id
		        join branches b on b.id = s.branch_id
		        join keys k on k.branch_id = s.branch_id and k.key_id = s.key_id
		        where a.reviewer_id = $1 and a.state = 'active' and a.expires_at > now()`
	}
	if language != "" {
		args = append(args, language)
		query += fmt.Sprintf(" and s.language = $%d", len(args))
	}
	query += " order by p.slug, b.name, k.name"
	rows, err := s.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list review queue: %w", err)
	}
	defer rows.Close()
	out := []ReviewRow{}
	ids := []string{}
	index := map[string]int{}
	for rows.Next() {
		var row ReviewRow
		var deleted bool
		var source *string
		if err := rows.Scan(&row.SegmentID, &row.Project, &row.Branch, &row.Language, &row.Key, &source,
			&deleted, &row.Value, &row.Status, &row.Score, &row.AssignmentID, &row.ExpiresAt); err != nil {
			return nil, fmt.Errorf("scan review row: %w", err)
		}
		row.Removed = deleted
		if !deleted {
			row.Source = source
		}
		if row.ExpiresAt != nil {
			at := row.ExpiresAt.UTC()
			row.ExpiresAt = &at
		}
		row.Issues = []domain.Issue{}
		index[row.SegmentID] = len(out)
		out = append(out, row)
		ids = append(ids, row.SegmentID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return out, nil
	}
	issueRows, err := s.Pool.Query(ctx, `select segment_id, category, severity, note from segment_issues
	        where segment_id = any($1) order by ord`, ids)
	if err != nil {
		return nil, fmt.Errorf("list queue issues: %w", err)
	}
	defer issueRows.Close()
	for issueRows.Next() {
		var segmentID string
		var issue domain.Issue
		if err := issueRows.Scan(&segmentID, &issue.Category, &issue.Severity, &issue.Note); err != nil {
			return nil, fmt.Errorf("scan queue issue: %w", err)
		}
		if at, ok := index[segmentID]; ok {
			out[at].Issues = append(out[at].Issues, issue)
		}
	}
	return out, issueRows.Err()
}
