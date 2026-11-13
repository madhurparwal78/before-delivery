package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/marlowquill/interline-desk/internal/domain"
	"github.com/marlowquill/interline-desk/internal/s3lite"
	"github.com/marlowquill/interline-desk/internal/store"
)

func (s *Server) handleHold(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	branch, fail := s.branchFor(r, c.project, r.PathValue("branch"))
	if fail != nil {
		return fail
	}
	if fail := requireLive(branch); fail != nil {
		return fail
	}
	conflictID := r.PathValue("conflict_id")
	view, fail := s.previewBranch(r, c.project, branch.Name)
	if fail != nil {
		return fail
	}
	if findConflict(view, conflictID) == nil {
		return errNotFound()
	}
	until, holder, err := s.store.TakeHold(r.Context(), branch.ID, conflictID, c.sessionID, s.cfg.ConflictHold)
	if err != nil {
		return errInternal(err)
	}
	if holder == "" {
		return errConflictDetails("conflict_held", "This conflict is being resolved in another session.",
			heldUntilDetails(until))
	}
	writeJSON(w, http.StatusOK, map[string]any{"conflict_id": conflictID,
		"held_until": until.Format(time.RFC3339)})
	return nil
}

func findConflict(view *previewView, id string) *domain.Conflict {
	for i := range view.Conflicts {
		if view.Conflicts[i].ID == id {
			return &view.Conflicts[i]
		}
	}
	return nil
}

func (s *Server) handleResolve(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	var body struct {
		Choice string  `json:"choice"`
		Value  *string `json:"value"`
	}
	if fail := readJSON(r, &body); fail != nil {
		return fail
	}
	branch, fail := s.branchFor(r, c.project, r.PathValue("branch"))
	if fail != nil {
		return fail
	}
	if fail := requireLive(branch); fail != nil {
		return fail
	}
	conflictID := r.PathValue("conflict_id")
	view, fail := s.previewBranch(r, c.project, branch.Name)
	if fail != nil {
		return fail
	}
	conflict := findConflict(view, conflictID)
	if conflict == nil {
		return errNotFound()
	}
	switch body.Choice {
	case "main", "branch":
	case "custom":
		if body.Value == nil || !lengthBetween(*body.Value, 1, 4000) {
			return errField("value", "Write the value to keep.")
		}
	default:
		return errField("choice", "Choose main, branch or custom.")
	}
	ctx := r.Context()
	held, err := s.store.HoldBySession(ctx, s.store.Pool, branch.ID, conflictID, c.sessionID)
	if err != nil {
		return errInternal(err)
	}
	if !held {
		holds, err := s.store.Holds(ctx, s.store.Pool, branch.ID)
		if err != nil {
			return errInternal(err)
		}
		if until, ok := holds[conflictID]; ok {
			return errConflictDetails("conflict_held", "This conflict is being resolved in another session.",
				heldUntilDetails(until))
		}
		return errConflict("hold_required", "Your hold on this conflict ran out. Hold it again to resolve it.")
	}
	resolution := &domain.Resolution{Choice: body.Choice, Value: body.Value, By: c.user.Email,
		At: store.Now(), MainSeen: conflict.Main}
	if body.Choice == "main" {
		resolution.Value = conflict.Main
	}
	if body.Choice == "branch" {
		resolution.Value = conflict.Branch
	}
	err = s.store.InTx(ctx, func(tx pgx.Tx) error {
		if err := s.store.SaveResolution(ctx, tx, branch.ID, conflictID, resolution); err != nil {
			return err
		}
		if err := s.store.ReleaseHold(ctx, tx, branch.ID, conflictID); err != nil {
			return err
		}
		return s.store.AddAudit(ctx, tx, c.user.Email, "conflict.resolved", c.project.Slug,
			conflictID+" as "+body.Choice, &c.project.ID)
	})
	if err != nil {
		return errInternal(err)
	}
	conflict.Resolution = resolution
	conflict.HeldUntil = nil
	writeJSON(w, http.StatusOK, conflict)
	return nil
}

// handleMerge applies every change and resolution of a branch to main.
func (s *Server) handleMerge(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	branch, fail := s.branchFor(r, c.project, r.PathValue("branch"))
	if fail != nil {
		return fail
	}
	if branch.IsMain || branch.State != domain.BranchInReview {
		return errIllegalTransition(branch.Reported(), domain.BranchMerged)
	}
	view, fail := s.previewBranch(r, c.project, branch.Name)
	if fail != nil {
		return fail
	}
	if unresolved := view.unresolved(); len(unresolved) > 0 {
		return errConflictDetails("conflicts_unresolved", "Resolve every conflict before merging.",
			map[string]any{"conflicts": unresolved})
	}

	ctx := r.Context()
	mergeID := store.NewID()
	snapshot, err := s.store.TakeSnapshot(ctx, s.store.Pool, c.project.ID, view.MainRow.ID)
	if err != nil {
		return errInternal(err)
	}
	encoded, err := snapshot.Encode()
	if err != nil {
		return errInternal(err)
	}
	snapshotKey := fmt.Sprintf("projects/%s/snapshots/%s.json", c.project.ID, mergeID)
	storeCtx, cancel := withTimeout(ctx, 15*time.Second)
	defer cancel()
	if err := s.objects.Put(storeCtx, snapshotKey, "application/json", encoded); err != nil {
		return errStorageUnavailable()
	}

	applied := map[string]int{"new_keys": 0, "edited_keys": 0, "deleted_keys": 0, "conflicts_resolved": 0}
	err = s.store.InTx(ctx, func(tx pgx.Tx) error {
		var state string
		if err := tx.QueryRow(ctx, `select state from branches where id = $1 for update`, branch.ID).
			Scan(&state); err != nil {
			return fmt.Errorf("lock branch: %w", err)
		}
		if state != domain.BranchInReview {
			return errRaced
		}
		counts, err := s.applyMerge(ctx, tx, c, view, mergeID, snapshotKey)
		if err != nil {
			return err
		}
		applied = counts
		return nil
	})
	if errors.Is(err, errRaced) {
		return errIllegalTransition(domain.BranchMerged, domain.BranchMerged)
	}
	if err != nil {
		return errInternal(err)
	}
	body := map[string]any{"merge_id": mergeID, "new_keys": applied["new_keys"],
		"edited_keys": applied["edited_keys"], "deleted_keys": applied["deleted_keys"],
		"conflicts_resolved": applied["conflicts_resolved"]}
	writeJSON(w, http.StatusOK, body)
	return nil
}

// errRaced reports that another caller won a race for the same branch.
var errRaced = errors.New("another caller changed this first")

func (s *Server) applyMerge(ctx context.Context, tx pgx.Tx, c *call, view *previewView, mergeID, snapshotKey string) (map[string]int, error) {
	project := c.project
	main := view.MainRow
	branch := view.BranchRow
	now := store.Now()
	counts := map[string]int{"new_keys": 0, "edited_keys": 0, "deleted_keys": 0, "conflicts_resolved": 0}

	if err := s.store.InsertOperation(ctx, tx, project.ID, mergeID, "merge",
		"Merge "+branch.Name+" into main", branch.Name, snapshotKey, now); err != nil {
		return nil, err
	}

	classified := domain.Classify(view.BaseSet, view.BranchSet, view.MainSet, project.TargetLanguages)
	for _, keyID := range classified.NewKeys {
		key := view.BranchSet[keyID]
		if err := s.store.CopyKeySet(ctx, tx, project, main.ID,
			domain.KeySet{keyID: key}); err != nil {
			return nil, err
		}
		if err := s.store.AddKeyRevision(ctx, tx, project.ID, keyID, "main", "merged", nil, &key.Source,
			c.user.Email, now); err != nil {
			return nil, err
		}
		counts["new_keys"]++
	}
	for _, keyID := range classified.DeletedKeys {
		if _, err := tx.Exec(ctx, `update keys set deleted = true where branch_id = $1 and key_id = $2`,
			main.ID, keyID); err != nil {
			return nil, fmt.Errorf("apply deletion: %w", err)
		}
		name := view.BaseSet[keyID].Name
		if err := s.store.AddKeyRevision(ctx, tx, project.ID, keyID, "main", "deleted", &name, nil,
			c.user.Email, now); err != nil {
			return nil, err
		}
		counts["deleted_keys"]++
	}
	edited := map[string]bool{}
	for _, edit := range classified.Edits {
		if err := s.applyFieldValue(ctx, tx, project, view, main.ID, edit.KeyID, edit.Field,
			fieldFrom(view.BranchSet, edit.KeyID, edit.Field), c.user.Email, now); err != nil {
			return nil, err
		}
		edited[edit.KeyID] = true
	}
	counts["edited_keys"] = len(edited)

	resolutions, err := s.store.Resolutions(ctx, tx, branch.ID)
	if err != nil {
		return nil, err
	}
	for _, conflict := range view.Conflicts {
		resolution := resolutions[conflict.ID]
		if resolution == nil {
			continue
		}
		counts["conflicts_resolved"]++
		switch conflict.Field {
		case "presence":
			if resolution.Choice == "branch" && *conflict.Branch == "deleted" {
				if _, err := tx.Exec(ctx, `update keys set deleted = true where branch_id = $1
				        and key_id = $2`, main.ID, conflict.KeyID); err != nil {
					return nil, fmt.Errorf("apply presence resolution: %w", err)
				}
			}
			if resolution.Choice == "branch" && *conflict.Branch == "changed" {
				if key, ok := view.BranchSet[conflict.KeyID]; ok {
					if err := s.store.CopyKeySet(ctx, tx, project, main.ID,
						domain.KeySet{conflict.KeyID: key}); err != nil {
						return nil, err
					}
				}
			}
		default:
			if err := s.applyFieldValue(ctx, tx, project, view, main.ID, conflict.KeyID, conflict.Field,
				resolution.Value, c.user.Email, now); err != nil {
				return nil, err
			}
		}
	}

	if err := s.store.SetBranchState(ctx, tx, branch.ID, domain.BranchMerged); err != nil {
		return nil, err
	}
	seq, err := s.store.BumpChangeSeq(ctx, tx, project.ID)
	if err != nil {
		return nil, err
	}
	if err := s.store.SealOperation(ctx, tx, mergeID, seq); err != nil {
		return nil, err
	}
	if err := s.store.AddAudit(ctx, tx, c.user.Email, "branch.merged", project.Slug, branch.Name,
		&project.ID); err != nil {
		return nil, err
	}
	return counts, nil
}

func fieldFrom(set domain.KeySet, keyID, field string) *string {
	key, ok := set[keyID]
	if !ok {
		return nil
	}
	switch field {
	case "name":
		name := key.Name
		return &name
	case "source":
		source := key.Source
		return &source
	}
	language := strings.TrimPrefix(field, "translation:")
	if segment, ok := key.Segments[language]; ok {
		return segment.Value
	}
	return nil
}

// applyFieldValue writes one merged field onto main, carrying the status,
// score, issues and comments that travel with a translation value.
func (s *Server) applyFieldValue(ctx context.Context, tx pgx.Tx, project *store.Project, view *previewView, mainID, keyID, field string, value *string, actor string, now time.Time) error {
	switch field {
	case "name":
		if value == nil {
			return nil
		}
		previous := ""
		if key, ok := view.MainSet[keyID]; ok {
			previous = key.Name
		}
		if _, err := tx.Exec(ctx, `update keys set name = $3 where branch_id = $1 and key_id = $2`,
			mainID, keyID, *value); err != nil {
			return fmt.Errorf("apply name: %w", err)
		}
		return s.store.AddKeyRevision(ctx, tx, project.ID, keyID, "main", "name", &previous, value, actor, now)
	case "source":
		if value == nil {
			return nil
		}
		previous := ""
		if key, ok := view.MainSet[keyID]; ok {
			previous = key.Source
		}
		if _, err := tx.Exec(ctx, `update keys set source = $3 where branch_id = $1 and key_id = $2`,
			mainID, keyID, *value); err != nil {
			return fmt.Errorf("apply source: %w", err)
		}
		if err := s.store.AddKeyRevision(ctx, tx, project.ID, keyID, "main", "source", &previous, value,
			actor, now); err != nil {
			return err
		}
		return s.store.SourceChanged(ctx, tx, project, mainID, keyID, *value, actor)
	}

	language := strings.TrimPrefix(field, "translation:")
	target, err := s.store.SegmentByKeyLanguage(ctx, tx, mainID, keyID, language)
	if errors.Is(err, store.ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	source := branchSegment(view.BranchSet, keyID, language)
	if source != nil && sameString(source.Value, value) {
		if err := s.store.WriteSegment(ctx, tx, target.ID, source.Value, source.Status, source.Score,
			source.Origin); err != nil {
			return err
		}
		if err := s.store.ReplaceIssues(ctx, tx, target.ID, source.Issues); err != nil {
			return err
		}
		for _, comment := range source.Comments {
			if _, err := tx.Exec(ctx, `insert into segment_comments (id, segment_id, author, body, at)
			        values ($1,$2,$3,$4,$5) on conflict do nothing`, comment.ID, target.ID, comment.Author,
				comment.Body, comment.At); err != nil {
				return fmt.Errorf("carry comment: %w", err)
			}
		}
		return s.store.AddSegmentRevision(ctx, tx, target.ID, actor, target.Status, source.Status,
			source.Value, now)
	}
	status := domain.StatusUntranslated
	var score *int
	var origin *string
	if value != nil {
		status = domain.StatusDrafted
		manual := "manual"
		origin = &manual
	}
	if err := s.store.WriteSegment(ctx, tx, target.ID, value, status, score, origin); err != nil {
		return err
	}
	if err := s.store.ReplaceIssues(ctx, tx, target.ID, nil); err != nil {
		return err
	}
	return s.store.AddSegmentRevision(ctx, tx, target.ID, actor, target.Status, status, value, now)
}

func branchSegment(set domain.KeySet, keyID, language string) *domain.Segment {
	if key, ok := set[keyID]; ok {
		return key.Segments[language]
	}
	return nil
}

func (s *Server) handleOperations(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	operations, err := s.store.Operations(r.Context(), s.store.Pool, c.project.ID)
	if err != nil {
		return errInternal(err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"operations": operations})
	return nil
}

// handleRestore brings main and the memory back to an operation's snapshot.
func (s *Server) handleRestore(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	ctx := r.Context()
	operation, seqAfter, snapshotKey, err := s.store.Operation(ctx, s.store.Pool, c.project.ID,
		r.PathValue("op_id"))
	if errors.Is(err, store.ErrNotFound) {
		return errNotFound()
	}
	if err != nil {
		return errInternal(err)
	}
	if operation.RestoredAt != nil {
		return errConflict("already_restored", "This was already restored.")
	}
	seq, err := s.store.ChangeSeq(ctx, s.store.Pool, c.project.ID)
	if err != nil {
		return errInternal(err)
	}
	if seq != seqAfter {
		return errConflict("restore_superseded",
			"Later changes were made after this, so it can't be restored exactly.")
	}
	readCtx, cancel := withTimeout(ctx, 15*time.Second)
	defer cancel()
	object, err := s.objects.Get(readCtx, snapshotKey)
	if err != nil {
		if errors.Is(err, s3lite.ErrUnavailable) {
			return errStorageUnavailable()
		}
		return errInternal(err)
	}
	snapshot, err := store.DecodeSnapshot(object.Body)
	if err != nil {
		return errInternal(err)
	}
	main, err := s.store.BranchByName(ctx, s.store.Pool, c.project.ID, "main")
	if err != nil {
		return errInternal(err)
	}
	now := store.Now()
	err = s.store.InTx(ctx, func(tx pgx.Tx) error {
		if err := s.store.RestoreSnapshot(ctx, tx, c.project, main.ID, snapshot, c.user.Email); err != nil {
			return err
		}
		if operation.Kind == "merge" && operation.Branch != "" {
			branch, err := s.store.BranchByName(ctx, tx, c.project.ID, operation.Branch)
			if err != nil {
				return err
			}
			if err := s.store.SetBranchState(ctx, tx, branch.ID, domain.BranchInReview); err != nil {
				return err
			}
		}
		if operation.Kind == "import" {
			if _, err := tx.Exec(ctx, `update tm_imports set restored_at = $2 where id = $1`,
				operation.ID, now); err != nil {
				return fmt.Errorf("mark import restored: %w", err)
			}
		}
		if err := s.store.MarkOperationRestored(ctx, tx, operation.ID, now); err != nil {
			return err
		}
		if _, err := s.store.BumpChangeSeq(ctx, tx, c.project.ID); err != nil {
			return err
		}
		return s.store.AddAudit(ctx, tx, c.user.Email, "operation.restored", c.project.Slug,
			operation.Label, &c.project.ID)
	})
	if err != nil {
		return errInternal(err)
	}
	operation.RestoredAt = &now
	operation.Restorable = false
	writeJSON(w, http.StatusOK, operation)
	return nil
}
