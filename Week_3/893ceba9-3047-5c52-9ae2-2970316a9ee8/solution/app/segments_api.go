package main

import (
	"context"
	"fmt"
	"net/http"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// segmentAccess says who may call a segment endpoint besides the owner.
type segmentAccess int

const (
	ownerOnly segmentAccess = iota
	ownerOrAssigned
)

// assignedEver reports whether a reviewer was ever given the segment.
func (a *App) assignedEver(ctx context.Context, q db, reviewerID, segmentID string) (bool, error) {
	var n int
	err := q.QueryRow(ctx, `SELECT count(*) FROM assignment_segments x JOIN assignments a ON a.id = x.assignment_id
		WHERE a.reviewer_id = $1 AND x.segment_id = $2`, reviewerID, segmentID).Scan(&n)
	if err != nil {
		return false, fmt.Errorf("check assignment: %w", err)
	}
	return n > 0, nil
}

// segmentFor loads a segment for the caller: 404 outside their scope, 403 when the endpoint is owner-only.
func (a *App) segmentFor(ctx context.Context, q db, pr *Principal, id string, access segmentAccess) (*Segment, error) {
	s, err := segmentByID(ctx, q, id)
	if err != nil {
		return nil, err
	}
	if pr.isOwner() {
		return s, nil
	}
	assigned, err := a.assignedEver(ctx, q, pr.ID, id)
	if err != nil {
		return nil, err
	}
	if !assigned {
		return nil, errNotFound()
	}
	if access == ownerOnly {
		return nil, errForbidden()
	}
	return s, nil
}

func (a *App) handleGetSegment(w http.ResponseWriter, r *http.Request) error {
	pr, err := a.authn(r)
	if err != nil {
		return err
	}
	s, err := a.segmentFor(r.Context(), a.pool, pr, r.PathValue("id"), ownerOrAssigned)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, s.json())
	return nil
}

// segmentChange is one mutation of a segment run under the project lock.
type segmentChange struct {
	access   segmentAccess
	editable bool // true: the branch must be `open`; false: `open` or `in_review` is enough
	apply    func(ctx context.Context, tx pgx.Tx, p *Project, s *Segment, at time.Time) (action, detail string, err error)
}

// changeSegment runs the precedence for segment endpoints and saves the result, touching main and auditing.
func (a *App) changeSegment(r *http.Request, pr *Principal, id string, ch segmentChange) (*Segment, error) {
	ctx := r.Context()
	first, err := a.segmentFor(ctx, a.pool, pr, id, ch.access)
	if err != nil {
		return nil, err
	}
	var out *Segment
	err = a.inProject(ctx, first.ProjectID, func(tx pgx.Tx) error {
		p, err := projectByID(ctx, tx, first.ProjectID)
		if err != nil {
			return err
		}
		s, err := segmentByID(ctx, tx, id)
		if err != nil {
			return err
		}
		b := &Branch{State: s.BranchState, IsMain: s.BranchMain}
		if ch.editable {
			err = b.requireEditable()
		} else {
			err = b.requireLive()
		}
		if err != nil {
			return err
		}
		action, detail, err := ch.apply(ctx, tx, p, s, now())
		if err != nil {
			return err
		}
		if err := s.save(ctx, tx); err != nil {
			return err
		}
		if err := touch(ctx, tx, p.ID, b); err != nil {
			return err
		}
		if err := a.audit(ctx, tx, pr.Email, action, p, detail); err != nil {
			return err
		}
		out = s
		return nil
	})
	return out, err
}

func segmentDetail(s *Segment) string {
	return s.BranchName + ": " + s.KeyName + " (" + s.Language + ")"
}

func (a *App) handlePutValue(w http.ResponseWriter, r *http.Request) error {
	pr, err := a.authn(r)
	if err != nil {
		return err
	}
	if _, err := a.segmentFor(r.Context(), a.pool, pr, r.PathValue("id"), ownerOnly); err != nil {
		return err
	}
	var in struct {
		Value string `json:"value"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	s, err := a.changeSegment(r, pr, r.PathValue("id"), segmentChange{access: ownerOnly, editable: true,
		apply: func(ctx context.Context, tx pgx.Tx, p *Project, s *Segment, at time.Time) (string, string, error) {
			if e := validValue("value", in.Value); e != nil {
				return "", "", e
			}
			s.setValue(in.Value, "manual", pr.Email, at)
			return "segment.edited", segmentDetail(s), nil
		}})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, s.json())
	return nil
}

func checkIssues(in []Issue) ([]Issue, *apiError) {
	out := make([]Issue, 0, len(in))
	for _, issue := range in {
		if e := validIssue(issue); e != nil {
			return nil, e
		}
		out = append(out, issue)
	}
	return out, nil
}

func (a *App) handleScore(w http.ResponseWriter, r *http.Request) error {
	pr, err := a.authn(r)
	if err != nil {
		return err
	}
	if _, err := a.segmentFor(r.Context(), a.pool, pr, r.PathValue("id"), ownerOnly); err != nil {
		return err
	}
	var in struct {
		Issues []Issue `json:"issues"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	s, err := a.changeSegment(r, pr, r.PathValue("id"), segmentChange{access: ownerOnly,
		apply: func(ctx context.Context, tx pgx.Tx, p *Project, s *Segment, at time.Time) (string, string, error) {
			if err := allowMove("score", s.Status); err != nil {
				return "", "", err
			}
			issues, e := checkIssues(in.Issues)
			if e != nil {
				return "", "", e
			}
			s.rescore(issues, pr.Email, at)
			return "segment.scored", segmentDetail(s), nil
		}})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, s.json())
	return nil
}

func (a *App) handleAddIssue(w http.ResponseWriter, r *http.Request) error {
	pr, err := a.authn(r)
	if err != nil {
		return err
	}
	if _, err := a.segmentFor(r.Context(), a.pool, pr, r.PathValue("id"), ownerOnly); err != nil {
		return err
	}
	var in Issue
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	s, err := a.changeSegment(r, pr, r.PathValue("id"), segmentChange{access: ownerOnly,
		apply: func(ctx context.Context, tx pgx.Tx, p *Project, s *Segment, at time.Time) (string, string, error) {
			if err := allowMove("score", s.Status); err != nil {
				return "", "", err
			}
			if e := validIssue(in); e != nil {
				return "", "", e
			}
			s.rescore(append(append([]Issue{}, s.Issues...), in), pr.Email, at)
			return "segment.issue_added", segmentDetail(s), nil
		}})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, s.json())
	return nil
}

// reviewCheck applies the reviewer's limits: an active assignment, a live key and a segment that needs review.
func (a *App) reviewCheck(ctx context.Context, tx pgx.Tx, pr *Principal, s *Segment, at time.Time) error {
	if !pr.isOwner() {
		rows, err := tx.Query(ctx, `SELECT a.state, a.expires_at FROM assignment_segments x JOIN assignments a ON a.id = x.assignment_id
			WHERE a.reviewer_id = $1 AND x.segment_id = $2`, pr.ID, s.ID)
		if err != nil {
			return fmt.Errorf("list assignments: %w", err)
		}
		active, expired := false, false
		for rows.Next() {
			var state string
			var expires time.Time
			if err := rows.Scan(&state, &expires); err != nil {
				rows.Close()
				return fmt.Errorf("scan assignment: %w", err)
			}
			switch {
			case state == "active" && expires.After(at):
				active = true
			case state == "active" || state == "expired":
				expired = true
			}
		}
		rows.Close()
		if !active && expired {
			return newErr(http.StatusConflict, "assignment_expired", "This assignment expired. Ask the engineer to assign it again.")
		}
	}
	if s.Removed {
		return newErr(http.StatusConflict, "key_removed", "This key was removed on "+s.BranchName+".")
	}
	if !pr.isOwner() && s.Status != statusNeedsReview {
		return errIllegalTransition(s.Status, statusApproved)
	}
	return nil
}

func (a *App) handleApprove(w http.ResponseWriter, r *http.Request) error {
	pr, err := a.authn(r)
	if err != nil {
		return err
	}
	if _, err := a.segmentFor(r.Context(), a.pool, pr, r.PathValue("id"), ownerOrAssigned); err != nil {
		return err
	}
	if err := decodeJSON(r, &struct{}{}); err != nil {
		return err
	}
	s, err := a.changeSegment(r, pr, r.PathValue("id"), segmentChange{access: ownerOrAssigned,
		apply: func(ctx context.Context, tx pgx.Tx, p *Project, s *Segment, at time.Time) (string, string, error) {
			if err := a.reviewCheck(ctx, tx, pr, s, at); err != nil {
				return "", "", err
			}
			if err := allowMove("approve", s.Status); err != nil {
				return "", "", err
			}
			s.approve(pr.Email, at)
			if err := s.save(ctx, tx); err != nil {
				return "", "", err
			}
			if err := a.completeAssignments(ctx, tx, p, s, at); err != nil {
				return "", "", err
			}
			return "segment.approved", segmentDetail(s), nil
		}})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, s.json())
	return nil
}

func (a *App) handleCorrect(w http.ResponseWriter, r *http.Request) error {
	pr, err := a.authn(r)
	if err != nil {
		return err
	}
	if _, err := a.segmentFor(r.Context(), a.pool, pr, r.PathValue("id"), ownerOrAssigned); err != nil {
		return err
	}
	var in struct {
		Value   string `json:"value"`
		Comment string `json:"comment"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	s, err := a.changeSegment(r, pr, r.PathValue("id"), segmentChange{access: ownerOrAssigned,
		apply: func(ctx context.Context, tx pgx.Tx, p *Project, s *Segment, at time.Time) (string, string, error) {
			if err := a.reviewCheck(ctx, tx, pr, s, at); err != nil {
				return "", "", err
			}
			if err := allowMove("correct", s.Status); err != nil {
				return "", "", err
			}
			fields := map[string]string{}
			if e := validValue("value", in.Value); e != nil {
				fields["value"] = e.Fields["value"]
			}
			if utf8.RuneCountInString(in.Comment) > 2000 {
				fields["comment"] = "Use 2,000 characters or fewer."
			}
			if len(fields) > 0 {
				return "", "", errValidation(fields)
			}
			s.correct(in.Value, in.Comment, pr.Email, at)
			if err := s.save(ctx, tx); err != nil {
				return "", "", err
			}
			if err := a.completeAssignments(ctx, tx, p, s, at); err != nil {
				return "", "", err
			}
			return "segment.corrected", segmentDetail(s), nil
		}})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, s.json())
	return nil
}

func (a *App) handleComment(w http.ResponseWriter, r *http.Request) error {
	pr, err := a.authn(r)
	if err != nil {
		return err
	}
	if _, err := a.segmentFor(r.Context(), a.pool, pr, r.PathValue("id"), ownerOrAssigned); err != nil {
		return err
	}
	var in struct {
		Body string `json:"body"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	var comment Comment
	_, err = a.changeSegment(r, pr, r.PathValue("id"), segmentChange{access: ownerOrAssigned,
		apply: func(ctx context.Context, tx pgx.Tx, p *Project, s *Segment, at time.Time) (string, string, error) {
			if n := utf8.RuneCountInString(in.Body); n < 1 || n > 2000 {
				return "", "", errField("body", "Use 1 to 2,000 characters.")
			}
			comment = Comment{ID: newID(), Author: pr.Email, Body: in.Body, At: fmtTime(at)}
			s.Comments = append(s.Comments, comment)
			return "segment.commented", segmentDetail(s), nil
		}})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, comment)
	return nil
}

// completeAssignments closes every active assignment whose live segments are now all approved
// and queues its review.completed event.
func (a *App) completeAssignments(ctx context.Context, tx pgx.Tx, p *Project, s *Segment, at time.Time) error {
	rows, err := tx.Query(ctx, `SELECT a.id, a.reviewer_id, a.language, b.name FROM assignments a
		JOIN assignment_segments x ON x.assignment_id = a.id JOIN branches b ON b.id = a.branch_id
		WHERE x.segment_id = $1 AND a.state = 'active' AND a.expires_at > $2`, s.ID, at)
	if err != nil {
		return fmt.Errorf("list assignments of segment: %w", err)
	}
	type open struct{ id, reviewer, language, branch string }
	var candidates []open
	for rows.Next() {
		var o open
		if err := rows.Scan(&o.id, &o.reviewer, &o.language, &o.branch); err != nil {
			rows.Close()
			return fmt.Errorf("scan assignment: %w", err)
		}
		candidates = append(candidates, o)
	}
	rows.Close()
	for _, o := range candidates {
		var live, pending int
		err := tx.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE sg.status <> 'approved') FROM assignment_segments x
			JOIN segments sg ON sg.id = x.segment_id JOIN branch_keys k ON k.branch_id = sg.branch_id AND k.key_id = sg.key_id
			WHERE x.assignment_id = $1 AND NOT k.deleted`, o.id).Scan(&live, &pending)
		if err != nil {
			return fmt.Errorf("count assignment segments: %w", err)
		}
		if live == 0 || pending > 0 {
			continue
		}
		if _, err := tx.Exec(ctx, "UPDATE assignments SET state = 'completed' WHERE id = $1", o.id); err != nil {
			return fmt.Errorf("complete assignment: %w", err)
		}
		payload := map[string]any{"event_id": "evt_rev_" + o.id, "type": "review.completed", "project": p.Slug, "branch": o.branch,
			"language": o.language, "assignment_id": o.id, "reviewer_id": o.reviewer, "segments_approved": live, "completed_at": fmtTime(at)}
		if err := a.queueEvent(ctx, tx, p, "evt_rev_"+o.id, "review.completed", payload); err != nil {
			return err
		}
		if err := a.audit(ctx, tx, "system", "assignment.completed", p, o.branch+" ("+o.language+")"); err != nil {
			return err
		}
	}
	return nil
}
