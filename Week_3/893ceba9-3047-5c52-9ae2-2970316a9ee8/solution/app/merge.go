package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
)

func (a *App) handleHold(w http.ResponseWriter, r *http.Request) error {
	pr, p, b, err := a.ownerBranch(r)
	if err != nil {
		return err
	}
	if err := decodeJSON(r, &struct{}{}); err != nil {
		return err
	}
	ctx := r.Context()
	conflictID := r.PathValue("conflict_id")
	var until time.Time
	err = a.inProject(ctx, p.ID, func(tx pgx.Tx) error {
		if b, err = branchByID(ctx, tx, b.ID); err != nil {
			return err
		}
		if err := b.requireLive(); err != nil {
			return err
		}
		pv, err := a.computePreview(ctx, tx, p, b)
		if err != nil {
			return err
		}
		if pv.conflict(conflictID) == nil {
			return errNotFound()
		}
		if held, err := otherHold(ctx, tx, b.ID, conflictID, pr.SessionID); err != nil || held != nil {
			if err != nil {
				return err
			}
			return conflictHeld(*held)
		}
		until = now().Add(a.cfg.HoldTTL)
		_, err = tx.Exec(ctx, `INSERT INTO holds (branch_id, conflict_id, session_id, held_until) VALUES ($1, $2, $3, $4)
			ON CONFLICT (branch_id, conflict_id) DO UPDATE SET session_id = EXCLUDED.session_id, held_until = EXCLUDED.held_until`,
			b.ID, conflictID, pr.SessionID, until)
		if err != nil {
			return fmt.Errorf("take hold: %w", err)
		}
		return a.audit(ctx, tx, pr.Email, "conflict.held", p, b.Name+": "+conflictID)
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"conflict_id": conflictID, "held_until": fmtTime(until)})
	return nil
}

func conflictHeld(until time.Time) *apiError {
	return newErr(http.StatusConflict, "conflict_held", "This conflict is being resolved in another session.").
		with(map[string]any{"held_until": fmtTime(until)})
}

// otherHold returns the expiry of an active hold on a conflict that belongs to a different session.
func otherHold(ctx context.Context, q db, branchID, conflictID, sessionID string) (*time.Time, error) {
	var until time.Time
	err := q.QueryRow(ctx, "SELECT held_until FROM holds WHERE branch_id = $1 AND conflict_id = $2 AND held_until > $3 AND session_id <> $4",
		branchID, conflictID, time.Now().UTC(), sessionID).Scan(&until)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("check hold: %w", err)
	}
	return &until, nil
}

func (a *App) handleResolve(w http.ResponseWriter, r *http.Request) error {
	pr, p, b, err := a.ownerBranch(r)
	if err != nil {
		return err
	}
	var in struct {
		Choice string  `json:"choice"`
		Value  *string `json:"value"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	ctx := r.Context()
	conflictID := r.PathValue("conflict_id")
	var out map[string]any
	err = a.inProject(ctx, p.ID, func(tx pgx.Tx) error {
		if b, err = branchByID(ctx, tx, b.ID); err != nil {
			return err
		}
		if err := b.requireLive(); err != nil {
			return err
		}
		pv, err := a.computePreview(ctx, tx, p, b)
		if err != nil {
			return err
		}
		c := pv.conflict(conflictID)
		if c == nil {
			return errNotFound()
		}
		if held, err := otherHold(ctx, tx, b.ID, conflictID, pr.SessionID); err != nil || held != nil {
			if err != nil {
				return err
			}
			return conflictHeld(*held)
		}
		var mine int
		if err := tx.QueryRow(ctx, "SELECT count(*) FROM holds WHERE branch_id = $1 AND conflict_id = $2 AND held_until > $3 AND session_id = $4",
			b.ID, conflictID, time.Now().UTC(), pr.SessionID).Scan(&mine); err != nil {
			return fmt.Errorf("check own hold: %w", err)
		}
		if mine == 0 {
			return newErr(http.StatusConflict, "hold_required", "Your hold on this conflict ran out. Hold it again to resolve it.")
		}
		value, err := a.checkChoice(ctx, tx, p, c, in.Choice, in.Value)
		if err != nil {
			return err
		}
		at := now()
		_, err = tx.Exec(ctx, `INSERT INTO resolutions (branch_id, conflict_id, choice, value, by, at, main_seen) VALUES ($1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT (branch_id, conflict_id) DO UPDATE SET choice = EXCLUDED.choice, value = EXCLUDED.value, by = EXCLUDED.by,
			at = EXCLUDED.at, main_seen = EXCLUDED.main_seen`, b.ID, conflictID, in.Choice, value, pr.Email, at, c.Main)
		if err != nil {
			return fmt.Errorf("save resolution: %w", err)
		}
		if _, err := tx.Exec(ctx, "DELETE FROM holds WHERE branch_id = $1 AND conflict_id = $2", b.ID, conflictID); err != nil {
			return fmt.Errorf("release hold: %w", err)
		}
		c.Resolution = &Resolution{Choice: in.Choice, Value: value, By: pr.Email, At: at, MainSeen: c.Main}
		c.HeldUntil = nil
		out = c.json()
		return a.audit(ctx, tx, pr.Email, "conflict.resolved", p, b.Name+": "+conflictID+" ("+in.Choice+")")
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, out)
	return nil
}

// checkChoice validates a resolution choice for a conflict and returns the value it writes.
func (a *App) checkChoice(ctx context.Context, q db, p *Project, c *Conflict, choice string, custom *string) (*string, error) {
	if !slices.Contains([]string{"main", "branch", "custom"}, choice) {
		return nil, errField("choice", "Choose keep main, keep branch or write a new value.")
	}
	main, err := mainBranch(ctx, q, p.ID)
	if err != nil {
		return nil, err
	}
	nameTaken := func(name string) (bool, error) {
		var n int
		err := q.QueryRow(ctx, "SELECT count(*) FROM branch_keys WHERE branch_id = $1 AND name = $2 AND NOT deleted AND key_id <> $3",
			main.ID, name, c.KeyID).Scan(&n)
		return n > 0, err
	}
	switch c.Field {
	case "presence":
		if choice == "custom" {
			return nil, errField("choice", "Choose to keep main or keep the branch for a deleted key.")
		}
		if choice == "branch" && c.Main != nil && *c.Main == "deleted" {
			if taken, err := nameTaken(c.branchKeyName); err != nil {
				return nil, fmt.Errorf("check key name: %w", err)
			} else if taken {
				return nil, errField("choice", "Another key on main already uses that name.")
			}
		}
		return c.valueFor(choice, nil), nil
	case "name":
		value := c.valueFor(choice, custom)
		if choice == "custom" {
			if custom == nil || !keyNamePattern.MatchString(*custom) {
				return nil, errField("value", "Use 1 to 120 letters, digits, dots, underscores or hyphens.")
			}
		}
		if value != nil && (choice == "custom" || choice == "branch" || c.Main == nil) {
			if taken, err := nameTaken(*value); err != nil {
				return nil, fmt.Errorf("check key name: %w", err)
			} else if taken {
				return nil, errField("choice", "Another key on main already uses that name. Write a new value.")
			}
		}
		if c.Main == nil && choice != "custom" {
			return nil, errField("choice", "Another key on main already uses that name. Write a new value.")
		}
		return value, nil
	}
	if choice == "custom" {
		if custom == nil {
			return nil, errField("value", "Write the new value.")
		}
		if c.Field == "source" {
			if e := validSource(*custom); e != nil {
				return nil, errField("value", e.Fields["source"])
			}
		} else if e := validValue("value", *custom); e != nil {
			return nil, e
		}
	}
	return c.valueFor(choice, custom), nil
}

func (c *Conflict) valueFor(choice string, custom *string) *string {
	switch choice {
	case "main":
		return c.Main
	case "branch":
		return c.Branch
	}
	return custom
}

func (a *App) handleMerge(w http.ResponseWriter, r *http.Request) error {
	pr, p, b, err := a.ownerBranch(r)
	if err != nil {
		return err
	}
	if err := decodeJSON(r, &struct{}{}); err != nil {
		return err
	}
	ctx := r.Context()
	var result map[string]any
	var up uploads
	err = a.inProject(ctx, p.ID, func(tx pgx.Tx) error {
		if b, err = branchByID(ctx, tx, b.ID); err != nil {
			return err
		}
		if b.IsMain || b.State != stateInReview {
			return errIllegalTransition(b.State, stateMerged)
		}
		pv, err := a.computePreview(ctx, tx, p, b)
		if err != nil {
			return err
		}
		if open := pv.unresolvedIDs(); len(open) > 0 {
			return newErr(http.StatusConflict, "conflicts_unresolved", fmt.Sprintf("Resolve every conflict before merging. %d left.", len(open))).
				with(map[string]any{"conflicts": open})
		}
		main, err := mainBranch(ctx, tx, p.ID)
		if err != nil {
			return err
		}
		opID := newID()
		snapKey := fmt.Sprintf("projects/%s/snapshots/%s.json", p.ID, opID)
		if err := a.snapshotMain(ctx, tx, &up, p, main, snapKey); err != nil {
			return err
		}
		at := now()
		if err := a.applyMerge(ctx, tx, p, b, main, pv, pr.Email, at); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "UPDATE branches SET state = 'merged' WHERE id = $1", b.ID); err != nil {
			return fmt.Errorf("mark branch merged: %w", err)
		}
		rev, err := bumpMainRev(ctx, tx, p.ID)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO operations (id, project_id, kind, label, at, rev_after, snapshot_key, branch_id)
			VALUES ($1, $2, 'merge', $3, $4, $5, $6, $7)`, opID, p.ID, "Merge "+b.Name, at, rev, snapKey, b.ID)
		if err != nil {
			return fmt.Errorf("record operation: %w", err)
		}
		result = map[string]any{"merge_id": opID, "new_keys": pv.NewKeys, "edited_keys": pv.EditedKeys,
			"deleted_keys": pv.DeletedKeys, "conflicts_resolved": len(pv.Conflicts)}
		return a.audit(ctx, tx, pr.Email, "branch.merged", p, b.Name)
	})
	if err != nil {
		up.discard(ctx, a)
		return err
	}
	writeJSON(w, http.StatusOK, result)
	return nil
}

// applyMerge writes the classified changes and chosen resolutions into main.
func (a *App) applyMerge(ctx context.Context, tx pgx.Tx, p *Project, b, main *Branch, pv *Preview, actor string, at time.Time) error {
	branch, err := loadBranchState(ctx, tx, b.ID)
	if err != nil {
		return err
	}
	mainState, err := loadBranchState(ctx, tx, main.ID)
	if err != nil {
		return err
	}
	for _, an := range pv.Analyses {
		touched := false
		switch an.Kind {
		case kindNew:
			name := an.BranchKey.Name
			if len(an.Fields) > 0 && an.Fields[0].Conflict != nil && an.Fields[0].Conflict.Resolution != nil {
				name = *an.Fields[0].Conflict.Resolution.Value
			}
			if err := copyKeyToMain(ctx, tx, b.ID, main.ID, an.KeyID, name, an.BranchKey.Source); err != nil {
				return err
			}
			touched = true
		case kindDeleted:
			if err := markDeleted(ctx, tx, main.ID, an.KeyID, true); err != nil {
				return err
			}
			touched = true
		case kindPresence:
			res := an.Presence.Resolution
			switch {
			case res.Choice != "branch":
				// keeping main's side changes nothing
			case an.BranchKey == nil || an.BranchKey.Deleted:
				if err := markDeleted(ctx, tx, main.ID, an.KeyID, true); err != nil {
					return err
				}
				touched = true
			default:
				if err := resurrect(ctx, tx, b.ID, main.ID, an.KeyID, an.BranchKey); err != nil {
					return err
				}
				touched = true
			}
		default:
			if touched, err = a.applyFields(ctx, tx, p, main, mainState, branch, an, actor, at); err != nil {
				return err
			}
		}
		if touched {
			name := an.Name
			if err := addRevision(ctx, tx, p.ID, an.KeyID, b.Name, "merged", nil, &name, actor); err != nil {
				return err
			}
		}
	}
	return nil
}

func markDeleted(ctx context.Context, q db, branchID, keyID string, deleted bool) error {
	if _, err := q.Exec(ctx, "UPDATE branch_keys SET deleted = $3 WHERE branch_id = $1 AND key_id = $2", branchID, keyID, deleted); err != nil {
		return fmt.Errorf("mark key deleted: %w", err)
	}
	return nil
}

func copySegments(ctx context.Context, q db, fromBranch, toBranch, keyID string) error {
	_, err := q.Exec(ctx, `INSERT INTO segments (id, project_id, branch_id, key_id, language, value, status, score, origin, issues, comments, history)
		SELECT gen_random_uuid()::text, project_id, $2, key_id, language, value, status, score, origin, issues, comments, history
		FROM segments WHERE branch_id = $1 AND key_id = $3`, fromBranch, toBranch, keyID)
	if err != nil {
		return fmt.Errorf("copy segments: %w", err)
	}
	return nil
}

func copyKeyToMain(ctx context.Context, q db, branchID, mainID, keyID, name, source string) error {
	_, err := q.Exec(ctx, "INSERT INTO branch_keys (branch_id, key_id, name, source) VALUES ($1, $2, $3, $4)", mainID, keyID, name, source)
	if err != nil {
		return fmt.Errorf("add merged key: %w", err)
	}
	return copySegments(ctx, q, branchID, mainID, keyID)
}

// resurrect brings a key that main deleted back with the branch's version of it.
func resurrect(ctx context.Context, q db, branchID, mainID, keyID string, bk *Key) error {
	_, err := q.Exec(ctx, "UPDATE branch_keys SET name = $3, source = $4, deleted = false WHERE branch_id = $1 AND key_id = $2", mainID, keyID, bk.Name, bk.Source)
	if err != nil {
		return fmt.Errorf("restore merged key: %w", err)
	}
	if _, err := q.Exec(ctx, "DELETE FROM segments WHERE branch_id = $1 AND key_id = $2", mainID, keyID); err != nil {
		return fmt.Errorf("clear old segments: %w", err)
	}
	return copySegments(ctx, q, branchID, mainID, keyID)
}

// applyFields applies the branch edits and resolutions of one key field by field.
func (a *App) applyFields(ctx context.Context, tx pgx.Tx, p *Project, main *Branch, mainState, branch *branchState, an *keyAnalysis, actor string, at time.Time) (bool, error) {
	touched := false
	for _, f := range an.Fields {
		var value *string
		fromBranch := false
		switch {
		case f.Conflict != nil:
			res := f.Conflict.Resolution
			switch res.Choice {
			case "branch":
				value, fromBranch = f.Branch, true
			case "custom":
				value = res.Value
			}
		case f.BranchChanged && !eq(f.Branch, f.Main):
			value, fromBranch = f.Branch, true
		}
		if value == nil {
			continue
		}
		touched = true
		switch f.Field {
		case "name":
			if _, err := tx.Exec(ctx, "UPDATE branch_keys SET name = $3 WHERE branch_id = $1 AND key_id = $2", main.ID, an.KeyID, *value); err != nil {
				return false, fmt.Errorf("apply merged name: %w", err)
			}
		case "source":
			if _, err := tx.Exec(ctx, "UPDATE branch_keys SET source = $3 WHERE branch_id = $1 AND key_id = $2", main.ID, an.KeyID, *value); err != nil {
				return false, fmt.Errorf("apply merged source: %w", err)
			}
			if err := a.changeSource(ctx, tx, p, main, an.KeyID, *value, actor, at); err != nil {
				return false, err
			}
		default:
			lang := f.Field[len(translationField):]
			ms := mainState.segs[an.KeyID][lang]
			if ms == nil {
				continue
			}
			if fromBranch {
				bs := branch.segs[an.KeyID][lang]
				_, err := tx.Exec(ctx, `UPDATE segments SET value = b.value, status = b.status, score = b.score, origin = b.origin,
					issues = b.issues, comments = b.comments, history = b.history FROM segments b WHERE segments.id = $1 AND b.id = $2`, ms.ID, bs.ID)
				if err != nil {
					return false, fmt.Errorf("apply merged translation: %w", err)
				}
				continue
			}
			ms, err := segmentByID(ctx, tx, ms.ID)
			if err != nil {
				return false, err
			}
			ms.setValue(*value, "manual", actor, at)
			if err := ms.save(ctx, tx); err != nil {
				return false, err
			}
		}
	}
	return touched, nil
}
