package main

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
)

const maxOpenBranches = 5

// branchMoves lists the legal transitions requested through the API: the one branch state machine
// (in_review to merged happens only through a merge).
var branchMoves = map[string][]string{
	stateOpen:     {stateInReview, stateAbandoned},
	stateInReview: {stateOpen, stateAbandoned},
}

var branchTransitionAction = map[string]string{
	stateInReview: "branch.review_requested", stateOpen: "branch.reopened", stateAbandoned: "branch.abandoned",
}

func (a *App) handleBranches(w http.ResponseWriter, r *http.Request) error {
	_, p, err := a.ownerProject(r)
	if err != nil {
		return err
	}
	branches, err := listBranches(r.Context(), a.pool, p.ID)
	if err != nil {
		return err
	}
	out := []map[string]any{}
	for _, b := range branches {
		out = append(out, b.json())
	}
	writeJSON(w, http.StatusOK, map[string]any{"branches": out})
	return nil
}

func (a *App) handleCreateBranch(w http.ResponseWriter, r *http.Request) error {
	pr, p, err := a.ownerProject(r)
	if err != nil {
		return err
	}
	var in struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	ctx := r.Context()
	var created *Branch
	err = a.inProject(ctx, p.ID, func(tx pgx.Tx) error {
		var taken int
		if err := tx.QueryRow(ctx, "SELECT count(*) FROM branches WHERE project_id = $1 AND name = $2", p.ID, in.Name).Scan(&taken); err != nil {
			return fmt.Errorf("check branch name: %w", err)
		}
		if taken > 0 {
			return newErr(http.StatusConflict, "branch_exists", "A branch with that name already exists.")
		}
		if !branchPattern.MatchString(in.Name) || in.Name == "main" {
			return errField("name", "Use lowercase letters, digits, slashes, hyphens or underscores.")
		}
		var live int
		if err := tx.QueryRow(ctx, "SELECT count(*) FROM branches WHERE project_id = $1 AND NOT is_main AND state IN ('open', 'in_review')", p.ID).Scan(&live); err != nil {
			return fmt.Errorf("count open branches: %w", err)
		}
		if live >= maxOpenBranches {
			return newErr(http.StatusConflict, "branch_limit", "This project already has five open branches. Merge or abandon one first.")
		}
		main, err := mainBranch(ctx, tx, p.ID)
		if err != nil {
			return err
		}
		created = &Branch{ID: newID(), ProjectID: p.ID, Name: in.Name, State: stateOpen, CreatedAt: now()}
		if err := copyMainToBranch(ctx, tx, main.ID, created); err != nil {
			return err
		}
		return a.audit(ctx, tx, pr.Email, "branch.created", p, created.Name)
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, created.json())
	return nil
}

// copyMainToBranch inserts a branch that starts as a copy of main, keeping key ids, and records the base.
func copyMainToBranch(ctx context.Context, q db, mainID string, b *Branch) error {
	if _, err := q.Exec(ctx, `INSERT INTO branches (id, project_id, name, state, is_main, created_at) VALUES ($1, $2, $3, 'open', false, $4)`,
		b.ID, b.ProjectID, b.Name, b.CreatedAt); err != nil {
		return fmt.Errorf("insert branch: %w", err)
	}
	steps := []string{
		`INSERT INTO branch_keys (branch_id, key_id, name, source, deleted) SELECT $1, key_id, name, source, false FROM branch_keys WHERE branch_id = $2 AND NOT deleted`,
		`INSERT INTO base_keys (branch_id, key_id, name, source) SELECT $1, key_id, name, source FROM branch_keys WHERE branch_id = $2 AND NOT deleted`,
		`INSERT INTO segments (id, project_id, branch_id, key_id, language, value, status, score, origin, issues, comments, history)
			SELECT gen_random_uuid()::text, s.project_id, $1, s.key_id, s.language, s.value, s.status, s.score, s.origin, s.issues, s.comments, s.history
			FROM segments s JOIN branch_keys k ON k.branch_id = s.branch_id AND k.key_id = s.key_id WHERE s.branch_id = $2 AND NOT k.deleted`,
		`INSERT INTO base_values (branch_id, key_id, language, value) SELECT $1, s.key_id, s.language, s.value
			FROM segments s JOIN branch_keys k ON k.branch_id = s.branch_id AND k.key_id = s.key_id WHERE s.branch_id = $2 AND NOT k.deleted`,
	}
	for i, sql := range steps {
		if _, err := q.Exec(ctx, sql, b.ID, mainID); err != nil {
			return fmt.Errorf("copy main into branch (step %d): %w", i+1, err)
		}
	}
	return nil
}

func (a *App) handleTransition(w http.ResponseWriter, r *http.Request) error {
	pr, p, b, err := a.ownerBranch(r)
	if err != nil {
		return err
	}
	var in struct {
		To string `json:"to"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	ctx := r.Context()
	err = a.inProject(ctx, p.ID, func(tx pgx.Tx) error {
		if b, err = branchByID(ctx, tx, b.ID); err != nil {
			return err
		}
		if b.IsMain || !slices.Contains(branchMoves[b.State], in.To) {
			if !slices.Contains([]string{stateOpen, stateInReview, stateAbandoned}, in.To) {
				return errField("to", "Choose open, in_review or abandoned.")
			}
			return errIllegalTransition(b.State, in.To)
		}
		if _, err := tx.Exec(ctx, "UPDATE branches SET state = $2 WHERE id = $1", b.ID, in.To); err != nil {
			return fmt.Errorf("move branch: %w", err)
		}
		b.State = in.To
		return a.audit(ctx, tx, pr.Email, branchTransitionAction[in.To], p, b.Name)
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, b.json())
	return nil
}

// keyJSON renders one key of a branch with its translations (all target languages or just lang).
func keyJSON(k Key, segs map[string]*Segment, p *Project, lang string) map[string]any {
	translations := map[string]any{}
	for _, l := range p.TargetLanguages {
		if lang != "" && l != lang {
			continue
		}
		if s := segs[l]; s != nil {
			translations[l] = s.summary()
		}
	}
	return map[string]any{"id": k.ID, "name": k.Name, "source": k.Source, "translations": translations}
}

func (a *App) handleKeys(w http.ResponseWriter, r *http.Request) error {
	_, p, b, err := a.ownerBranch(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	lang := r.URL.Query().Get("lang")
	keys, err := liveKeys(ctx, a.pool, b.ID)
	if err != nil {
		return err
	}
	segs, err := branchSegments(ctx, a.pool, b.ID, lang)
	if err != nil {
		return err
	}
	out := []map[string]any{}
	for _, k := range keys {
		out = append(out, keyJSON(k, segs[k.ID], p, lang))
	}
	writeJSON(w, http.StatusOK, map[string]any{"keys": out})
	return nil
}

func (a *App) loadKeyJSON(ctx context.Context, q db, p *Project, b *Branch, keyID string) (map[string]any, error) {
	k, err := keyOnBranch(ctx, q, b.ID, keyID)
	if err != nil {
		return nil, err
	}
	segs, err := branchSegments(ctx, q, b.ID, "")
	if err != nil {
		return nil, err
	}
	return keyJSON(*k, segs[keyID], p, ""), nil
}

func (a *App) handleCreateKey(w http.ResponseWriter, r *http.Request) error {
	pr, p, b, err := a.ownerBranch(r)
	if err != nil {
		return err
	}
	var in struct {
		Name   string `json:"name"`
		Source string `json:"source"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	ctx := r.Context()
	var out map[string]any
	err = a.inProject(ctx, p.ID, func(tx pgx.Tx) error {
		if b, err = branchByID(ctx, tx, b.ID); err != nil {
			return err
		}
		if err := b.requireEditable(); err != nil {
			return err
		}
		if err := a.ensureNameFree(ctx, tx, b.ID, in.Name, ""); err != nil {
			return err
		}
		fields := map[string]string{}
		if !keyNamePattern.MatchString(in.Name) {
			fields["name"] = "Use 1 to 120 letters, digits, dots, underscores or hyphens."
		}
		if e := validSource(in.Source); e != nil {
			fields["source"] = e.Fields["source"]
		}
		if len(fields) > 0 {
			return errValidation(fields)
		}
		keyID, err := a.createKey(ctx, tx, p, b, in.Name, in.Source, pr.Email, now())
		if err != nil {
			return err
		}
		if err := touch(ctx, tx, p.ID, b); err != nil {
			return err
		}
		if err := a.audit(ctx, tx, pr.Email, "key.created", p, b.Name+": "+in.Name); err != nil {
			return err
		}
		out, err = a.loadKeyJSON(ctx, tx, p, b, keyID)
		return err
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, out)
	return nil
}

// ensureNameFree answers key_exists when another live key on the branch already has the name.
func (a *App) ensureNameFree(ctx context.Context, q db, branchID, name, exceptKeyID string) error {
	var taken int
	if err := q.QueryRow(ctx, "SELECT count(*) FROM branch_keys WHERE branch_id = $1 AND name = $2 AND NOT deleted AND key_id <> $3",
		branchID, name, exceptKeyID).Scan(&taken); err != nil {
		return fmt.Errorf("check key name: %w", err)
	}
	if taken > 0 {
		return newErr(http.StatusConflict, "key_exists", "Another key on this branch already has that name.")
	}
	return nil
}

// changeSource applies a new source to a key on a branch: translated segments go to review and
// untranslated ones are filled from the TM.
func (a *App) changeSource(ctx context.Context, q db, p *Project, b *Branch, keyID, source, actor string, at time.Time) error {
	segs, err := branchSegments(ctx, q, b.ID, "")
	if err != nil {
		return err
	}
	for _, s := range segs[keyID] {
		s.Source = source
		if s.Value == nil {
			continue
		}
		s.sourceChanged(actor, at)
		if err := s.save(ctx, q); err != nil {
			return err
		}
	}
	if err := fillFromTM(ctx, q, p, b.ID, keyID, source, actor, at); err != nil {
		return err
	}
	return nil
}

func (a *App) handlePatchKey(w http.ResponseWriter, r *http.Request) error {
	pr, p, b, err := a.ownerBranch(r)
	if err != nil {
		return err
	}
	var in struct {
		Name   *string `json:"name"`
		Source *string `json:"source"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	ctx := r.Context()
	var out map[string]any
	err = a.inProject(ctx, p.ID, func(tx pgx.Tx) error {
		if b, err = branchByID(ctx, tx, b.ID); err != nil {
			return err
		}
		if err := b.requireEditable(); err != nil {
			return err
		}
		k, err := keyOnBranch(ctx, tx, b.ID, r.PathValue("key_id"))
		if err != nil {
			return err
		}
		if k.Deleted {
			return errNotFound()
		}
		if in.Name != nil && *in.Name != k.Name {
			if err := a.ensureNameFree(ctx, tx, b.ID, *in.Name, k.ID); err != nil {
				return err
			}
		}
		fields := map[string]string{}
		if in.Name != nil && !keyNamePattern.MatchString(*in.Name) {
			fields["name"] = "Use 1 to 120 letters, digits, dots, underscores or hyphens."
		}
		if in.Source != nil {
			if e := validSource(*in.Source); e != nil {
				fields["source"] = e.Fields["source"]
			}
		}
		if len(fields) > 0 {
			return errValidation(fields)
		}
		at := now()
		if in.Name != nil && *in.Name != k.Name {
			if _, err := tx.Exec(ctx, "UPDATE branch_keys SET name = $3 WHERE branch_id = $1 AND key_id = $2", b.ID, k.ID, *in.Name); err != nil {
				return fmt.Errorf("rename key: %w", err)
			}
			if err := addRevision(ctx, tx, p.ID, k.ID, b.Name, "name", &k.Name, in.Name, pr.Email); err != nil {
				return err
			}
		}
		if in.Source != nil && *in.Source != k.Source {
			if _, err := tx.Exec(ctx, "UPDATE branch_keys SET source = $3 WHERE branch_id = $1 AND key_id = $2", b.ID, k.ID, *in.Source); err != nil {
				return fmt.Errorf("edit key source: %w", err)
			}
			if err := addRevision(ctx, tx, p.ID, k.ID, b.Name, "source", &k.Source, in.Source, pr.Email); err != nil {
				return err
			}
			if err := a.changeSource(ctx, tx, p, b, k.ID, *in.Source, pr.Email, at); err != nil {
				return err
			}
		}
		if err := touch(ctx, tx, p.ID, b); err != nil {
			return err
		}
		if err := a.audit(ctx, tx, pr.Email, "key.updated", p, b.Name+": "+k.Name); err != nil {
			return err
		}
		out, err = a.loadKeyJSON(ctx, tx, p, b, k.ID)
		return err
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, out)
	return nil
}

func (a *App) handleDeleteKey(w http.ResponseWriter, r *http.Request) error {
	pr, p, b, err := a.ownerBranch(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	err = a.inProject(ctx, p.ID, func(tx pgx.Tx) error {
		if b, err = branchByID(ctx, tx, b.ID); err != nil {
			return err
		}
		if err := b.requireEditable(); err != nil {
			return err
		}
		k, err := keyOnBranch(ctx, tx, b.ID, r.PathValue("key_id"))
		if err != nil {
			return err
		}
		if k.Deleted {
			return errNotFound()
		}
		if _, err := tx.Exec(ctx, "UPDATE branch_keys SET deleted = true WHERE branch_id = $1 AND key_id = $2", b.ID, k.ID); err != nil {
			return fmt.Errorf("delete key: %w", err)
		}
		if err := addRevision(ctx, tx, p.ID, k.ID, b.Name, "deleted", &k.Name, nil, pr.Email); err != nil {
			return err
		}
		if err := touch(ctx, tx, p.ID, b); err != nil {
			return err
		}
		return a.audit(ctx, tx, pr.Email, "key.deleted", p, b.Name+": "+k.Name)
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (a *App) handleKeyHistory(w http.ResponseWriter, r *http.Request) error {
	_, p, err := a.ownerProject(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	keyID := r.PathValue("key_id")
	var known int
	if err := a.pool.QueryRow(ctx, "SELECT count(*) FROM keys WHERE id = $1 AND project_id = $2", keyID, p.ID).Scan(&known); err != nil {
		return fmt.Errorf("check key: %w", err)
	}
	if known == 0 {
		return errNotFound()
	}
	rows, err := a.pool.Query(ctx, "SELECT at, branch, field, from_value, to_value, actor FROM key_revisions WHERE key_id = $1 ORDER BY id", keyID)
	if err != nil {
		return fmt.Errorf("list revisions: %w", err)
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var at time.Time
		var branch, field, actor string
		var from, to *string
		if err := rows.Scan(&at, &branch, &field, &from, &to, &actor); err != nil {
			return fmt.Errorf("scan revision: %w", err)
		}
		out = append(out, map[string]any{"at": fmtTime(at), "branch": branch, "field": field, "from": from, "to": to, "actor": actor})
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read rows: %w", err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"key_id": keyID, "revisions": out})
	return nil
}
