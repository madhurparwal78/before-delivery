package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

// segmentView builds the full segment record.
func (s *Server) segmentView(ctx context.Context, segID string) (map[string]any, error) {
	var projectID, branchID, keyID, language, status string
	var value, origin any
	var score any
	var issues []byte
	var keyName, source string
	var deleted bool
	err := s.db.QueryRowContext(ctx, `SELECT seg.project_id, seg.branch_id, seg.key_id, seg.language, seg.value, seg.status, seg.score, seg.origin, seg.issues, k.name, k.source, k.deleted
		FROM segments seg JOIN keys k ON k.id = seg.key_id AND k.branch_id = seg.branch_id WHERE seg.id = $1`, segID).
		Scan(&projectID, &branchID, &keyID, &language, &value, &status, &score, &origin, &issues, &keyName, &source, &deleted)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var branchName string
	_ = s.db.QueryRowContext(ctx, `SELECT name FROM branches WHERE id = $1`, branchID).Scan(&branchName)
	var slug string
	_ = s.db.QueryRowContext(ctx, `SELECT slug FROM projects WHERE id = $1`, projectID).Scan(&slug)

	var issueList []map[string]any
	_ = json.Unmarshal(issues, &issueList)
	if issueList == nil {
		issueList = []map[string]any{}
	}
	commentRows, err := s.db.QueryContext(ctx, `SELECT id, author, body, at FROM comments WHERE segment_id = $1 ORDER BY at`, segID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = commentRows.Close() }()
	comments := []map[string]any{}
	for commentRows.Next() {
		var id, author, body string
		var at time.Time
		if err := commentRows.Scan(&id, &author, &body, &at); err != nil {
			return nil, err
		}
		comments = append(comments, map[string]any{"id": id, "author": author, "body": body, "at": at.UTC().Format(time.RFC3339)})
	}
	histRows, err := s.db.QueryContext(ctx, `SELECT at, actor, from_status, to_status, value FROM segment_history WHERE segment_id = $1 ORDER BY at, id`, segID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = histRows.Close() }()
	history := []map[string]any{}
	for histRows.Next() {
		var at time.Time
		var actor string
		var from, to, val any
		if err := histRows.Scan(&at, &actor, &from, &to, &val); err != nil {
			return nil, err
		}
		history = append(history, map[string]any{"at": at.UTC().Format(time.RFC3339), "actor": actor, "from": from, "to": to, "value": val})
	}
	var srcOut any = source
	if deleted {
		srcOut = nil
	}
	return map[string]any{
		"id": segID, "project": slug, "branch": branchName, "key_id": keyID, "key": keyName,
		"source": srcOut, "language": language, "value": value, "status": status,
		"score": score, "origin": origin, "issues": issueList, "comments": comments,
		"history": history, "removed": deleted,
	}, nil
}

func (s *Server) handleSegmentGet(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	segID := r.PathValue("id")
	var projectID, keyID string
	if err := s.db.QueryRowContext(r.Context(), `SELECT project_id, key_id FROM segments WHERE id = $1`, segID).Scan(&projectID, &keyID); err != nil {
		notFoundError(w)
		return
	}
	if u.Role == "reviewer" {
		// a reviewer sees a segment they were ever assigned to
		var n int
		if err := s.db.QueryRowContext(r.Context(),
			`SELECT count(*) FROM assignments a JOIN unnest(a.segment_ids) sid ON sid = $1 WHERE a.reviewer_id = $2 AND a.project_id = $3`,
			segID, u.ID, projectID).Scan(&n); err != nil || n == 0 {
			notFoundError(w)
			return
		}
	}
	view, err := s.segmentView(r.Context(), segID)
	if err != nil || view == nil {
		notFoundError(w)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

func (s *Server) handleSegmentValue(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	segID := r.PathValue("id")
	var body struct {
		Value string `json:"value"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		validationFailed(w, map[string]string{"value": "Read the request body again."})
		return
	}
	value := body.Value
	if len(value) < 1 || len(value) > 4000 {
		validationFailed(w, map[string]string{"value": "The translation is 1 to 4,000 characters."})
		return
	}
	var projectID, keyID, language, status string
	if err := s.db.QueryRowContext(r.Context(), `SELECT seg.project_id, seg.key_id, seg.language, seg.status FROM segments seg
		JOIN branches b ON b.id = seg.branch_id WHERE seg.id = $1`, segID).Scan(&projectID, &keyID, &language, &status); err != nil {
		notFoundError(w)
		return
	}
	bState, err := s.branchStateOfSegment(r.Context(), segID)
	if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	if branchFinal(bState) {
		writeError(w, http.StatusConflict, "branch_closed", "This branch is merged or abandoned, so it can't change.")
		return
	}
	if !branchEditable(bState) {
		writeError(w, http.StatusConflict, "branch_not_open", "This branch is in review, so keys and translations are locked.")
		return
	}
	// any status with a value goes to drafted, clearing issues and score
	if _, err := s.db.ExecContext(r.Context(), `UPDATE segments SET value = $1, status = 'drafted', score = NULL, issues = '[]', origin = 'manual', updated_at = now() WHERE id = $2`,
		value, segID); err != nil {
		http.Error(w, "internal", 500)
		return
	}
	_, _ = s.db.ExecContext(r.Context(), `INSERT INTO segment_history (segment_id, at, actor, from_status, to_status, value) VALUES ($1, now(), $2, $3, 'drafted', $4)`,
		segID, u.Email, status, value)
	_ = s.store.AuditInsert(r.Context(), u.Email, "segment.saved", "", keyID)
	if _, err := bumpMainVersionDB(r.Context(), s.db); err != nil {
		http.Error(w, "internal", 500)
		return
	}
	view, _ := s.segmentView(r.Context(), segID)
	writeJSON(w, http.StatusOK, view)
}

func bumpMainVersionDB(ctx context.Context, db *sql.DB) (int64, error) {
	if _, err := db.ExecContext(ctx, `INSERT INTO counters (name, value) VALUES ('main_version', 1)
		ON CONFLICT (name) DO UPDATE SET value = counters.value + 1`); err != nil {
		return 0, err
	}
	var v int64
	if err := db.QueryRowContext(ctx, `SELECT value FROM counters WHERE name = 'main_version'`).Scan(&v); err != nil {
		return 0, err
	}
	return v, nil
}

func (s *Server) branchStateOfSegment(ctx context.Context, segID string) (string, error) {
	var state string
	err := s.db.QueryRowContext(ctx, `SELECT b.state FROM segments seg JOIN branches b ON b.id = seg.branch_id WHERE seg.id = $1`, segID).Scan(&state)
	return state, err
}

// loadSegmentForReview resolves a segment for approve/correct/comment.
func (s *Server) loadSegmentForReview(r *http.Request) (segID, projectID, keyID, language, status, keyBranchState string, deleted bool, assignedAssignment any, assignedExpiry time.Time, err error) {
	ctx := r.Context()
	u := userFrom(ctx)
	if err := s.db.QueryRowContext(ctx, `SELECT seg.id, seg.project_id, seg.key_id, seg.language, seg.status, b.state, k.deleted
		FROM segments seg JOIN branches b ON b.id = seg.branch_id JOIN keys k ON k.id = seg.key_id AND k.branch_id = seg.branch_id WHERE seg.id = $1`,
		r.PathValue("id")).Scan(&segID, &projectID, &keyID, &language, &status, &keyBranchState, &deleted); err != nil {
		return "", "", "", "", "", "", false, nil, time.Time{}, errNotFoundSentinel
	}
	if u.Role == "reviewer" {
		var assignmentID any
		var expires time.Time
		qerr := s.db.QueryRowContext(ctx, `SELECT a.id, a.expires_at FROM assignments a
			JOIN unnest(a.segment_ids) sid ON sid = $1
			WHERE a.reviewer_id = $2 AND a.state = 'active' AND a.expires_at > now()
			ORDER BY a.created_at LIMIT 1`, segID, u.ID).Scan(&assignmentID, &expires)
		if qerr != nil {
			return segID, projectID, keyID, language, status, keyBranchState, deleted, nil, time.Time{}, errAssignmentMissing
		}
		return segID, projectID, keyID, language, status, keyBranchState, deleted, assignmentID, expires, nil
	}
	return segID, projectID, keyID, language, status, keyBranchState, deleted, nil, time.Time{}, nil
}

var errAssignmentMissing = errors.New("assignment missing")

func (s *Server) handleSegmentApprove(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	segID, _, keyID, _, status, _, deleted, _, _, err := s.loadSegmentForReview(r)
	if err != nil {
		if errors.Is(err, errNotFoundSentinel) {
			notFoundError(w)
			return
		}
		if errors.Is(err, errAssignmentMissing) {
			writeError(w, http.StatusConflict, "assignment_expired", "This assignment expired. Ask the engineer to assign it again.")
			return
		}
		http.Error(w, "internal", 500)
		return
	}
	if deleted {
		writeError(w, http.StatusConflict, "key_removed", "This key was removed.")
		return
	}
	if !segmentCanApprove(status) {
		writeErrorDetails(w, http.StatusConflict, "illegal_transition", "That change isn't allowed.",
			map[string]any{"from": status, "to": StatusApproved})
		return
	}
	if _, err := s.db.ExecContext(r.Context(), `UPDATE segments SET status = 'approved', updated_at = now() WHERE id = $1`, segID); err != nil {
		http.Error(w, "internal", 500)
		return
	}
	_, _ = s.db.ExecContext(r.Context(), `INSERT INTO segment_history (segment_id, at, actor, from_status, to_status, value) VALUES ($1, now(), $2, $3, 'approved', (SELECT value FROM segments WHERE id = $1))`,
		segID, u.Email, status)
	_ = s.store.AuditInsert(r.Context(), u.Email, "segment.approved", "", keyID)
	s.checkAssignments(r.Context())
	view, _ := s.segmentView(r.Context(), segID)
	writeJSON(w, http.StatusOK, view)
}

func (s *Server) handleSegmentCorrect(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	segID, _, keyID, _, status, _, deleted, _, _, err := s.loadSegmentForReview(r)
	if err != nil {
		if errors.Is(err, errNotFoundSentinel) {
			notFoundError(w)
			return
		}
		if errors.Is(err, errAssignmentMissing) {
			writeError(w, http.StatusConflict, "assignment_expired", "This assignment expired. Ask the engineer to assign it again.")
			return
		}
		http.Error(w, "internal", 500)
		return
	}
	if deleted {
		writeError(w, http.StatusConflict, "key_removed", "This key was removed.")
		return
	}
	if !segmentCanCorrect(status) {
		writeErrorDetails(w, http.StatusConflict, "illegal_transition", "That change isn't allowed.",
			map[string]any{"from": status, "to": StatusApproved})
		return
	}
	var body struct {
		Value   string  `json:"value"`
		Comment *string `json:"comment"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		validationFailed(w, map[string]string{"value": "Read the request body again."})
		return
	}
	if len(body.Value) < 1 || len(body.Value) > 4000 {
		validationFailed(w, map[string]string{"value": "The translation is 1 to 4,000 characters."})
		return
	}
	if body.Comment != nil && len(*body.Comment) > 2000 {
		validationFailed(w, map[string]string{"comment": "The comment is up to 2,000 characters."})
		return
	}
	if _, err := s.db.ExecContext(r.Context(), `UPDATE segments SET value = $1, status = 'approved', origin = 'review', updated_at = now() WHERE id = $2`,
		body.Value, segID); err != nil {
		http.Error(w, "internal", 500)
		return
	}
	_, _ = s.db.ExecContext(r.Context(), `INSERT INTO segment_history (segment_id, at, actor, from_status, to_status, value) VALUES ($1, now(), $2, $3, 'approved', $4)`,
		segID, u.Email, status, body.Value)
	if body.Comment != nil && *body.Comment != "" {
		_, _ = s.db.ExecContext(r.Context(), `INSERT INTO comments (id, segment_id, author, body, at) VALUES ($1,$2,$3,$4, now())`,
			newUUID(), segID, u.Email, *body.Comment)
	}
	_ = s.store.AuditInsert(r.Context(), u.Email, "segment.corrected", "", keyID)
	s.checkAssignments(r.Context())
	view, _ := s.segmentView(r.Context(), segID)
	writeJSON(w, http.StatusOK, view)
}

func (s *Server) handleSegmentComment(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	segID, _, _, _, _, _, deleted, _, _, err := s.loadSegmentForReview(r)
	if err != nil {
		if errors.Is(err, errNotFoundSentinel) {
			notFoundError(w)
			return
		}
		if errors.Is(err, errAssignmentMissing) {
			notFoundError(w)
			return
		}
		http.Error(w, "internal", 500)
		return
	}
	_ = deleted
	var body struct {
		Body string `json:"body"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		validationFailed(w, map[string]string{"body": "Read the request body again."})
		return
	}
	if len(body.Body) < 1 || len(body.Body) > 2000 {
		validationFailed(w, map[string]string{"body": "The comment is 1 to 2,000 characters."})
		return
	}
	id := newUUID()
	if _, err := s.db.ExecContext(r.Context(), `INSERT INTO comments (id, segment_id, author, body, at) VALUES ($1,$2,$3,$4, now())`,
		id, segID, u.Email, body.Body); err != nil {
		http.Error(w, "internal", 500)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "author": u.Email, "body": body.Body, "at": time.Now().UTC().Format(time.RFC3339)})
}

// handleSegmentScore scores a segment with the given issues (an empty list allowed).
func (s *Server) handleSegmentScore(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	segID := r.PathValue("id")
	var body struct {
		Issues []IssueIn `json:"issues"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		validationFailed(w, map[string]string{"issues": "Read the request body again."})
		return
	}
	if err := s.scoreSegment(w, r, u, segID, body.Issues, false); err != nil {
		return
	}
}

// handleSegmentIssue adds one issue and rescores.
func (s *Server) handleSegmentIssue(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	segID := r.PathValue("id")
	var body IssueIn
	if err := decodeJSONBody(r, &body); err != nil {
		validationFailed(w, map[string]string{"category": "Read the request body again."})
		return
	}
	if !validIssue(body) {
		validationFailed(w, map[string]string{"category": "Choose a known category and severity."})
		return
	}
	if len(body.Note) > 500 {
		validationFailed(w, map[string]string{"note": "The note is up to 500 characters."})
		return
	}
	if err := s.scoreSegment(w, r, u, segID, []IssueIn{body}, true); err != nil {
		return
	}
}

func (s *Server) scoreSegment(w http.ResponseWriter, r *http.Request, u *SessionUser, segID string, issues []IssueIn, appendMode bool) error {
	for _, i := range issues {
		if !validIssue(i) {
			validationFailed(w, map[string]string{"category": "Choose a known category and severity."})
			return errHandledInline
		}
		if len(i.Note) > 500 {
			validationFailed(w, map[string]string{"note": "The note is up to 500 characters."})
			return errHandledInline
		}
	}
	var projectID, keyID, language, status, source string
	var issuesRaw []byte
	if err := s.db.QueryRowContext(r.Context(), `SELECT seg.project_id, seg.key_id, seg.language, seg.status, k.source, seg.issues
		FROM segments seg JOIN keys k ON k.id = seg.key_id AND k.branch_id = seg.branch_id WHERE seg.id = $1`, segID).
		Scan(&projectID, &keyID, &language, &status, &source, &issuesRaw); err != nil {
		notFoundError(w)
		return errHandledInline
	}
	if !segmentCanScore(status) {
		writeErrorDetails(w, http.StatusConflict, "illegal_transition", "That change isn't allowed.",
			map[string]any{"from": status, "to": StatusScored})
		return errHandledInline
	}
	var threshold int
	_ = s.db.QueryRowContext(r.Context(), `SELECT mqm_threshold FROM projects WHERE id = $1`, projectID).Scan(&threshold)

	var nextIssues []IssueIn
	if appendMode {
		var existing []IssueIn
		_ = json.Unmarshal(issuesRaw, &existing)
		nextIssues = append(existing, issues...)
	} else {
		nextIssues = issues
	}
	score := MqmScore(source, nextIssues)
	nextStatus := StatusScored
	if score < threshold {
		nextStatus = StatusNeedsReview
	}
	issuesJSON, _ := json.Marshal(nextIssues)
	if _, err := s.db.ExecContext(r.Context(), `UPDATE segments SET issues = $1, score = $2, status = $3, updated_at = now() WHERE id = $4`,
		string(issuesJSON), score, nextStatus, segID); err != nil {
		http.Error(w, "internal", 500)
		return errHandledInline
	}
	_, _ = s.db.ExecContext(r.Context(), `INSERT INTO segment_history (segment_id, at, actor, from_status, to_status, value) VALUES ($1, now(), $2, $3, $4, (SELECT value FROM segments WHERE id = $1))`,
		segID, u.Email, status, nextStatus)
	_ = s.store.AuditInsert(r.Context(), u.Email, "segment.scored", "", keyID)
	s.checkAssignments(r.Context())
	view, _ := s.segmentView(r.Context(), segID)
	writeJSON(w, http.StatusOK, view)
	return nil
}

var errHandledInline = errors.New("handled inline")

// ---- AI drafting ----

func (s *Server) handleDrafts(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	p, b, branchID, ok := s.loadOpenBranch(w, r)
	if !ok {
		return
	}
	var body struct {
		Language string `json:"language"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		validationFailed(w, map[string]string{"language": "Read the request body again."})
		return
	}
	if !containsLanguage(p.TargetLanguages, body.Language) {
		validationFailed(w, map[string]string{"language": "Choose one of the project's target languages."})
		return
	}

	// walk the branch's live, untranslated segments in key-name order
	rows, err := s.db.QueryContext(r.Context(), `SELECT seg.id, k.name, k.source FROM segments seg
		JOIN keys k ON k.id = seg.key_id AND k.branch_id = seg.branch_id
		WHERE seg.branch_id = $1 AND seg.language = $2 AND seg.status = 'untranslated' AND NOT k.deleted
		ORDER BY k.name, seg.id`, branchID, body.Language)
	if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	type target struct{ segID, key, source string }
	var targets []target
	for rows.Next() {
		var t target
		if err := rows.Scan(&t.segID, &t.key, &t.source); err != nil {
			rows.Close()
			http.Error(w, "internal", 500)
			return
		}
		targets = append(targets, t)
	}
	rows.Close()

	engine := p.AiRoutes[body.Language]
	tmReused, aiDrafted := 0, 0
	for _, t := range targets {
		entry, err := s.tmExactMatch(r.Context(), p.ID, body.Language, t.source)
		if err != nil {
			http.Error(w, "internal", 500)
			return
		}
		if entry != nil {
			value := MapPlaceholders(entry.Source, entry.Target, t.source)
			if _, err := s.db.ExecContext(r.Context(), `UPDATE segments SET value = $1, status = 'drafted', origin = 'tm', updated_at = now() WHERE id = $2`,
				value, t.segID); err != nil {
				http.Error(w, "internal", 500)
				return
			}
			_, _ = s.db.ExecContext(r.Context(), `INSERT INTO segment_history (segment_id, at, actor, from_status, to_status, value) VALUES ($1, now(), 'system', 'untranslated', 'drafted', $2)`,
				t.segID, value)
			tmReused++
			continue
		}
		res, err := s.ai.Draft(r.Context(), engine, p.SourceLanguage, body.Language, t.key, t.source)
		if err != nil {
			// the first engine failure stops the run; already applied segments stay
			writeErrorDetails(w, http.StatusServiceUnavailable, "ai_engine_unavailable",
				"The AI engine isn't answering. Exact matches from translation memory still apply; other segments stay untranslated.",
				map[string]any{"tm_reused": tmReused, "ai_drafted": aiDrafted})
			return
		}
		var known []IssueIn
		for _, i := range res.Issues {
			if validIssue(i) {
				known = append(known, i)
			}
		}
		score := MqmScore(t.source, known)
		nextStatus := StatusScored
		if score < p.MqmThreshold {
			nextStatus = StatusNeedsReview
		}
		issuesJSON, _ := json.Marshal(known)
		if _, err := s.db.ExecContext(r.Context(), `UPDATE segments SET value = $1, status = $2, score = $3, origin = $4, issues = $5, updated_at = now() WHERE id = $6`,
			res.Draft, nextStatus, score, "ai:"+engine, string(issuesJSON), t.segID); err != nil {
			http.Error(w, "internal", 500)
			return
		}
		_, _ = s.db.ExecContext(r.Context(), `INSERT INTO segment_history (segment_id, at, actor, from_status, to_status, value) VALUES ($1, now(), 'system', 'untranslated', 'drafted', $2)`,
			t.segID, res.Draft)
		_, _ = s.db.ExecContext(r.Context(), `INSERT INTO segment_history (segment_id, at, actor, from_status, to_status, value) VALUES ($1, now(), 'system', 'drafted', $2, $3)`,
			t.segID, nextStatus, res.Draft)
		aiDrafted++
	}
	_ = s.store.AuditInsert(r.Context(), u.Email, "branch.drafted", p.Slug, b.Name)
	writeJSON(w, http.StatusOK, map[string]any{"tm_reused": tmReused, "ai_drafted": aiDrafted})
}

// ---- source file upload ----

func (s *Server) handleSourceUpload(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	p, b, branchID, ok := s.loadOpenBranch(w, r)
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, MaxMultipart+1)
	if err := r.ParseMultipartForm(MaxMultipart); err != nil {
		payloadTooLarge(w)
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		validationFailed(w, map[string]string{"file": "Choose a file to upload."})
		return
	}
	defer func() { _ = file.Close() }()
	data, err := readAllLimited(file, MaxFileBody)
	if err != nil {
		payloadTooLarge(w)
		return
	}
	flat, ferr := parseSourceJSON(data)
	if ferr != nil {
		writeErrorFields(w, http.StatusUnprocessableEntity, "validation_failed", "The file must be a JSON object whose values are all strings.",
			map[string]string{"file": "The file must be a JSON object whose values are all strings."})
		return
	}

	fileID := newUUID()
	objectKey := "projects/" + p.ID + "/source-files/" + fileID
	if err := s.storage.Put(r.Context(), objectKey, data, contentTypeOf(header)); err != nil {
		serviceUnavailable(w, "storage_unavailable", "File storage isn't answering. Nothing was saved; try again in a few minutes.", nil)
		return
	}

	added, changed, unchanged := 0, 0, 0
	err = s.store.withTx(r.Context(), func(tx *sql.Tx) error {
		now := time.Now().UTC()
		sum := sha256HexBytes(data)
		if _, err := tx.ExecContext(r.Context(), `INSERT INTO source_files (file_id, project_id, branch, filename, content_type, size, sha256, object_key, at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			fileID, p.ID, b.Name, header.Filename, contentTypeOf(header), len(data), sum, objectKey, now); err != nil {
			return err
		}
		for name, value := range flat {
			var keyID string
			var cur string
			qerr := tx.QueryRowContext(r.Context(), `SELECT id, source FROM keys WHERE branch_id = $1 AND name = $2 AND NOT deleted`, branchID, name).Scan(&keyID, &cur)
			if errors.Is(qerr, sql.ErrNoRows) {
				nid := newUUID()
				if _, err := tx.ExecContext(r.Context(), `INSERT INTO keys (id, project_id, branch_id, name, source, deleted, created_at) VALUES ($1,$2,$3,$4,$5,false,$6)`,
					nid, p.ID, branchID, name, value, now); err != nil {
					return err
				}
				if _, err := tx.ExecContext(r.Context(), `INSERT INTO key_revisions (key_id, at, branch, field, from_val, to_val, actor) VALUES ($1,$2,$3,'created',NULL,$4,$5)`,
					nid, now, b.Name, value, u.Email); err != nil {
					return err
				}
				for _, lang := range p.TargetLanguages {
					sid := newUUID()
					if _, err := tx.ExecContext(r.Context(), `INSERT INTO segments (id, project_id, branch_id, key_id, language, value, status, score, origin, issues, created_at, updated_at)
						VALUES ($1,$2,$3,$4,$5,NULL,'untranslated',NULL,NULL,'[]',$6,$6)`, sid, p.ID, branchID, nid, lang, now); err != nil {
						return err
					}
				}
				added++
			} else if qerr != nil {
				return qerr
			} else if cur != value {
				if _, err := tx.ExecContext(r.Context(), `UPDATE keys SET source = $1 WHERE id = $2`, value, keyID); err != nil {
					return err
				}
				if _, err := tx.ExecContext(r.Context(), `INSERT INTO key_revisions (key_id, at, branch, field, from_val, to_val, actor) VALUES ($1,$2,$3,'source',$4,$5,$6)`,
					keyID, now, b.Name, cur, value, u.Email); err != nil {
					return err
				}
				// translated segments move to needs review
				if _, err := tx.ExecContext(r.Context(), `UPDATE segments SET status = 'needs_review', updated_at = now() WHERE key_id = $1 AND value IS NOT NULL`, keyID); err != nil {
					return err
				}
				changed++
			} else {
				unchanged++
			}
		}
		// exact matches fill the newly created and untranslated segments
		for name := range flat {
			var keyID string
			if err := tx.QueryRowContext(r.Context(), `SELECT id FROM keys WHERE branch_id = $1 AND name = $2`, branchID, name).Scan(&keyID); err != nil {
				continue
			}
			_ = keyID
		}
		if _, err := bumpMainVersion(r.Context(), tx); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	_ = s.store.AuditInsert(r.Context(), u.Email, "source.uploaded", p.Slug, header.Filename)
	writeJSON(w, http.StatusCreated, map[string]any{
		"file_id": fileID, "filename": header.Filename, "content_type": contentTypeOf(header),
		"size": len(data), "sha256": sha256HexBytes(data), "object_key": objectKey,
		"keys_added": added, "keys_changed": changed, "keys_unchanged": unchanged,
	})
}

func readAllLimited(r interface{ Read([]byte) (int, error) }, limit int64) ([]byte, error) {
	buf := make([]byte, 0, 4096)
	tmp := make([]byte, 32*1024)
	for {
		n, err := r.Read(tmp)
		buf = append(buf, tmp[:n]...)
		if int64(len(buf)) > limit {
			return nil, errTooLarge
		}
		if err != nil {
			if err.Error() == "EOF" {
				return buf, nil
			}
			return buf, nil
		}
	}
}

var errTooLarge = errors.New("too large")

func (s *Server) handleSourceFilesList(w http.ResponseWriter, r *http.Request) {
	p, err := s.projectInScope(w, r, r.PathValue("slug"))
	if err != nil {
		return
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT file_id, branch, filename, content_type, size, sha256, at FROM source_files WHERE project_id = $1 ORDER BY at DESC`, p.ID)
	if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	defer func() { _ = rows.Close() }()
	files := []map[string]any{}
	for rows.Next() {
		var id, branch, filename, ct, sha string
		var size int
		var at time.Time
		if err := rows.Scan(&id, &branch, &filename, &ct, &size, &sha, &at); err != nil {
			http.Error(w, "internal", 500)
			return
		}
		files = append(files, map[string]any{
			"file_id": id, "branch": branch, "filename": filename, "content_type": ct,
			"size": size, "sha256": sha, "at": at.UTC().Format(time.RFC3339),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"files": files})
}

func (s *Server) handleSourceOriginal(w http.ResponseWriter, r *http.Request) {
	p, err := s.projectInScope(w, r, r.PathValue("slug"))
	if err != nil {
		return
	}
	fileID := r.PathValue("file_id")
	var objectKey, filename, contentType string
	if err := s.db.QueryRowContext(r.Context(), `SELECT object_key, filename, content_type FROM source_files WHERE file_id = $1 AND project_id = $2`, fileID, p.ID).
		Scan(&objectKey, &filename, &contentType); err != nil {
		notFoundError(w)
		return
	}
	data, err := s.storage.Get(r.Context(), objectKey)
	if err != nil {
		notFoundError(w)
		return
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// parseSourceJSON flattens a JSON object to dotted key names with trimmed values.
func parseSourceJSON(data []byte) (map[string]string, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	out := map[string]string{}
	var walk func(prefix string, obj map[string]json.RawMessage) error
	walk = func(prefix string, obj map[string]json.RawMessage) error {
		for k, v := range obj {
			full := k
			if prefix != "" {
				full = prefix + "." + k
			}
			var s string
			if err := json.Unmarshal(v, &s); err == nil {
				if !keyNameRe.MatchString(full) {
					return errBadKeyName
				}
				out[full] = strings.TrimSpace(s)
				continue
			}
			var nested map[string]json.RawMessage
			if err := json.Unmarshal(v, &nested); err == nil {
				if err := walk(full, nested); err != nil {
					return err
				}
				continue
			}
			return errLeafNotString
		}
		return nil
	}
	if err := walk("", raw); err != nil {
		return nil, err
	}
	return out, nil
}

var (
	errBadKeyName    = errors.New("bad key name")
	errLeafNotString = errors.New("leaf not a string")
)

func sha256HexBytes(b []byte) string {
	sum := sha256Sum(b)
	return hexEncode(sum)
}
