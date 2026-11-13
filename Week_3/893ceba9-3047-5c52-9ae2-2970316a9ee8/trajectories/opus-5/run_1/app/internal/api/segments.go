package api

import (
	"errors"
	"net/http"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/marlowquill/interline-desk/internal/domain"
	"github.com/marlowquill/interline-desk/internal/store"
)

func segmentBody(rec *store.SegmentRecord) map[string]any {
	var source any = rec.KeySource
	if rec.KeyDeleted {
		source = nil
	}
	return map[string]any{
		"id": rec.ID, "project": rec.ProjectSlug, "branch": rec.BranchName, "key_id": rec.KeyID,
		"key": rec.KeyName, "source": source, "language": rec.Language, "value": rec.Value,
		"status": rec.Status, "score": rec.Score, "origin": rec.Origin, "issues": rec.Issues,
		"comments": rec.Comments, "history": rec.History, "removed": rec.KeyDeleted,
	}
}

// segmentFor reads a segment inside the caller's scope.
func (s *Server) segmentFor(r *http.Request, c *call, ownerOnly bool) (*store.SegmentRecord, *apiError) {
	ctx := r.Context()
	rec, err := s.store.Segment(ctx, s.store.Pool, r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		return nil, errNotFound()
	}
	if err != nil {
		return nil, errInternal(err)
	}
	if c.user.Role == "reviewer" {
		inScope, err := s.store.ReviewerInScope(ctx, c.user.ID, rec.ProjectID)
		if err != nil {
			return nil, errInternal(err)
		}
		if !inScope {
			return nil, errNotFound()
		}
		if ownerOnly {
			return nil, errForbidden()
		}
	}
	return rec, nil
}

func (s *Server) handleGetSegment(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	rec, fail := s.segmentFor(r, c, false)
	if fail != nil {
		return fail
	}
	if c.user.Role == "reviewer" {
		ever, err := s.store.SegmentEverAssigned(r.Context(), rec.ID, c.user.ID)
		if err != nil {
			return errInternal(err)
		}
		if !ever {
			return errNotFound()
		}
	}
	writeJSON(w, http.StatusOK, segmentBody(rec))
	return nil
}

func (s *Server) handleSegmentValue(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	var body struct {
		Value string `json:"value"`
	}
	if fail := readJSON(r, &body); fail != nil {
		return fail
	}
	rec, fail := s.segmentFor(r, c, true)
	if fail != nil {
		return fail
	}
	branch, fail := s.branchOf(r, rec)
	if fail != nil {
		return fail
	}
	if fail := requireOpen(branch); fail != nil {
		return fail
	}
	if !lengthBetween(body.Value, 1, 4000) {
		return errField("value", "Give a translation of 1 to 4,000 characters.")
	}
	ctx := r.Context()
	err := s.store.InTx(ctx, func(tx pgx.Tx) error {
		origin := "manual"
		if err := s.store.WriteSegment(ctx, tx, rec.ID, &body.Value, domain.StatusDrafted, nil, &origin); err != nil {
			return err
		}
		if err := s.store.ReplaceIssues(ctx, tx, rec.ID, nil); err != nil {
			return err
		}
		if err := s.store.AddSegmentRevision(ctx, tx, rec.ID, c.user.Email, rec.Status,
			domain.StatusDrafted, &body.Value, store.Now()); err != nil {
			return err
		}
		if branch.IsMain {
			if _, err := s.store.BumpChangeSeq(ctx, tx, rec.ProjectID); err != nil {
				return err
			}
		}
		return s.store.AddAudit(ctx, tx, c.user.Email, "segment.valued", rec.ProjectSlug,
			rec.KeyName+" ("+rec.Language+")", &rec.ProjectID)
	})
	if err != nil {
		return errInternal(err)
	}
	return s.writeSegment(w, r, rec.ID, http.StatusOK)
}

func (s *Server) branchOf(r *http.Request, rec *store.SegmentRecord) (*store.Branch, *apiError) {
	project, err := s.store.ProjectByID(r.Context(), s.store.Pool, rec.ProjectID)
	if err != nil {
		return nil, errInternal(err)
	}
	return s.branchFor(r, project, rec.BranchName)
}

func (s *Server) writeSegment(w http.ResponseWriter, r *http.Request, id string, status int) *apiError {
	rec, err := s.store.Segment(r.Context(), s.store.Pool, id)
	if err != nil {
		return errInternal(err)
	}
	writeJSON(w, status, segmentBody(rec))
	return nil
}

func (s *Server) handleSegmentScore(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	var body struct {
		Issues []domain.Issue `json:"issues"`
	}
	if fail := readJSON(r, &body); fail != nil {
		return fail
	}
	rec, fail := s.segmentFor(r, c, true)
	if fail != nil {
		return fail
	}
	if fail := validateIssues(body.Issues); fail != nil {
		return fail
	}
	return s.score(w, r, c, rec, body.Issues, http.StatusOK)
}

func (s *Server) handleSegmentIssue(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	var issue domain.Issue
	if fail := readJSON(r, &issue); fail != nil {
		return fail
	}
	rec, fail := s.segmentFor(r, c, true)
	if fail != nil {
		return fail
	}
	if fail := validateIssues([]domain.Issue{issue}); fail != nil {
		return fail
	}
	return s.score(w, r, c, rec, append(rec.Issues, issue), http.StatusCreated)
}

func validateIssues(issues []domain.Issue) *apiError {
	for _, issue := range issues {
		if !domain.ValidIssueCategory(issue.Category) {
			return errField("category", "Use accuracy, fluency, terminology, style or locale-convention.")
		}
		if !domain.ValidIssueSeverity(issue.Severity) {
			return errField("severity", "Use minor, major or critical.")
		}
		if !lengthBetween(issue.Note, 0, 500) {
			return errField("note", "Keep the note to 500 characters.")
		}
	}
	return nil
}

// score records issues and computes the MQM score once.
func (s *Server) score(w http.ResponseWriter, r *http.Request, c *call, rec *store.SegmentRecord, issues []domain.Issue, status int) *apiError {
	branch, fail := s.branchOf(r, rec)
	if fail != nil {
		return fail
	}
	if fail := requireLive(branch); fail != nil {
		return fail
	}
	if !domain.SegmentMoveAllowed(rec.Status, domain.ActionScore) {
		return errIllegalTransition(rec.Status, domain.StatusScored)
	}
	project, err := s.store.ProjectByID(r.Context(), s.store.Pool, rec.ProjectID)
	if err != nil {
		return errInternal(err)
	}
	score := domain.MQMScore(rec.KeySource, issues)
	next := domain.ScoredStatus(score, project.MQMThreshold)
	ctx := r.Context()
	err = s.store.InTx(ctx, func(tx pgx.Tx) error {
		if err := s.store.ReplaceIssues(ctx, tx, rec.ID, issues); err != nil {
			return err
		}
		if err := s.store.WriteSegment(ctx, tx, rec.ID, rec.Value, next, &score, rec.Origin); err != nil {
			return err
		}
		if err := s.store.AddSegmentRevision(ctx, tx, rec.ID, c.user.Email, rec.Status, next, rec.Value,
			store.Now()); err != nil {
			return err
		}
		if branch.IsMain {
			if _, err := s.store.BumpChangeSeq(ctx, tx, rec.ProjectID); err != nil {
				return err
			}
		}
		return s.store.AddAudit(ctx, tx, c.user.Email, "segment.scored", rec.ProjectSlug,
			rec.KeyName+" ("+rec.Language+") MQM "+fmtInt(score), &rec.ProjectID)
	})
	if err != nil {
		return errInternal(err)
	}
	return s.writeSegment(w, r, rec.ID, status)
}

func (s *Server) handleSegmentApprove(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	rec, fail := s.segmentFor(r, c, false)
	if fail != nil {
		return fail
	}
	assignment, fail := s.reviewRights(r, c, rec)
	if fail != nil {
		return fail
	}
	if !domain.SegmentMoveAllowed(rec.Status, domain.ActionApprove) {
		return errIllegalTransition(rec.Status, domain.StatusApproved)
	}
	if c.user.Role == "reviewer" && rec.Status != domain.StatusNeedsReview {
		return errIllegalTransition(rec.Status, domain.StatusApproved)
	}
	ctx := r.Context()
	err := s.store.InTx(ctx, func(tx pgx.Tx) error {
		if err := s.store.WriteSegment(ctx, tx, rec.ID, rec.Value, domain.StatusApproved, rec.Score,
			rec.Origin); err != nil {
			return err
		}
		if err := s.store.AddSegmentRevision(ctx, tx, rec.ID, c.user.Email, rec.Status,
			domain.StatusApproved, rec.Value, store.Now()); err != nil {
			return err
		}
		if rec.BranchMain {
			if _, err := s.store.BumpChangeSeq(ctx, tx, rec.ProjectID); err != nil {
				return err
			}
		}
		return s.store.AddAudit(ctx, tx, c.user.Email, "segment.approved", rec.ProjectSlug,
			rec.KeyName+" ("+rec.Language+")", &rec.ProjectID)
	})
	if err != nil {
		return errInternal(err)
	}
	if fail := s.finishAssignments(r, rec, assignment); fail != nil {
		return fail
	}
	return s.writeSegment(w, r, rec.ID, http.StatusOK)
}

func (s *Server) handleSegmentCorrect(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	var body struct {
		Value   string `json:"value"`
		Comment string `json:"comment"`
	}
	if fail := readJSON(r, &body); fail != nil {
		return fail
	}
	rec, fail := s.segmentFor(r, c, false)
	if fail != nil {
		return fail
	}
	assignment, fail := s.reviewRights(r, c, rec)
	if fail != nil {
		return fail
	}
	if !domain.SegmentMoveAllowed(rec.Status, domain.ActionCorrect) {
		return errIllegalTransition(rec.Status, domain.StatusApproved)
	}
	if !lengthBetween(body.Value, 1, 4000) {
		return errField("value", "Give a translation of 1 to 4,000 characters.")
	}
	if body.Comment != "" && !lengthBetween(body.Comment, 1, 2000) {
		return errField("comment", "Keep the comment to 2,000 characters.")
	}
	ctx := r.Context()
	err := s.store.InTx(ctx, func(tx pgx.Tx) error {
		origin := "review"
		if err := s.store.WriteSegment(ctx, tx, rec.ID, &body.Value, domain.StatusApproved, rec.Score,
			&origin); err != nil {
			return err
		}
		if body.Comment != "" {
			if _, err := s.store.AddComment(ctx, tx, rec.ID, c.user.Email, body.Comment, store.Now()); err != nil {
				return err
			}
		}
		if err := s.store.AddSegmentRevision(ctx, tx, rec.ID, c.user.Email, rec.Status,
			domain.StatusApproved, &body.Value, store.Now()); err != nil {
			return err
		}
		if rec.BranchMain {
			if _, err := s.store.BumpChangeSeq(ctx, tx, rec.ProjectID); err != nil {
				return err
			}
		}
		return s.store.AddAudit(ctx, tx, c.user.Email, "segment.corrected", rec.ProjectSlug,
			rec.KeyName+" ("+rec.Language+")", &rec.ProjectID)
	})
	if err != nil {
		return errInternal(err)
	}
	if fail := s.finishAssignments(r, rec, assignment); fail != nil {
		return fail
	}
	return s.writeSegment(w, r, rec.ID, http.StatusOK)
}

// reviewRights decides whether the caller may act on a segment under review.
func (s *Server) reviewRights(r *http.Request, c *call, rec *store.SegmentRecord) (*store.Assignment, *apiError) {
	if rec.KeyDeleted {
		return nil, errConflict("key_removed", "This key was removed on "+rec.BranchName+".")
	}
	if c.user.Role != "reviewer" {
		return nil, nil
	}
	assignment, err := s.store.ActiveAssignmentOf(r.Context(), s.store.Pool, rec.ID, c.user.ID)
	if errors.Is(err, store.ErrNotFound) {
		return nil, errNotFound()
	}
	if err != nil {
		return nil, errInternal(err)
	}
	if assignment.State == "expired" {
		return nil, errConflict("assignment_expired",
			"This assignment expired. Ask the engineer to assign it again.")
	}
	return assignment, nil
}

// finishAssignments completes every assignment whose live segments are all
// approved, queueing one review.completed event each.
func (s *Server) finishAssignments(r *http.Request, rec *store.SegmentRecord, known *store.Assignment) *apiError {
	ctx := r.Context()
	assignments, err := s.store.AssignmentsHolding(ctx, s.store.Pool, rec.ID)
	if err != nil {
		return errInternal(err)
	}
	if known != nil {
		found := false
		for _, a := range assignments {
			if a.ID == known.ID {
				found = true
			}
		}
		if !found {
			assignments = append(assignments, *known)
		}
	}
	for _, assignment := range assignments {
		done, approved, err := s.store.CompleteAssignmentIfDone(ctx, s.store.Pool, assignment.ID)
		if err != nil {
			return errInternal(err)
		}
		if !done {
			continue
		}
		if err := s.store.AddAudit(ctx, s.store.Pool, "system", "review.completed", rec.ProjectSlug,
			assignment.Branch+" "+assignment.Language, &rec.ProjectID); err != nil {
			return errInternal(err)
		}
		if fail := s.queueReviewCompleted(ctx, rec.ProjectID, rec.ProjectSlug, assignment, approved); fail != nil {
			return fail
		}
	}
	return nil
}

func (s *Server) handleSegmentComment(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	var body struct {
		Body string `json:"body"`
	}
	if fail := readJSON(r, &body); fail != nil {
		return fail
	}
	rec, fail := s.segmentFor(r, c, false)
	if fail != nil {
		return fail
	}
	if c.user.Role == "reviewer" {
		if _, fail := s.reviewRights(r, c, rec); fail != nil {
			return fail
		}
	}
	if !lengthBetween(body.Body, 1, 2000) {
		return errField("body", "Write a comment of 1 to 2,000 characters.")
	}
	ctx := r.Context()
	var comment domain.Comment
	err := s.store.InTx(ctx, func(tx pgx.Tx) error {
		added, err := s.store.AddComment(ctx, tx, rec.ID, c.user.Email, body.Body, store.Now())
		if err != nil {
			return err
		}
		comment = added
		if rec.BranchMain {
			if _, err := s.store.BumpChangeSeq(ctx, tx, rec.ProjectID); err != nil {
				return err
			}
		}
		return s.store.AddAudit(ctx, tx, c.user.Email, "segment.commented", rec.ProjectSlug,
			rec.KeyName+" ("+rec.Language+")", &rec.ProjectID)
	})
	if err != nil {
		return errInternal(err)
	}
	writeJSON(w, http.StatusCreated, comment)
	return nil
}

func (s *Server) handleTMMatch(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	var body struct {
		Source   string `json:"source"`
		Language string `json:"language"`
	}
	if fail := readJSON(r, &body); fail != nil {
		return fail
	}
	if strings.TrimSpace(body.Source) == "" {
		return errField("source", "Give the source string to look up.")
	}
	if !containsString(c.project.TargetLanguages, body.Language) {
		return errField("language", "That language is not a target of this project.")
	}
	match, err := s.store.MatchEntry(r.Context(), s.store.Pool, c.project.ID, body.Language,
		domain.Normalise(body.Source))
	if err != nil {
		return errInternal(err)
	}
	if match == nil {
		writeJSON(w, http.StatusOK, map[string]any{"match": nil})
		return nil
	}
	writeJSON(w, http.StatusOK, map[string]any{"match": map[string]any{
		"entry_id": match.EntryID, "source": match.Source, "target": match.Target,
		"reused_value": domain.ReuseValue(match.Source, match.Target, body.Source),
	}})
	return nil
}

// handleDrafts fills a language's untranslated segments from the memory first
// and otherwise from the engine routed for that language.
func (s *Server) handleDrafts(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	var body struct {
		Language string `json:"language"`
	}
	if fail := readJSON(r, &body); fail != nil {
		return fail
	}
	branch, fail := s.branchFor(r, c.project, r.PathValue("branch"))
	if fail != nil {
		return fail
	}
	if fail := requireOpen(branch); fail != nil {
		return fail
	}
	if !containsString(c.project.TargetLanguages, body.Language) {
		return errField("language", "That language is not a target of this project.")
	}
	ctx := r.Context()
	set, err := s.store.LoadKeySet(ctx, s.store.Pool, branch.ID)
	if err != nil {
		return errInternal(err)
	}
	type todo struct {
		keyID     string
		keyName   string
		keySource string
		segmentID string
	}
	var queue []todo
	for _, key := range set {
		segment := key.Segments[body.Language]
		if segment == nil || segment.Status != domain.StatusUntranslated {
			continue
		}
		queue = append(queue, todo{key.KeyID, key.Name, key.Source, segment.ID})
	}
	sort.Slice(queue, func(i, j int) bool { return queue[i].keyName < queue[j].keyName })

	engine := c.project.AIRoutes[body.Language]
	reused, drafted := 0, 0
	for _, item := range queue {
		filled, err := s.store.FillFromMemory(ctx, s.store.Pool, c.project, branch.ID, item.keyID,
			item.keySource, c.user.Email)
		if err != nil {
			return errInternal(err)
		}
		if filled > 0 {
			reused++
			continue
		}
		draft, err := s.ai.Draft(ctx, engine, c.project.SourceLanguage, body.Language, item.keyName, item.keySource)
		if err != nil {
			s.prober.Invalidate()
			return errAIEngineUnavailable(reused, drafted)
		}
		score := domain.MQMScore(item.keySource, draft.Issues)
		next := domain.ScoredStatus(score, c.project.MQMThreshold)
		origin := "ai:" + engine
		err = s.store.InTx(ctx, func(tx pgx.Tx) error {
			now := store.Now()
			if err := s.store.WriteSegment(ctx, tx, item.segmentID, &draft.Text, next, &score, &origin); err != nil {
				return err
			}
			if err := s.store.ReplaceIssues(ctx, tx, item.segmentID, draft.Issues); err != nil {
				return err
			}
			if err := s.store.AddSegmentRevision(ctx, tx, item.segmentID, "system",
				domain.StatusUntranslated, domain.StatusDrafted, &draft.Text, now); err != nil {
				return err
			}
			return s.store.AddSegmentRevision(ctx, tx, item.segmentID, "system", domain.StatusDrafted,
				next, &draft.Text, now)
		})
		if err != nil {
			return errInternal(err)
		}
		drafted++
	}
	if branch.IsMain && (reused+drafted) > 0 {
		if _, err := s.store.BumpChangeSeq(ctx, s.store.Pool, c.project.ID); err != nil {
			return errInternal(err)
		}
	}
	if err := s.store.AddAudit(ctx, s.store.Pool, c.user.Email, "draft.run", c.project.Slug,
		branch.Name+" "+body.Language, &c.project.ID); err != nil {
		return errInternal(err)
	}
	writeJSON(w, http.StatusOK, map[string]int{"tm_reused": reused, "ai_drafted": drafted})
	return nil
}
