package api

import (
	"errors"
	"net/http"
	"time"

	"github.com/marlowquill/interline-desk/internal/domain"
	"github.com/marlowquill/interline-desk/internal/store"
)

// previewView is the merge preview of one branch against its base and main.
type previewView struct {
	Branch         string
	State          string
	Keys           int
	NeedsReview    int
	NewKeys        int
	EditedKeys     int
	DeletedKeys    int
	Conflicts      []domain.Conflict
	BelowThreshold int

	Edits     []domain.FieldEdit
	BaseSet   domain.KeySet
	BranchSet domain.KeySet
	MainSet   domain.KeySet
	BranchRow *store.Branch
	MainRow   *store.Branch
}

func (v *previewView) body() map[string]any {
	conflicts := v.Conflicts
	if conflicts == nil {
		conflicts = []domain.Conflict{}
	}
	return map[string]any{
		"branch": v.Branch, "state": v.State, "keys": v.Keys, "needs_review": v.NeedsReview,
		"new_keys": v.NewKeys, "edited_keys": v.EditedKeys, "deleted_keys": v.DeletedKeys,
		"conflicts": conflicts, "below_threshold": v.BelowThreshold,
	}
}

func (v *previewView) unresolved() []string {
	var ids []string
	for _, conflict := range v.Conflicts {
		if conflict.Resolution == nil {
			ids = append(ids, conflict.ID)
		}
	}
	return ids
}

// previewBranch classifies a branch exactly as the merge will.
func (s *Server) previewBranch(r *http.Request, project *store.Project, branchName string) (*previewView, *apiError) {
	ctx := r.Context()
	db := s.store.Pool
	main, err := s.store.BranchByName(ctx, db, project.ID, "main")
	if err != nil {
		return nil, errInternal(err)
	}
	branch := main
	if branchName != "main" {
		branch, err = s.store.BranchByName(ctx, db, project.ID, branchName)
		if errors.Is(err, store.ErrNotFound) {
			return nil, errNotFound()
		}
		if err != nil {
			return nil, errInternal(err)
		}
	}
	mainSet, err := s.store.LoadKeySet(ctx, db, main.ID)
	if err != nil {
		return nil, errInternal(err)
	}
	branchSet := mainSet
	if !branch.IsMain {
		branchSet, err = s.store.LoadKeySet(ctx, db, branch.ID)
		if err != nil {
			return nil, errInternal(err)
		}
	}

	view := &previewView{
		Branch: branch.Name, State: branch.Reported(),
		Keys: len(branchSet), NeedsReview: domain.NeedsReview(branchSet),
		BelowThreshold: domain.BelowThreshold(branchSet, project.MQMThreshold),
		Conflicts:      []domain.Conflict{},
		BaseSet:        branch.Base, BranchSet: branchSet, MainSet: mainSet,
		BranchRow: branch, MainRow: main,
	}
	if branch.IsMain {
		return view, nil
	}

	classified := domain.Classify(branch.Base, branchSet, mainSet, project.TargetLanguages)
	view.NewKeys = len(classified.NewKeys)
	view.EditedKeys = len(classified.EditedKeys)
	view.DeletedKeys = len(classified.DeletedKeys)
	view.Edits = classified.Edits
	view.Conflicts = classified.Conflicts

	resolutions, err := s.store.Resolutions(ctx, db, branch.ID)
	if err != nil {
		return nil, errInternal(err)
	}
	holds, err := s.store.Holds(ctx, db, branch.ID)
	if err != nil {
		return nil, errInternal(err)
	}
	for i := range view.Conflicts {
		conflict := &view.Conflicts[i]
		if res, ok := resolutions[conflict.ID]; ok && sameString(res.MainSeen, conflict.Main) {
			conflict.Resolution = res
		}
		if until, ok := holds[conflict.ID]; ok {
			held := until
			conflict.HeldUntil = &held
		}
	}
	return view, nil
}

func (s *Server) handleMergePreview(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	view, fail := s.previewBranch(r, c.project, r.PathValue("branch"))
	if fail != nil {
		return fail
	}
	writeJSON(w, http.StatusOK, view.body())
	return nil
}

func sameString(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func heldUntilDetails(until time.Time) map[string]any {
	return map[string]any{"held_until": until.Format(time.RFC3339)}
}
