package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
)

func (s *Server) handleMerge(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	p, b, branchID, ok := s.loadAnyBranch(w, r)
	if !ok {
		return
	}
	var mergeCounts map[string]any
	var resolvedCount int
	if b.IsMain {
		writeErrorDetails(w, http.StatusConflict, "illegal_transition", "That change isn't allowed.",
			map[string]any{"from": BranchOpen, "to": BranchMerged})
		return
	}
	if b.State != BranchInReview {
		writeErrorDetails(w, http.StatusConflict, "illegal_transition", "That change isn't allowed.",
			map[string]any{"from": b.State, "to": BranchMerged})
		return
	}

	// one of two simultaneous merges wins
	var mergeID string
	err := s.store.withTx(r.Context(), func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(r.Context(), `SELECT pg_advisory_xact_lock(hashtext($1))`, "merge:"+branchID); err != nil {
			return err
		}
		var state string
		if err := tx.QueryRowContext(r.Context(), `SELECT state FROM branches WHERE id = $1 FOR UPDATE`, branchID).Scan(&state); err != nil {
			return err
		}
		if state != BranchInReview {
			return errMergeRace
		}
		// recompute the preview inside the transaction
		base, main, branch, mainSegs, branchSegs, err := s.loadComparisonTx(r.Context(), tx, p, branchID)
		if err != nil {
			return err
		}
		newKeys, editedKeys, deletedKeys, conflicts := classify(p, base, main, branch, mainSegs, branchSegs, p.TargetLanguages)
		mergeCounts = map[string]any{"new_keys": newKeys, "edited_keys": editedKeys, "deleted_keys": deletedKeys}
		resolvedCount = len(conflicts)
		persisted, err := s.loadConflictsTx(r.Context(), tx, branchID)
		if err != nil {
			return err
		}
		var unresolved []string
		for _, c := range conflicts {
			pc, ok := persisted[c.ID]
			if !ok || pc.resolution == nil || resolutionVoidTx(pc, c) {
				unresolved = append(unresolved, c.ID)
			}
		}
		if len(unresolved) > 0 {
			return &mergeBlocked{ids: unresolved}
		}

		// snapshot main as an operation
		opID := newUUID()
		snap, err := s.snapshotState(r.Context(), tx, p)
		if err != nil {
			return err
		}
		snapJSON, _ := json.Marshal(snap)
		snapKey := "projects/" + p.ID + "/snapshots/" + opID + ".json"
		if err := s.storage.Put(r.Context(), snapKey, snapJSON, "application/json"); err != nil {
			return errStorageDownMerge
		}
		if _, err := tx.ExecContext(r.Context(), `INSERT INTO operations (id, project_id, kind, label, at, snapshot_key, restored_at, main_version, tm_version)
			VALUES ($1,$2,'merge',$3, now(), $4, NULL, $5, $6)`,
			opID, p.ID, "Merge "+b.Name+" into main", snapKey, snap.MainVersion, snap.TmVersion); err != nil {
			return err
		}
		mergeID = opID

		if err := s.applyMerge(r.Context(), tx, p, branchID, b, base, main, branch, mainSegs, branchSegs, persisted, u.Email); err != nil {
			return err
		}
		if _, err := tx.ExecContext(r.Context(), `UPDATE branches SET state = 'merged' WHERE id = $1`, branchID); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		var blocked *mergeBlocked
		if errors.As(err, &blocked) {
			writeErrorDetails(w, http.StatusConflict, "conflicts_unresolved",
				"Resolve every conflict before merging.", map[string]any{"conflicts": blocked.ids})
			return
		}
		if errors.Is(err, errMergeRace) {
			writeErrorDetails(w, http.StatusConflict, "illegal_transition", "That change isn't allowed.",
				map[string]any{"from": BranchMerged, "to": BranchMerged})
			return
		}
		if errors.Is(err, errStorageDownMerge) {
			serviceUnavailable(w, "storage_unavailable", "File storage isn't answering. Nothing was saved; try again in a few minutes.", nil)
			return
		}
		http.Error(w, "internal", 500)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"merge_id": mergeID, "new_keys": mergeCounts["new_keys"],
		"edited_keys": mergeCounts["edited_keys"], "deleted_keys": mergeCounts["deleted_keys"],
		"conflicts_resolved": resolvedCount,
	})
}

type mergeBlocked struct{ ids []string }

func (m *mergeBlocked) Error() string { return "conflicts unresolved" }

var (
	errMergeRace        = errors.New("merge race")
	errStorageDownMerge = errors.New("storage down")
)

// applyMerge applies every change and resolution to main in one transaction.
// No main value changes except through a branch edit that main did not touch,
// or through a resolution.
func (s *Server) applyMerge(ctx context.Context, tx *sql.Tx, p *Project, branchID string, b *Branch,
	base, main, branch map[string]*keyState, mainSegs, branchSegs map[string]*segState,
	persisted map[string]persistedConflict, actor string) error {
	mainID, err := mainBranchIDTx(ctx, tx, p.ID)
	if err != nil {
		return err
	}
	var mainBranchName string
	if err := tx.QueryRowContext(ctx, `SELECT name FROM branches WHERE id = $1`, mainID).Scan(&mainBranchName); err != nil {
		return err
	}
	_ = mainBranchName

	resolutionFor := func(id string) *map[string]any {
		if pc, ok := persisted[id]; ok && pc.resolution != nil {
			if m, ok := pc.resolution.(map[string]any); ok {
				return &m
			}
		}
		return nil
	}

	// keys in the base: apply edits, deletions and resolutions
	for keyID, bk := range base {
		br := branch[keyID]
		mk := main[keyID]
		switch {
		case br == nil && mk == nil:
			continue
		case br == nil:
			// deleted on the branch
			if res := resolutionFor(keyID + ":" + fieldPresence); res != nil {
				switch (*res)["choice"] {
				case "main":
					// keep main: nothing to do
				case "branch":
					// delete on main
					if _, err := tx.ExecContext(ctx, `UPDATE keys SET deleted = true WHERE id = $1 AND branch_id = $2`, keyID, mainID); err != nil {
						return err
					}
					if _, err := tx.ExecContext(ctx, `INSERT INTO key_revisions (key_id, at, branch, field, from_val, to_val, actor) VALUES ($1, now(), 'main', 'deleted', NULL, NULL, $2)`,
						keyID, actor); err != nil {
						return err
					}
				}
				continue
			}
			if _, err := tx.ExecContext(ctx, `UPDATE keys SET deleted = true WHERE id = $1 AND branch_id = $2`, keyID, mainID); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO key_revisions (key_id, at, branch, field, from_val, to_val, actor) VALUES ($1, now(), 'main', 'deleted', NULL, NULL, $2)`,
				keyID, actor); err != nil {
				return err
			}
		case mk == nil:
			// deleted on main, present on the branch
			if res := resolutionFor(keyID + ":" + fieldPresence); res != nil {
				switch (*res)["choice"] {
				case "branch":
					// re-create on main
					if err := copyKeyWithSegments(ctx, tx, p, branchID, mainID, keyID, actor); err != nil {
						return err
					}
				}
				continue
			}
			// main deleted it; branch unchanged: stays deleted
		default:
			// present on both sides
			editedOnBranch := br.Source != bk.Source || br.Name != bk.Name
			editedOnMain := mk.Source != bk.Source || mk.Name != bk.Name
			// name
			if br.Name != mk.Name {
				res := resolutionFor(keyID + ":" + fieldName)
				if res != nil {
					if v, ok := (*res)["value"].(string); ok {
						if _, err := tx.ExecContext(ctx, `UPDATE keys SET name = $1 WHERE id = $2 AND branch_id = $3`, v, keyID, mainID); err != nil {
							return err
						}
					}
				} else if editedOnBranch && !editedOnMain {
					if _, err := tx.ExecContext(ctx, `UPDATE keys SET name = $1 WHERE id = $2 AND branch_id = $3`, br.Name, keyID, mainID); err != nil {
						return err
					}
				}
			}
			// source
			if br.Source != mk.Source {
				res := resolutionFor(keyID + ":" + fieldSource)
				if res != nil {
					if v, ok := (*res)["value"].(string); ok {
						if err := s.setMainSource(ctx, tx, p, mainID, keyID, v, actor); err != nil {
							return err
						}
					}
				} else if editedOnBranch && !editedOnMain {
					if err := s.setMainSource(ctx, tx, p, mainID, keyID, br.Source, actor); err != nil {
						return err
					}
				}
			}
			// translations
			for _, lang := range p.TargetLanguages {
				brSeg := segOf(branchSegs, br.MainSegID, lang)
				mSeg := segOf(mainSegs, mk.MainSegID, lang)
				bChanged, mChanged := segChanged(brSeg, mSeg)
				if !bChanged {
					continue
				}
				if mChanged && segValue(brSeg) != segValue(mSeg) {
					res := resolutionFor(keyID + ":" + fieldTransPref + lang)
					if res != nil {
						if v, ok := (*res)["value"].(string); ok {
							if err := s.setMainSegmentValue(ctx, tx, p, mainID, keyID, lang, v, "review"); err != nil {
								return err
							}
						}
					}
					// no resolution: blocked earlier, so unreachable here
				} else if !mChanged {
					// main did not touch this segment; the branch value travels
					if err := s.copySegmentState(ctx, tx, branchID, mainID, keyID, lang, actor); err != nil {
						return err
					}
				}
			}
		}
	}
	// keys created on the branch, unless a same-name conflict is resolved to main
	for keyID, br := range branch {
		if _, inBase := base[keyID]; inBase {
			continue
		}
		if _, onMain := main[keyID]; onMain {
			// the same-name conflict was resolved above
			continue
		}
		if taken, _ := nameTakenBy(main, br.Name); taken {
			res := resolutionFor(keyID + ":" + fieldName)
			if res != nil && (*res)["choice"] == "main" {
				continue
			}
		}
		if err := copyKeyWithSegments(ctx, tx, p, branchID, mainID, keyID, actor); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO key_revisions (key_id, at, branch, field, from_val, to_val, actor) VALUES ($1, now(), 'main', 'merged', NULL, $2, $3)`,
			keyID, br.Source, actor); err != nil {
			return err
		}
	}
	// merged revision on every live key the branch touched
	if _, err := tx.ExecContext(ctx, `INSERT INTO key_revisions (key_id, at, branch, field, from_val, to_val, actor)
		SELECT DISTINCT k.id, now(), 'main', 'merged', NULL, k.source, $2
		FROM keys k JOIN branch_bases bb ON bb.key_id = k.id
		WHERE k.branch_id = (SELECT id FROM branches WHERE project_id = $1 AND is_main) AND NOT k.deleted
			AND k.id IN (SELECT key_id FROM branch_bases WHERE branch_id = $3)`,
		p.ID, actor, branchID); err != nil {
		return err
	}
	// holds and resolutions of the branch are released
	if _, err := tx.ExecContext(ctx, `DELETE FROM conflicts WHERE branch_id = $1`, branchID); err != nil {
		return err
	}
	if _, err := bumpMainVersion(ctx, tx); err != nil {
		return err
	}
	_ = s.storeAuditTx(ctx, tx, actor, "branch.merged", p.Slug, b.Name)
	return nil
}

// setMainSource writes a main key's source and applies the source-change rule.
func (s *Server) setMainSource(ctx context.Context, tx *sql.Tx, p *Project, mainID, keyID, source, actor string) error {
	var old string
	if err := tx.QueryRowContext(ctx, `SELECT source FROM keys WHERE id = $1 AND branch_id = $2`, keyID, mainID).Scan(&old); err != nil {
		return err
	}
	if old == source {
		return nil
	}
	if _, err := tx.ExecContext(ctx, `UPDATE keys SET source = $1 WHERE id = $2 AND branch_id = $3`, source, keyID, mainID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO key_revisions (key_id, at, branch, field, from_val, to_val, actor) VALUES ($1, now(), 'main', 'source', $2, $3, $4)`,
		keyID, old, source, actor); err != nil {
		return err
	}
	// segments with a value move to needs review
	if _, err := tx.ExecContext(ctx, `UPDATE segments SET status = 'needs_review', updated_at = now() WHERE key_id = $1 AND branch_id = $2 AND value IS NOT NULL`,
		keyID, mainID); err != nil {
		return err
	}
	// untranslated segments get exact matches
	return nil
}

// copySegmentState copies one segment's value and its status, score and issues
// from the branch to main.
func (s *Server) copySegmentState(ctx context.Context, tx *sql.Tx, fromBranch, toBranch, keyID, lang, actor string) error {
	var srcID string
	err := tx.QueryRowContext(ctx, `SELECT id FROM segments WHERE key_id = $1 AND branch_id = $2 AND language = $3`, keyID, fromBranch, lang).Scan(&srcID)
	if err != nil {
		return nil
	}
	var dstID string
	err = tx.QueryRowContext(ctx, `SELECT id FROM segments WHERE key_id = $1 AND branch_id = $2 AND language = $3`, keyID, toBranch, lang).Scan(&dstID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// main lacks the segment: copy it in with a new id
			if _, err := tx.ExecContext(ctx, `INSERT INTO segments (id, project_id, branch_id, key_id, language, value, status, score, origin, issues, created_at, updated_at)
				SELECT gen_random_uuid(), project_id, $1, key_id, language, value, status, score, origin, issues, now(), now()
				FROM segments WHERE id = $2`, toBranch, srcID); err != nil {
				return err
			}
			return nil
		}
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE segments SET value = src.value, status = src.status, score = src.score, origin = src.origin, issues = src.issues, updated_at = now()
		FROM (SELECT value, status, score, origin, issues FROM segments WHERE id = $1) src
		WHERE segments.id = $2`, srcID, dstID); err != nil {
		return err
	}
	return nil
}

// copyKeyWithSegments copies a branch key and its segments onto main.
func copyKeyWithSegments(ctx context.Context, tx *sql.Tx, p *Project, fromBranch, toBranch, keyID, actor string) error {
	var id, name, source string
	if err := tx.QueryRowContext(ctx, `SELECT id, name, source FROM keys WHERE id = $1 AND branch_id = $2 AND NOT deleted`, keyID, fromBranch).Scan(&id, &name, &source); err != nil {
		return nil
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO keys (id, project_id, branch_id, name, source, deleted, created_at) VALUES ($1,$2,$3,$4,$5,false, now())
		ON CONFLICT DO NOTHING`, id, p.ID, toBranch, name, source); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO segments (id, project_id, branch_id, key_id, language, value, status, score, origin, issues, created_at, updated_at)
		SELECT gen_random_uuid(), project_id, $1, key_id, language, value, status, score, origin, issues, now(), now()
		FROM segments WHERE key_id = $2 AND branch_id = $3`, toBranch, keyID, fromBranch); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO key_revisions (key_id, at, branch, field, from_val, to_val, actor) VALUES ($1, now(), 'main', 'merged', NULL, $2, $3)`,
		id, source, actor); err != nil {
		return err
	}
	return nil
}

// setMainSegmentValue writes a main segment's value through a resolution.
func (s *Server) setMainSegmentValue(ctx context.Context, tx *sql.Tx, p *Project, mainID, keyID, lang, value, origin string) error {
	var segID string
	err := tx.QueryRowContext(ctx, `SELECT id FROM segments WHERE key_id = $1 AND branch_id = $2 AND language = $3`, keyID, mainID, lang).Scan(&segID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			if _, err := tx.ExecContext(ctx, `INSERT INTO segments (id, project_id, branch_id, key_id, language, value, status, score, origin, issues, created_at, updated_at)
				VALUES ($1,$2,$3,$4,$5,$6,'scored',NULL,$7,'[]',now(),now())`,
				newUUID(), p.ID, mainID, keyID, lang, value, origin); err != nil {
				return err
			}
			return nil
		}
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE segments SET value = $1, origin = $2, status = CASE WHEN status = 'approved' THEN 'scored' ELSE status END, updated_at = now() WHERE id = $3`,
		value, origin, segID); err != nil {
		return err
	}
	return nil
}

func (s *Server) storeAuditTx(ctx context.Context, tx *sql.Tx, actor, action, project, detail string) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO audit_log (id, at, actor, action, project, detail) VALUES ($1, now(), $2, $3, $4, $5)`,
		newUUID(), actor, action, project, detail)
	return err
}
