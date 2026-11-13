package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"time"

	"github.com/lib/pq"
)

func (s *Server) handleReviewersList(w http.ResponseWriter, r *http.Request) {
	p, err := s.projectInScope(w, r, r.PathValue("slug"))
	if err != nil {
		return
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT u.id, u.name, u.email FROM reviewer_scopes rs JOIN users u ON u.id = rs.reviewer_id WHERE rs.project_id = $1 ORDER BY u.name`, p.ID)
	if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	defer func() { _ = rows.Close() }()
	reviewers := []map[string]any{}
	for rows.Next() {
		var id, name, email string
		if err := rows.Scan(&id, &name, &email); err != nil {
			http.Error(w, "internal", 500)
			return
		}
		reviewers = append(reviewers, map[string]any{"id": id, "name": name, "email": email})
	}
	writeJSON(w, http.StatusOK, map[string]any{"reviewers": reviewers})
}

func (s *Server) handleReviewerInvite(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	p, err := s.projectInScope(w, r, r.PathValue("slug"))
	if err != nil {
		return
	}
	var body struct {
		Name  string `json:"name"`
		Email string `json:"email"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		validationFailed(w, map[string]string{"email": "Read the request body again."})
		return
	}
	email := strings.TrimSpace(strings.ToLower(body.Email))
	fields := map[string]string{}
	if len(body.Name) < 1 || len(body.Name) > 80 {
		fields["name"] = "The reviewer name is 1 to 80 characters."
	}
	if !strings.Contains(email, "@") || len(email) < 3 {
		fields["email"] = "Enter the reviewer's email."
	}
	if len(fields) > 0 {
		validationFailed(w, fields)
		return
	}
	// already in this project's scope?
	var existingID string
	err = s.db.QueryRowContext(r.Context(), `SELECT u.id FROM users u JOIN reviewer_scopes rs ON rs.reviewer_id = u.id WHERE lower(u.email) = $1 AND rs.project_id = $2`,
		email, p.ID).Scan(&existingID)
	if err == nil {
		writeError(w, http.StatusConflict, "reviewer_exists", "That reviewer already has access to this project.")
		return
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		http.Error(w, "internal", 500)
		return
	}

	accessKey := ""
	var reviewerID string
	var created bool
	err = s.db.QueryRowContext(r.Context(), `SELECT id FROM users WHERE lower(email) = $1`, email).Scan(&reviewerID)
	if errors.Is(err, sql.ErrNoRows) {
		accessKey = "rvk_" + randomToken(24)
		reviewerID = newUUID()
		hash, _ := bcryptHash(accessKey)
		if _, err := s.db.ExecContext(r.Context(), `INSERT INTO users (id, name, email, password_hash, role, access_key, created_at) VALUES ($1,$2,$3,$4,'reviewer',$5, now())`,
			reviewerID, body.Name, email, hash, accessKey); err != nil {
			http.Error(w, "internal", 500)
			return
		}
		created = true
	} else if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	if _, err := s.db.ExecContext(r.Context(), `INSERT INTO reviewer_scopes (reviewer_id, project_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		reviewerID, p.ID); err != nil {
		http.Error(w, "internal", 500)
		return
	}
	_ = s.store.AuditInsert(r.Context(), u.Email, "reviewer.invited", p.Slug, body.Name)
	if created {
		writeJSON(w, http.StatusCreated, map[string]any{"id": reviewerID, "name": body.Name, "email": email, "access_key": accessKey})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": reviewerID, "name": body.Name, "email": email, "access_key": nil})
}

func randomToken(n int) string {
	const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	out := make([]byte, n)
	for i := range out {
		idx, _ := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		out[i] = alphabet[idx.Int64()]
	}
	return string(out)
}

func (s *Server) handleReviewerRemove(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	p, err := s.projectInScope(w, r, r.PathValue("slug"))
	if err != nil {
		return
	}
	id := r.PathValue("id")
	res, err := s.db.ExecContext(r.Context(), `DELETE FROM reviewer_scopes WHERE reviewer_id = $1 AND project_id = $2`, id, p.ID)
	if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		notFoundError(w)
		return
	}
	// cancels the reviewer's active assignments in this project
	if _, err := s.db.ExecContext(r.Context(), `UPDATE assignments SET state = 'cancelled' WHERE reviewer_id = $1 AND project_id = $2 AND state = 'active'`, id, p.ID); err != nil {
		http.Error(w, "internal", 500)
		return
	}
	_ = s.store.AuditInsert(r.Context(), u.Email, "reviewer.removed", p.Slug, "")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleAssignmentCreate(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	p, err := s.projectInScope(w, r, r.PathValue("slug"))
	if err != nil {
		return
	}
	var body struct {
		ReviewerID string `json:"reviewer_id"`
		Branch     string `json:"branch"`
		Language   string `json:"language"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		validationFailed(w, map[string]string{"reviewer_id": "Read the request body again."})
		return
	}
	b, branchID, berr := s.store.BranchByName(r.Context(), p.ID, body.Branch)
	if berr != nil || b == nil {
		notFoundError(w)
		return
	}
	if branchFinal(b.State) {
		writeError(w, http.StatusConflict, "branch_closed", "This branch is merged or abandoned, so it can't change.")
		return
	}
	// the reviewer must be in this project's scope
	var count int
	if err := s.db.QueryRowContext(r.Context(), `SELECT count(*) FROM reviewer_scopes WHERE reviewer_id = $1 AND project_id = $2`, body.ReviewerID, p.ID).Scan(&count); err != nil || count == 0 {
		validationFailed(w, map[string]string{"reviewer_id": "Choose a reviewer of this project."})
		return
	}
	if !containsLanguage(p.TargetLanguages, body.Language) {
		validationFailed(w, map[string]string{"language": "Choose one of the project's target languages."})
		return
	}

	expires := time.Now().UTC().Add(s.cfg.AssignmentTTL)
	assignmentID := newUUID()
	var segmentIDs []string
	txErr := s.store.withTx(r.Context(), func(tx *sql.Tx) error {
		// of simultaneous assignment requests, exactly one gets the segments
		if _, err := tx.ExecContext(r.Context(), `SELECT pg_advisory_xact_lock(hashtext($1))`, "assign:"+branchID+":"+body.Language); err != nil {
			return err
		}
		rows, err := tx.QueryContext(r.Context(), `SELECT seg.id FROM segments seg
			JOIN keys k ON k.id = seg.key_id AND k.branch_id = seg.branch_id AND NOT k.deleted
			WHERE seg.branch_id = $1 AND seg.language = $2 AND seg.status = 'needs_review'
			AND NOT EXISTS (
				SELECT 1 FROM assignments a WHERE a.state = 'active' AND a.expires_at > now() AND seg.id = ANY(a.segment_ids)
			)
			ORDER BY seg.id`, branchID, body.Language)
		if err != nil {
			return err
		}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			segmentIDs = append(segmentIDs, id)
		}
		rows.Close()
		if len(segmentIDs) == 0 {
			return errNoSegments
		}
		if _, err := tx.ExecContext(r.Context(), `INSERT INTO assignments (id, project_id, reviewer_id, branch, language, segment_ids, state, expires_at, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,'active',$7, now())`,
			assignmentID, p.ID, body.ReviewerID, body.Branch, body.Language, pq.Array(segmentIDs), expires); err != nil {
			return err
		}
		return nil
	})
	if txErr != nil {
		if errors.Is(txErr, errNoSegments) {
			writeError(w, http.StatusConflict, "no_segments_to_review",
				fmt.Sprintf("There are no unassigned segments that need review in %s on %s.", body.Language, body.Branch))
			return
		}
		http.Error(w, "internal", 500)
		return
	}
	_ = s.store.AuditInsert(r.Context(), u.Email, "review.assigned", p.Slug, body.Language)
	writeJSON(w, http.StatusCreated, map[string]any{
		"id": assignmentID, "reviewer_id": body.ReviewerID, "branch": body.Branch,
		"language": body.Language, "segment_ids": segmentIDs, "state": "active",
		"expires_at": expires.UTC().Format(time.RFC3339),
	})
}

var errNoSegments = errors.New("no segments")

func (s *Server) handleAssignmentsList(w http.ResponseWriter, r *http.Request) {
	p, err := s.projectInScope(w, r, r.PathValue("slug"))
	if err != nil {
		return
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT a.id, a.reviewer_id, a.branch, a.language, a.segment_ids, a.state, a.expires_at FROM assignments a WHERE a.project_id = $1 ORDER BY a.created_at DESC`, p.ID)
	if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	defer func() { _ = rows.Close() }()
	out := []map[string]any{}
	for rows.Next() {
		var id, reviewerID, branch, language, state string
		var ids []string
		var expires time.Time
		if err := rows.Scan(&id, &reviewerID, &branch, &language, pq.Array(&ids), &state, &expires); err != nil {
			http.Error(w, "internal", 500)
			return
		}
		var stateOut = state
		if state == "active" && expires.Before(time.Now().UTC()) {
			stateOut = "expired"
		}
		out = append(out, map[string]any{
			"id": id, "reviewer_id": reviewerID, "branch": branch, "language": language,
			"segment_ids": ids, "state": stateOut, "expires_at": expires.UTC().Format(time.RFC3339),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"assignments": out})
}

// checkAssignments completes assignments whose live segments are all approved
// and queues their review.completed events.
func (s *Server) checkAssignments(ctx context.Context) {
	rows, err := s.db.QueryContext(ctx, `SELECT a.id, a.project_id, a.reviewer_id, a.branch, a.language FROM assignments a WHERE a.state = 'active'`)
	if err != nil {
		return
	}
	type live struct {
		id, projectID, reviewerID, branch, language string
	}
	var actives []live
	for rows.Next() {
		var l live
		if err := rows.Scan(&l.id, &l.projectID, &l.reviewerID, &l.branch, &l.language); err != nil {
			rows.Close()
			return
		}
		actives = append(actives, l)
	}
	rows.Close()
	for _, a := range actives {
		// expire first
		var expires time.Time
		if err := s.db.QueryRowContext(ctx, `SELECT expires_at FROM assignments WHERE id = $1`, a.id).Scan(&expires); err != nil {
			continue
		}
		if expires.Before(time.Now().UTC()) {
			_, _ = s.db.ExecContext(ctx, `UPDATE assignments SET state = 'expired' WHERE id = $1 AND state = 'active'`, a.id)
			continue
		}
		var total, approved int
		if err := s.db.QueryRowContext(ctx, `SELECT count(*), count(*) FILTER (WHERE seg.status = 'approved') FROM assignments a
			JOIN unnest(a.segment_ids) sid ON true
			JOIN segments seg ON seg.id = sid
			JOIN keys k ON k.id = seg.key_id AND k.branch_id = seg.branch_id AND NOT k.deleted
			WHERE a.id = $1`, a.id).Scan(&total, &approved); err != nil {
			continue
		}
		if total > 0 && total == approved {
			if _, err := s.db.ExecContext(ctx, `UPDATE assignments SET state = 'completed' WHERE id = $1 AND state = 'active'`, a.id); err != nil {
				continue
			}
			s.queueReviewCompleted(ctx, a.id, a.projectID, a.reviewerID, a.branch, a.language, approved)
		}
	}
}

// handleReviewQueue serves the reviewer's active assignments, and for the owner
// every needs-review segment plus segments in active assignments.
func (s *Server) handleReviewQueue(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	lang := r.URL.Query().Get("lang")
	var (
		rows *sql.Rows
		err  error
	)
	if u.Role == "reviewer" {
		q := `SELECT seg.id, p.slug, b.name, seg.language, k.name, k.source, seg.value, seg.status, seg.score, seg.issues, a.id, a.expires_at, k.deleted
			FROM assignments a
			JOIN unnest(a.segment_ids) sid ON true
			JOIN segments seg ON seg.id = sid
			JOIN keys k ON k.id = seg.key_id AND k.branch_id = seg.branch_id
			JOIN branches b ON b.id = seg.branch_id
			JOIN projects p ON p.id = a.project_id
			WHERE a.reviewer_id = $1 AND a.state = 'active' AND a.expires_at > now() AND seg.status <> 'approved'`
		args := []any{u.ID}
		if lang != "" {
			q += ` AND seg.language = $2`
			args = append(args, lang)
		}
		rows, err = s.db.QueryContext(r.Context(), q, args...)
	} else {
		q := `SELECT seg.id, p.slug, b.name, seg.language, k.name, k.source, seg.value, seg.status, seg.score, seg.issues, a.id, a.expires_at, k.deleted
			FROM segments seg
			JOIN keys k ON k.id = seg.key_id AND k.branch_id = seg.branch_id
			JOIN branches b ON b.id = seg.branch_id
			JOIN projects p ON p.id = seg.project_id
			LEFT JOIN assignments a ON a.state = 'active' AND seg.id = ANY(a.segment_ids)
			WHERE seg.status = 'needs_review' AND NOT k.deleted`
		args := []any{}
		if lang != "" {
			q += ` AND seg.language = $1`
			args = append(args, lang)
		}
		q += ` UNION SELECT seg.id, p.slug, b.name, seg.language, k.name, k.source, seg.value, seg.status, seg.score, seg.issues, a.id, a.expires_at, k.deleted
			FROM assignments a
			JOIN unnest(a.segment_ids) sid ON true
			JOIN segments seg ON seg.id = sid
			JOIN keys k ON k.id = seg.key_id AND k.branch_id = seg.branch_id
			JOIN branches b ON b.id = seg.branch_id
			JOIN projects p ON p.id = a.project_id
			WHERE a.state = 'active' AND a.expires_at > now() AND seg.status <> 'approved'`
		if lang != "" {
			q += ` AND seg.language = $1`
		}
		rows, err = s.db.QueryContext(r.Context(), q, args...)
	}
	if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	defer func() { _ = rows.Close() }()
	segments := []map[string]any{}
	seen := map[string]bool{}
	for rows.Next() {
		var segID, slug, branch, language, key, status string
		var source, value any
		var score any
		var issues []byte
		var assignmentID any
		var expires any
		var deleted bool
		if err := rows.Scan(&segID, &slug, &branch, &language, &key, &source, &value, &status, &score, &issues, &assignmentID, &expires, &deleted); err != nil {
			http.Error(w, "internal", 500)
			return
		}
		if seen[segID] {
			continue
		}
		seen[segID] = true
		var issueList []map[string]any
		_ = json.Unmarshal(issues, &issueList)
		if issueList == nil {
			issueList = []map[string]any{}
		}
		var srcOut any = source
		if deleted {
			srcOut = nil
		}
		segments = append(segments, map[string]any{
			"segment_id": segID, "project": slug, "branch": branch, "language": language,
			"key": key, "source": srcOut, "value": value, "status": status, "score": score,
			"issues": issueList, "assignment_id": assignmentID, "expires_at": expires,
			"removed": deleted,
		})
	}
	if segments == nil {
		segments = []map[string]any{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"segments": segments})
}
