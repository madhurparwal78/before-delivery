package main

import (
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
)

var emailPattern = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

func (a *App) handleReviewers(w http.ResponseWriter, r *http.Request) error {
	_, p, err := a.ownerProject(r)
	if err != nil {
		return err
	}
	rows, err := a.pool.Query(r.Context(), `SELECT u.id, u.name, u.email FROM users u JOIN reviewer_scopes s ON s.user_id = u.id
		WHERE s.project_id = $1 ORDER BY u.created_at, u.email`, p.ID)
	if err != nil {
		return fmt.Errorf("list reviewers: %w", err)
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, name, email string
		if err := rows.Scan(&id, &name, &email); err != nil {
			return fmt.Errorf("scan reviewer: %w", err)
		}
		out = append(out, map[string]any{"id": id, "name": name, "email": email})
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read rows: %w", err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"reviewers": out})
	return nil
}

func (a *App) handleInvite(w http.ResponseWriter, r *http.Request) error {
	pr, p, err := a.ownerProject(r)
	if err != nil {
		return err
	}
	var in struct {
		Name  string `json:"name"`
		Email string `json:"email"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	ctx := r.Context()
	status := http.StatusCreated
	var out map[string]any
	err = a.inProject(ctx, p.ID, func(tx pgx.Tx) error {
		var id string
		err := tx.QueryRow(ctx, "SELECT id FROM users WHERE lower(email) = lower($1)", in.Email).Scan(&id)
		known := err == nil
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("look up reviewer: %w", err)
		}
		if known {
			var role string
			var inScope int
			if err := tx.QueryRow(ctx, "SELECT u.role, (SELECT count(*) FROM reviewer_scopes s WHERE s.user_id = u.id AND s.project_id = $2) FROM users u WHERE u.id = $1", id, p.ID).Scan(&role, &inScope); err != nil {
				return fmt.Errorf("check reviewer scope: %w", err)
			}
			if inScope > 0 || role != roleReviewer {
				return newErr(http.StatusConflict, "reviewer_exists", "That reviewer already has access to this project.")
			}
		}
		fields := map[string]string{}
		if e := validName("name", in.Name); e != nil {
			fields["name"] = e.Fields["name"]
		}
		if !emailPattern.MatchString(in.Email) || len(in.Email) > 200 {
			fields["email"] = "Enter an email address."
		}
		if len(fields) > 0 {
			return errValidation(fields)
		}
		var accessKey any
		if known {
			status = http.StatusOK
		} else {
			key := "rvk_" + randomString(24)
			hash, err := hashPassword(key)
			if err != nil {
				return err
			}
			id = newID()
			if _, err := tx.Exec(ctx, "INSERT INTO users (id, name, email, role, password_hash, created_at) VALUES ($1, $2, $3, 'reviewer', $4, $5)",
				id, in.Name, in.Email, hash, time.Now().UTC()); err != nil {
				return fmt.Errorf("create reviewer: %w", err)
			}
			accessKey = key
		}
		if _, err := tx.Exec(ctx, "INSERT INTO reviewer_scopes (user_id, project_id) VALUES ($1, $2)", id, p.ID); err != nil {
			return fmt.Errorf("add reviewer scope: %w", err)
		}
		var name string
		if err := tx.QueryRow(ctx, "SELECT name FROM users WHERE id = $1", id).Scan(&name); err != nil {
			return fmt.Errorf("load reviewer: %w", err)
		}
		out = map[string]any{"id": id, "name": name, "email": in.Email, "access_key": accessKey}
		action := "reviewer.invited"
		if known {
			action = "reviewer.added"
		}
		return a.audit(ctx, tx, pr.Email, action, p, in.Email)
	})
	if err != nil {
		return err
	}
	writeJSON(w, status, out)
	return nil
}

func (a *App) handleRemoveReviewer(w http.ResponseWriter, r *http.Request) error {
	pr, p, err := a.ownerProject(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	id := r.PathValue("id")
	err = a.inProject(ctx, p.ID, func(tx pgx.Tx) error {
		var email string
		err := tx.QueryRow(ctx, "SELECT u.email FROM users u JOIN reviewer_scopes s ON s.user_id = u.id WHERE u.id = $1 AND s.project_id = $2", id, p.ID).Scan(&email)
		if errors.Is(err, pgx.ErrNoRows) {
			return errNotFound()
		}
		if err != nil {
			return fmt.Errorf("load reviewer: %w", err)
		}
		if _, err := tx.Exec(ctx, "DELETE FROM reviewer_scopes WHERE user_id = $1 AND project_id = $2", id, p.ID); err != nil {
			return fmt.Errorf("remove reviewer scope: %w", err)
		}
		if _, err := tx.Exec(ctx, "UPDATE assignments SET state = 'cancelled' WHERE reviewer_id = $1 AND project_id = $2 AND state = 'active'", id, p.ID); err != nil {
			return fmt.Errorf("cancel assignments: %w", err)
		}
		return a.audit(ctx, tx, pr.Email, "reviewer.removed", p, email)
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (a *App) assignmentJSON(id, reviewerID, branch, language, state string, expires time.Time, segmentIDs []string) map[string]any {
	if state == "active" && !expires.After(time.Now().UTC()) {
		state = "expired"
	}
	return map[string]any{"id": id, "reviewer_id": reviewerID, "branch": branch, "language": language,
		"segment_ids": segmentIDs, "state": state, "expires_at": fmtTime(expires)}
}

func (a *App) handleAssign(w http.ResponseWriter, r *http.Request) error {
	pr, p, err := a.ownerProject(r)
	if err != nil {
		return err
	}
	var in struct {
		ReviewerID string `json:"reviewer_id"`
		Branch     string `json:"branch"`
		Language   string `json:"language"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	ctx := r.Context()
	var out map[string]any
	err = a.inProject(ctx, p.ID, func(tx pgx.Tx) error {
		b, err := branchByName(ctx, tx, p.ID, in.Branch)
		if err != nil {
			return err
		}
		if err := b.requireLive(); err != nil {
			return err
		}
		fields := map[string]string{}
		var scoped int
		if err := tx.QueryRow(ctx, "SELECT count(*) FROM reviewer_scopes WHERE user_id = $1 AND project_id = $2", in.ReviewerID, p.ID).Scan(&scoped); err != nil {
			return fmt.Errorf("check reviewer: %w", err)
		}
		if scoped == 0 {
			fields["reviewer_id"] = "Choose a reviewer invited to this project."
		}
		if !slices.Contains(p.TargetLanguages, in.Language) {
			fields["language"] = "Choose one of the project's target languages."
		}
		if len(fields) > 0 {
			return errValidation(fields)
		}
		at := now()
		rows, err := tx.Query(ctx, `SELECT s.id FROM segments s JOIN branch_keys k ON k.branch_id = s.branch_id AND k.key_id = s.key_id
			WHERE s.branch_id = $1 AND s.language = $2 AND s.status = 'needs_review' AND NOT k.deleted
			AND NOT EXISTS (SELECT 1 FROM assignment_segments x JOIN assignments a ON a.id = x.assignment_id
				WHERE x.segment_id = s.id AND a.state = 'active' AND a.expires_at > $3)
			ORDER BY k.name`, b.ID, in.Language, at)
		if err != nil {
			return fmt.Errorf("find segments to review: %w", err)
		}
		var ids []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return fmt.Errorf("scan segment: %w", err)
			}
			ids = append(ids, id)
		}
		rows.Close()
		if len(ids) == 0 {
			return newErr(http.StatusConflict, "no_segments_to_review", "There are no unassigned segments that need review in "+in.Language+" on "+b.Name+".")
		}
		id, expires := newID(), at.Add(a.cfg.AssignmentTTL)
		if _, err := tx.Exec(ctx, `INSERT INTO assignments (id, project_id, reviewer_id, branch_id, language, state, expires_at, created_at)
			VALUES ($1, $2, $3, $4, $5, 'active', $6, $7)`, id, p.ID, in.ReviewerID, b.ID, in.Language, expires, at); err != nil {
			return fmt.Errorf("create assignment: %w", err)
		}
		for _, sid := range ids {
			if _, err := tx.Exec(ctx, "INSERT INTO assignment_segments (assignment_id, segment_id) VALUES ($1, $2)", id, sid); err != nil {
				return fmt.Errorf("assign segment: %w", err)
			}
		}
		out = a.assignmentJSON(id, in.ReviewerID, b.Name, in.Language, "active", expires, ids)
		return a.audit(ctx, tx, pr.Email, "assignment.created", p, fmt.Sprintf("%s (%s): %d segments", b.Name, in.Language, len(ids)))
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, out)
	return nil
}

func (a *App) handleAssignments(w http.ResponseWriter, r *http.Request) error {
	_, p, err := a.ownerProject(r)
	if err != nil {
		return err
	}
	rows, err := a.pool.Query(r.Context(), `SELECT a.id, a.reviewer_id, b.name, a.language, a.state, a.expires_at,
		coalesce((SELECT array_agg(x.segment_id ORDER BY x.segment_id) FROM assignment_segments x WHERE x.assignment_id = a.id), '{}')
		FROM assignments a JOIN branches b ON b.id = a.branch_id WHERE a.project_id = $1 ORDER BY a.seq`, p.ID)
	if err != nil {
		return fmt.Errorf("list assignments: %w", err)
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, reviewer, branch, lang, state string
		var expires time.Time
		var ids []string
		if err := rows.Scan(&id, &reviewer, &branch, &lang, &state, &expires, &ids); err != nil {
			return fmt.Errorf("scan assignment: %w", err)
		}
		out = append(out, a.assignmentJSON(id, reviewer, branch, lang, state, expires, ids))
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read rows: %w", err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"assignments": out})
	return nil
}

const queueSelect = `SELECT ` + segmentColumns + `, asg.id, asg.expires_at
	FROM segments s
	JOIN branch_keys k ON k.branch_id = s.branch_id AND k.key_id = s.key_id
	JOIN branches b ON b.id = s.branch_id
	JOIN projects p ON p.id = s.project_id `

func (a *App) handleReviewQueue(w http.ResponseWriter, r *http.Request) error {
	pr, err := a.authn(r)
	if err != nil {
		return err
	}
	lang := r.URL.Query().Get("lang")
	args := []any{time.Now().UTC()}
	filter := ""
	if lang != "" {
		args = append(args, lang)
		filter = fmt.Sprintf(" AND s.language = $%d", len(args))
	}
	var sql string
	if pr.isOwner() {
		sql = queueSelect + `LEFT JOIN LATERAL (SELECT a.id, a.expires_at FROM assignment_segments x JOIN assignments a ON a.id = x.assignment_id
				WHERE x.segment_id = s.id AND a.state = 'active' AND a.expires_at > $1 ORDER BY a.seq DESC LIMIT 1) asg ON true
			WHERE ((s.status = 'needs_review' AND NOT k.deleted AND b.state IN ('open', 'in_review')) OR (asg.id IS NOT NULL AND s.status = 'needs_review'))` + filter +
			" ORDER BY p.seq, b.is_main DESC, b.seq, k.name, s.language"
	} else {
		args = append(args, pr.ID)
		sql = queueSelect + fmt.Sprintf(`JOIN LATERAL (SELECT a.id, a.expires_at FROM assignment_segments x JOIN assignments a ON a.id = x.assignment_id
				WHERE x.segment_id = s.id AND a.state = 'active' AND a.expires_at > $1 AND a.reviewer_id = $%d ORDER BY a.seq DESC LIMIT 1) asg ON true
			WHERE s.status = 'needs_review'`, len(args)) + filter + " ORDER BY p.seq, b.is_main DESC, b.seq, k.name, s.language"
	}
	rows, err := a.pool.Query(r.Context(), sql, args...)
	if err != nil {
		return fmt.Errorf("list review queue: %w", err)
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var s Segment
		var asgID *string
		var expires *time.Time
		err := rows.Scan(&s.ID, &s.ProjectID, &s.BranchID, &s.KeyID, &s.Language, &s.Value, &s.Status, &s.Score, &s.Origin,
			&s.Issues, &s.Comments, &s.History, &s.KeyName, &s.Source, &s.Removed, &s.BranchName, &s.BranchState,
			&s.BranchMain, &s.ProjectSlug, &s.Threshold, &asgID, &expires)
		if err != nil {
			return fmt.Errorf("scan queue segment: %w", err)
		}
		s.ensureLists()
		var source any = s.Source
		if s.Removed {
			source = nil
		}
		out = append(out, map[string]any{"segment_id": s.ID, "project": s.ProjectSlug, "branch": s.BranchName, "language": s.Language,
			"key": s.KeyName, "source": source, "value": s.Value, "status": s.Status, "score": s.Score, "issues": s.Issues,
			"assignment_id": asgID, "expires_at": fmtTimePtr(expires), "removed": s.Removed})
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read rows: %w", err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"segments": out})
	return nil
}
