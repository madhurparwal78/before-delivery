package api

import (
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/marlowquill/interline-desk/internal/domain"
	"github.com/marlowquill/interline-desk/internal/store"
)

// branchFor reads a branch of the project named in the path.
func (s *Server) branchFor(r *http.Request, project *store.Project, name string) (*store.Branch, *apiError) {
	branch, err := s.store.BranchByName(r.Context(), s.store.Pool, project.ID, name)
	if errors.Is(err, store.ErrNotFound) {
		return nil, errNotFound()
	}
	if err != nil {
		return nil, errInternal(err)
	}
	return branch, nil
}

// requireOpen rejects edits that need an open branch.
func requireOpen(branch *store.Branch) *apiError {
	if branch.IsMain {
		return nil
	}
	if domain.BranchFinal(branch.State) {
		return errConflict("branch_closed", "This branch is merged or abandoned, so it can't change.")
	}
	if branch.State != domain.BranchOpen {
		return errConflict("branch_not_open", "This branch is in review, so keys and translations are locked.")
	}
	return nil
}

// requireLive rejects work on a merged or abandoned branch.
func requireLive(branch *store.Branch) *apiError {
	if !branch.IsMain && domain.BranchFinal(branch.State) {
		return errConflict("branch_closed", "This branch is merged or abandoned, so it can't change.")
	}
	return nil
}

func (s *Server) handleListBranches(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	branches, err := s.store.Branches(r.Context(), s.store.Pool, c.project.ID)
	if err != nil {
		return errInternal(err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"branches": branchBodies(branches)})
	return nil
}

func (s *Server) handleCreateBranch(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	var body struct {
		Name string `json:"name"`
	}
	if fail := readJSON(r, &body); fail != nil {
		return fail
	}
	name := strings.TrimSpace(body.Name)
	if !validBranchName(name) {
		return errField("name", "Use lowercase letters, digits, slashes, hyphens or underscores.")
	}
	ctx := r.Context()
	open, err := s.store.OpenBranchCount(ctx, s.store.Pool, c.project.ID)
	if err != nil {
		return errInternal(err)
	}
	if open >= 5 {
		return errConflict("branch_limit", "This project already has five open branches. Merge or abandon one first.")
	}
	main, err := s.store.BranchByName(ctx, s.store.Pool, c.project.ID, "main")
	if err != nil {
		return errInternal(err)
	}
	base, err := s.store.LoadKeySet(ctx, s.store.Pool, main.ID)
	if err != nil {
		return errInternal(err)
	}
	branch := &store.Branch{ID: store.NewID(), ProjectID: c.project.ID, Name: name,
		State: domain.BranchOpen, IsMain: false, CreatedAt: store.Now(), Base: base}
	err = s.store.InTx(ctx, func(tx pgx.Tx) error {
		if err := s.store.InsertBranch(ctx, tx, branch); err != nil {
			return err
		}
		if err := s.store.CopyKeySet(ctx, tx, c.project, branch.ID, base); err != nil {
			return err
		}
		return s.store.AddAudit(ctx, tx, c.user.Email, "branch.created", c.project.Slug, name, &c.project.ID)
	})
	if err != nil {
		if uniqueViolation(err) {
			return &apiError{Status: http.StatusConflict, Code: "branch_exists",
				Message: "A branch with that name already exists."}
		}
		return errInternal(err)
	}
	writeJSON(w, http.StatusCreated, map[string]any{"name": branch.Name, "state": branch.State,
		"is_main": false, "created_at": branch.CreatedAt})
	return nil
}

func (s *Server) handleBranchTransition(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	var body struct {
		To string `json:"to"`
	}
	if fail := readJSON(r, &body); fail != nil {
		return fail
	}
	branch, fail := s.branchFor(r, c.project, r.PathValue("branch"))
	if fail != nil {
		return fail
	}
	switch body.To {
	case domain.BranchOpen, domain.BranchInReview, domain.BranchAbandoned:
	default:
		return errField("to", "Move a branch to open, in_review or abandoned.")
	}
	if !domain.BranchTransitionAllowed(branch.Reported(), body.To, branch.IsMain) {
		return errIllegalTransition(branch.Reported(), body.To)
	}
	ctx := r.Context()
	if err := s.store.SetBranchState(ctx, s.store.Pool, branch.ID, body.To); err != nil {
		return errInternal(err)
	}
	if err := s.store.AddAudit(ctx, s.store.Pool, c.user.Email, "branch."+body.To, c.project.Slug,
		branch.Name, &c.project.ID); err != nil {
		return errInternal(err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"name": branch.Name, "state": body.To,
		"is_main": branch.IsMain, "created_at": branch.CreatedAt})
	return nil
}

func (s *Server) handleListKeys(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	branch, fail := s.branchFor(r, c.project, r.PathValue("branch"))
	if fail != nil {
		return fail
	}
	languages := c.project.TargetLanguages
	if lang := r.URL.Query().Get("lang"); lang != "" {
		if !containsString(languages, lang) {
			return errField("lang", "That language is not a target of this project.")
		}
		languages = []string{lang}
	}
	set, err := s.store.LoadKeySet(r.Context(), s.store.Pool, branch.ID)
	if err != nil {
		return errInternal(err)
	}
	keys := make([]*domain.Key, 0, len(set))
	for _, key := range set {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i].Name < keys[j].Name })
	bodies := make([]map[string]any, 0, len(keys))
	for _, key := range keys {
		translations := map[string]any{}
		for _, lang := range languages {
			segment := key.Segments[lang]
			if segment == nil {
				continue
			}
			translations[lang] = map[string]any{"segment_id": segment.ID, "value": segment.Value,
				"status": segment.Status, "score": segment.Score}
		}
		bodies = append(bodies, map[string]any{"id": key.KeyID, "name": key.Name, "source": key.Source,
			"translations": translations})
	}
	writeJSON(w, http.StatusOK, map[string]any{"keys": bodies})
	return nil
}

func (s *Server) handleCreateKey(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	var body struct {
		Name   string `json:"name"`
		Source string `json:"source"`
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
	fields := map[string]string{}
	if !validKeyName(body.Name) {
		fields["name"] = "Use letters, digits, dots, hyphens or underscores, up to 120 characters."
	}
	if !validSource(body.Source) {
		fields["source"] = "Give a source string of 1 to 2,000 characters."
	}
	if len(fields) > 0 {
		return errValidation(fields)
	}
	ctx := r.Context()
	set, err := s.store.LoadKeySet(ctx, s.store.Pool, branch.ID)
	if err != nil {
		return errInternal(err)
	}
	for _, key := range set {
		if key.Name == body.Name {
			return errConflict("key_exists", "Another key on this branch already has that name.")
		}
	}
	keyID := store.NewID()
	err = s.store.InTx(ctx, func(tx pgx.Tx) error {
		if err := s.store.InsertKey(ctx, tx, c.project, branch.ID, keyID, body.Name, body.Source); err != nil {
			return err
		}
		if err := s.store.AddKeyRevision(ctx, tx, c.project.ID, keyID, branch.Name, "created", nil,
			&body.Source, c.user.Email, store.Now()); err != nil {
			return err
		}
		if _, err := s.store.FillFromMemory(ctx, tx, c.project, branch.ID, keyID, body.Source, c.user.Email); err != nil {
			return err
		}
		if branch.IsMain {
			if _, err := s.store.BumpChangeSeq(ctx, tx, c.project.ID); err != nil {
				return err
			}
		}
		return s.store.AddAudit(ctx, tx, c.user.Email, "key.created", c.project.Slug, body.Name, &c.project.ID)
	})
	if err != nil {
		return errInternal(err)
	}
	return s.writeKey(w, r, c.project, branch, keyID, http.StatusCreated)
}

func (s *Server) handlePatchKey(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	var body struct {
		Name   *string `json:"name"`
		Source *string `json:"source"`
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
	keyID := r.PathValue("key_id")
	ctx := r.Context()
	set, err := s.store.LoadKeySet(ctx, s.store.Pool, branch.ID)
	if err != nil {
		return errInternal(err)
	}
	key, ok := set[keyID]
	if !ok {
		return errNotFound()
	}
	fields := map[string]string{}
	if body.Name != nil && !validKeyName(*body.Name) {
		fields["name"] = "Use letters, digits, dots, hyphens or underscores, up to 120 characters."
	}
	if body.Source != nil && !validSource(*body.Source) {
		fields["source"] = "Give a source string of 1 to 2,000 characters."
	}
	if len(fields) > 0 {
		return errValidation(fields)
	}
	if body.Name != nil && *body.Name != key.Name {
		for id, other := range set {
			if id != keyID && other.Name == *body.Name {
				return errConflict("key_exists", "Another key on this branch already has that name.")
			}
		}
	}
	err = s.store.InTx(ctx, func(tx pgx.Tx) error {
		now := store.Now()
		if body.Name != nil && *body.Name != key.Name {
			if _, err := tx.Exec(ctx, `update keys set name = $3 where branch_id = $1 and key_id = $2`,
				branch.ID, keyID, *body.Name); err != nil {
				return fmt.Errorf("rename key: %w", err)
			}
			if err := s.store.AddKeyRevision(ctx, tx, c.project.ID, keyID, branch.Name, "name",
				&key.Name, body.Name, c.user.Email, now); err != nil {
				return err
			}
		}
		if body.Source != nil && *body.Source != key.Source {
			if _, err := tx.Exec(ctx, `update keys set source = $3 where branch_id = $1 and key_id = $2`,
				branch.ID, keyID, *body.Source); err != nil {
				return fmt.Errorf("edit key source: %w", err)
			}
			if err := s.store.AddKeyRevision(ctx, tx, c.project.ID, keyID, branch.Name, "source",
				&key.Source, body.Source, c.user.Email, now); err != nil {
				return err
			}
			if err := s.store.SourceChanged(ctx, tx, c.project, branch.ID, keyID, *body.Source,
				c.user.Email); err != nil {
				return err
			}
		}
		if branch.IsMain {
			if _, err := s.store.BumpChangeSeq(ctx, tx, c.project.ID); err != nil {
				return err
			}
		}
		return s.store.AddAudit(ctx, tx, c.user.Email, "key.edited", c.project.Slug, key.Name, &c.project.ID)
	})
	if err != nil {
		return errInternal(err)
	}
	return s.writeKey(w, r, c.project, branch, keyID, http.StatusOK)
}

func (s *Server) writeKey(w http.ResponseWriter, r *http.Request, project *store.Project, branch *store.Branch, keyID string, status int) *apiError {
	set, err := s.store.LoadKeySet(r.Context(), s.store.Pool, branch.ID)
	if err != nil {
		return errInternal(err)
	}
	key, ok := set[keyID]
	if !ok {
		return errNotFound()
	}
	translations := map[string]any{}
	for lang, segment := range key.Segments {
		translations[lang] = map[string]any{"segment_id": segment.ID, "value": segment.Value,
			"status": segment.Status, "score": segment.Score}
	}
	writeJSON(w, status, map[string]any{"id": key.KeyID, "name": key.Name, "source": key.Source,
		"translations": translations})
	return nil
}

func (s *Server) handleDeleteKey(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	branch, fail := s.branchFor(r, c.project, r.PathValue("branch"))
	if fail != nil {
		return fail
	}
	if fail := requireOpen(branch); fail != nil {
		return fail
	}
	keyID := r.PathValue("key_id")
	ctx := r.Context()
	set, err := s.store.LoadKeySet(ctx, s.store.Pool, branch.ID)
	if err != nil {
		return errInternal(err)
	}
	key, ok := set[keyID]
	if !ok {
		return errNotFound()
	}
	err = s.store.InTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `update keys set deleted = true where branch_id = $1 and key_id = $2`,
			branch.ID, keyID); err != nil {
			return fmt.Errorf("delete key: %w", err)
		}
		if err := s.store.AddKeyRevision(ctx, tx, c.project.ID, keyID, branch.Name, "deleted",
			&key.Name, nil, c.user.Email, store.Now()); err != nil {
			return err
		}
		if branch.IsMain {
			if _, err := s.store.BumpChangeSeq(ctx, tx, c.project.ID); err != nil {
				return err
			}
		}
		return s.store.AddAudit(ctx, tx, c.user.Email, "key.deleted", c.project.Slug, key.Name, &c.project.ID)
	})
	if err != nil {
		return errInternal(err)
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Server) handleKeyHistory(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	keyID := r.PathValue("key_id")
	known, err := s.store.KeyExists(r.Context(), c.project.ID, keyID)
	if err != nil {
		return errInternal(err)
	}
	if !known {
		return errNotFound()
	}
	revisions, err := s.store.KeyRevisions(r.Context(), c.project.ID, keyID)
	if err != nil {
		return errInternal(err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"key_id": keyID, "revisions": revisions})
	return nil
}
