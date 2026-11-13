package api

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/marlowquill/interline-desk/internal/store"
)

func (s *Server) handleListReviewers(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	reviewers, err := s.store.Reviewers(r.Context(), c.project.ID)
	if err != nil {
		return errInternal(err)
	}
	bodies := []map[string]any{}
	for _, reviewer := range reviewers {
		bodies = append(bodies, map[string]any{"id": reviewer.ID, "name": reviewer.Name, "email": reviewer.Email})
	}
	writeJSON(w, http.StatusOK, map[string]any{"reviewers": bodies})
	return nil
}

func (s *Server) handleInviteReviewer(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	var body struct {
		Name  string `json:"name"`
		Email string `json:"email"`
	}
	if fail := readJSON(r, &body); fail != nil {
		return fail
	}
	name := strings.TrimSpace(body.Name)
	email := strings.ToLower(strings.TrimSpace(body.Email))
	fields := map[string]string{}
	if !lengthBetween(name, 1, 80) {
		fields["name"] = "Give the reviewer a name of 1 to 80 characters."
	}
	if !strings.Contains(email, "@") || !lengthBetween(email, 3, 160) {
		fields["email"] = "Give the reviewer's email address."
	}
	if len(fields) > 0 {
		return errValidation(fields)
	}
	ctx := r.Context()
	reviewer, accessKey, created, err := s.store.InviteReviewer(ctx, c.project.ID, name, email)
	if errors.Is(err, store.ErrReviewerExists) {
		return errConflict("reviewer_exists", "That reviewer already has access to this project.")
	}
	if err != nil {
		return errInternal(err)
	}
	if err := s.store.AddAudit(ctx, s.store.Pool, c.user.Email, "reviewer.invited", c.project.Slug,
		reviewer.Email, &c.project.ID); err != nil {
		return errInternal(err)
	}
	body2 := map[string]any{"id": reviewer.ID, "name": reviewer.Name, "email": reviewer.Email,
		"access_key": nil}
	status := http.StatusOK
	if created {
		body2["access_key"] = accessKey
		status = http.StatusCreated
	}
	writeJSON(w, status, body2)
	return nil
}

func (s *Server) handleRemoveReviewer(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	ctx := r.Context()
	if err := s.store.RemoveReviewer(ctx, c.project.ID, r.PathValue("id")); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return errNotFound()
		}
		return errInternal(err)
	}
	if err := s.store.AddAudit(ctx, s.store.Pool, c.user.Email, "reviewer.removed", c.project.Slug,
		r.PathValue("id"), &c.project.ID); err != nil {
		return errInternal(err)
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Server) handleCreateAssignment(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	var body struct {
		ReviewerID string `json:"reviewer_id"`
		Branch     string `json:"branch"`
		Language   string `json:"language"`
	}
	if fail := readJSON(r, &body); fail != nil {
		return fail
	}
	branch, fail := s.branchFor(r, c.project, body.Branch)
	if fail != nil {
		return fail
	}
	if fail := requireLive(branch); fail != nil {
		return fail
	}
	if !containsString(c.project.TargetLanguages, body.Language) {
		return errField("language", "That language is not a target of this project.")
	}
	ctx := r.Context()
	reviewers, err := s.store.Reviewers(ctx, c.project.ID)
	if err != nil {
		return errInternal(err)
	}
	known := false
	for _, reviewer := range reviewers {
		if reviewer.ID == body.ReviewerID {
			known = true
		}
	}
	if !known {
		return errField("reviewer_id", "Invite that reviewer to this project first.")
	}
	assignment, err := s.store.CreateAssignment(ctx, c.project, body.ReviewerID, branch.Name, body.Language,
		s.cfg.AssignmentTTL)
	if errors.Is(err, store.ErrNoSegmentsToReview) {
		return errConflict("no_segments_to_review", "There are no unassigned segments that need review.")
	}
	if err != nil {
		return errInternal(err)
	}
	if err := s.store.AddAudit(ctx, s.store.Pool, c.user.Email, "review.assigned", c.project.Slug,
		branch.Name+" "+body.Language, &c.project.ID); err != nil {
		return errInternal(err)
	}
	writeJSON(w, http.StatusCreated, assignment)
	return nil
}

func (s *Server) handleListAssignments(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	assignments, err := s.store.Assignments(r.Context(), c.project.ID)
	if err != nil {
		return errInternal(err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"assignments": assignments})
	return nil
}

func (s *Server) handleReviewQueue(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	language := r.URL.Query().Get("lang")
	segments, err := s.store.ReviewQueue(r.Context(), c.user, language)
	if err != nil {
		return errInternal(err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"segments": segments})
	return nil
}

// queueReviewCompleted queues the one review.completed event of an assignment.
func (s *Server) queueReviewCompleted(ctx context.Context, projectID, slug string, assignment store.Assignment, approved int) *apiError {
	hook, err := s.store.Webhook(ctx, projectID)
	if errors.Is(err, store.ErrNotFound) {
		return nil
	}
	if err != nil {
		return errInternal(err)
	}
	eventID := "evt_rev_" + assignment.ID
	payload := map[string]any{
		"event_id": eventID, "type": "review.completed", "project": slug, "branch": assignment.Branch,
		"language": assignment.Language, "assignment_id": assignment.ID, "reviewer_id": assignment.ReviewerID,
		"segments_approved": approved, "completed_at": store.Now().Format(timeLayout),
	}
	if err := s.store.QueueEvent(ctx, projectID, eventID, "review.completed", hook.AppUID, payload); err != nil {
		return errInternal(err)
	}
	s.notifyEventQueued(eventID)
	return nil
}
