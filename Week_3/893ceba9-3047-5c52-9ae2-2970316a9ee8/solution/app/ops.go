package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
)

// uploads tracks the objects a request stored, so a failed request can take them back out.
type uploads struct{ keys []string }

func (u *uploads) put(ctx context.Context, a *App, key string, data []byte, contentType string) error {
	if err := a.s3.Put(ctx, key, data, contentType); err != nil {
		return err
	}
	u.keys = append(u.keys, key)
	return nil
}

// discard takes the stored objects back out; it uses its own deadline because the request may already be over.
func (u *uploads) discard(ctx context.Context, a *App) {
	ctx, cancel := detached(ctx)
	defer cancel()
	for _, key := range u.keys {
		if err := a.s3.Delete(ctx, key); err != nil {
			log.Printf("discard stored object: %v", err)
		}
	}
}

type snapKey struct {
	KeyID   string `json:"key_id"`
	Name    string `json:"name"`
	Source  string `json:"source"`
	Deleted bool   `json:"deleted"`
}

type snapSegment struct {
	ID       string          `json:"id"`
	KeyID    string          `json:"key_id"`
	Language string          `json:"language"`
	Value    *string         `json:"value"`
	Status   string          `json:"status"`
	Score    *int            `json:"score"`
	Origin   *string         `json:"origin"`
	Issues   json.RawMessage `json:"issues"`
	Comments json.RawMessage `json:"comments"`
	History  json.RawMessage `json:"history"`
}

type snapTM struct {
	ID         string    `json:"id"`
	Source     string    `json:"source"`
	NormSource string    `json:"norm_source"`
	Language   string    `json:"target_language"`
	Target     string    `json:"target"`
	NormTarget string    `json:"norm_target"`
	ImportID   *string   `json:"import_id"`
	CreatedAt  time.Time `json:"created_at"`
}

type snapshot struct {
	Keys     []snapKey     `json:"keys"`
	Segments []snapSegment `json:"segments"`
	TM       []snapTM      `json:"tm"`
}

// snapshotMain stores main and the TM exactly as they are, in MinIO, before an operation changes them.
func (a *App) snapshotMain(ctx context.Context, q db, up *uploads, p *Project, main *Branch, key string) error {
	var snap snapshot
	rows, err := q.Query(ctx, "SELECT key_id, name, source, deleted FROM branch_keys WHERE branch_id = $1 ORDER BY key_id", main.ID)
	if err != nil {
		return fmt.Errorf("snapshot keys: %w", err)
	}
	for rows.Next() {
		var k snapKey
		if err := rows.Scan(&k.KeyID, &k.Name, &k.Source, &k.Deleted); err != nil {
			rows.Close()
			return fmt.Errorf("scan snapshot key: %w", err)
		}
		snap.Keys = append(snap.Keys, k)
	}
	rows.Close()
	rows, err = q.Query(ctx, `SELECT id, key_id, language, value, status, score, origin, issues, comments, history
		FROM segments WHERE branch_id = $1 ORDER BY id`, main.ID)
	if err != nil {
		return fmt.Errorf("snapshot segments: %w", err)
	}
	for rows.Next() {
		var s snapSegment
		if err := rows.Scan(&s.ID, &s.KeyID, &s.Language, &s.Value, &s.Status, &s.Score, &s.Origin, &s.Issues, &s.Comments, &s.History); err != nil {
			rows.Close()
			return fmt.Errorf("scan snapshot segment: %w", err)
		}
		snap.Segments = append(snap.Segments, s)
	}
	rows.Close()
	rows, err = q.Query(ctx, `SELECT id, source, norm_source, target_language, target, norm_target, import_id, created_at
		FROM tm_entries WHERE project_id = $1 ORDER BY seq`, p.ID)
	if err != nil {
		return fmt.Errorf("snapshot TM: %w", err)
	}
	for rows.Next() {
		var t snapTM
		if err := rows.Scan(&t.ID, &t.Source, &t.NormSource, &t.Language, &t.Target, &t.NormTarget, &t.ImportID, &t.CreatedAt); err != nil {
			rows.Close()
			return fmt.Errorf("scan snapshot TM entry: %w", err)
		}
		snap.TM = append(snap.TM, t)
	}
	rows.Close()
	raw, err := json.Marshal(snap)
	if err != nil {
		return fmt.Errorf("encode snapshot: %w", err)
	}
	return up.put(ctx, a, key, raw, "application/json")
}

func (a *App) handleOperations(w http.ResponseWriter, r *http.Request) error {
	_, p, err := a.ownerProject(r)
	if err != nil {
		return err
	}
	rows, err := a.pool.Query(r.Context(), "SELECT id, kind, label, at, restored_at, rev_after FROM operations WHERE project_id = $1 ORDER BY seq DESC", p.ID)
	if err != nil {
		return fmt.Errorf("list operations: %w", err)
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		op, err := scanOperation(rows, p.MainRev)
		if err != nil {
			return err
		}
		out = append(out, op)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read rows: %w", err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"operations": out})
	return nil
}

func scanOperation(row pgx.Row, mainRev int64) (map[string]any, error) {
	var id, kind, label string
	var at time.Time
	var restored *time.Time
	var rev int64
	if err := row.Scan(&id, &kind, &label, &at, &restored, &rev); err != nil {
		return nil, fmt.Errorf("scan operation: %w", err)
	}
	return map[string]any{"id": id, "kind": kind, "label": label, "at": fmtTime(at), "restored_at": fmtTimePtr(restored),
		"restorable": restored == nil && rev == mainRev}, nil
}

func (a *App) handleRestore(w http.ResponseWriter, r *http.Request) error {
	pr, p, err := a.ownerProject(r)
	if err != nil {
		return err
	}
	if err := decodeJSON(r, &struct{}{}); err != nil {
		return err
	}
	ctx := r.Context()
	var out map[string]any
	err = a.inProject(ctx, p.ID, func(tx pgx.Tx) error {
		cur, err := projectByID(ctx, tx, p.ID)
		if err != nil {
			return err
		}
		var kind, snapKey string
		var restored *time.Time
		var rev int64
		var branchID *string
		err = tx.QueryRow(ctx, "SELECT kind, restored_at, rev_after, snapshot_key, branch_id FROM operations WHERE id = $1 AND project_id = $2",
			r.PathValue("op_id"), p.ID).Scan(&kind, &restored, &rev, &snapKey, &branchID)
		if errors.Is(err, pgx.ErrNoRows) {
			return errNotFound()
		}
		if err != nil {
			return fmt.Errorf("load operation: %w", err)
		}
		if restored != nil {
			return newErr(http.StatusConflict, "already_restored", "This was already restored.")
		}
		if rev != cur.MainRev {
			return newErr(http.StatusConflict, "restore_superseded", "Later changes were made after this, so it can't be restored exactly.")
		}
		raw, _, err := a.s3.Get(ctx, snapKey)
		if err != nil {
			if errors.Is(err, errObjectMissing) {
				return fmt.Errorf("snapshot %s is missing: %w", snapKey, err)
			}
			return err
		}
		var snap snapshot
		if err := json.Unmarshal(raw, &snap); err != nil {
			return fmt.Errorf("decode snapshot: %w", err)
		}
		main, err := mainBranch(ctx, tx, p.ID)
		if err != nil {
			return err
		}
		if err := a.restoreMain(ctx, tx, p, main, &snap, pr.Email); err != nil {
			return err
		}
		if branchID != nil {
			if _, err := tx.Exec(ctx, "UPDATE branches SET state = 'in_review' WHERE id = $1", *branchID); err != nil {
				return fmt.Errorf("reopen merged branch: %w", err)
			}
		}
		at := now()
		if _, err := tx.Exec(ctx, "UPDATE operations SET restored_at = $2 WHERE id = $1", r.PathValue("op_id"), at); err != nil {
			return fmt.Errorf("mark restored: %w", err)
		}
		if _, err := bumpMainRev(ctx, tx, p.ID); err != nil {
			return err
		}
		op, err := scanOperation(tx.QueryRow(ctx, "SELECT id, kind, label, at, restored_at, rev_after FROM operations WHERE id = $1", r.PathValue("op_id")), -1)
		if err != nil {
			return err
		}
		out = op
		return a.audit(ctx, tx, pr.Email, "operation.restored", p, kind+" "+r.PathValue("op_id"))
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, out)
	return nil
}

// restoreMain puts main and the TM back to the snapshot exactly and records `restored` on keys that differ.
func (a *App) restoreMain(ctx context.Context, tx pgx.Tx, p *Project, main *Branch, snap *snapshot, actor string) error {
	before, err := keyFingerprints(ctx, tx, main.ID)
	if err != nil {
		return err
	}
	for _, sql := range []string{"DELETE FROM segments WHERE branch_id = $1", "DELETE FROM branch_keys WHERE branch_id = $1"} {
		if _, err := tx.Exec(ctx, sql, main.ID); err != nil {
			return fmt.Errorf("clear main: %w", err)
		}
	}
	for _, k := range snap.Keys {
		if _, err := tx.Exec(ctx, "INSERT INTO branch_keys (branch_id, key_id, name, source, deleted) VALUES ($1, $2, $3, $4, $5)",
			main.ID, k.KeyID, k.Name, k.Source, k.Deleted); err != nil {
			return fmt.Errorf("restore key: %w", err)
		}
	}
	for _, s := range snap.Segments {
		if _, err := tx.Exec(ctx, `INSERT INTO segments (id, project_id, branch_id, key_id, language, value, status, score, origin, issues, comments, history)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, s.ID, p.ID, main.ID, s.KeyID, s.Language, s.Value, s.Status,
			s.Score, s.Origin, []byte(s.Issues), []byte(s.Comments), []byte(s.History)); err != nil {
			return fmt.Errorf("restore segment: %w", err)
		}
	}
	if _, err := tx.Exec(ctx, "DELETE FROM tm_entries WHERE project_id = $1", p.ID); err != nil {
		return fmt.Errorf("clear TM: %w", err)
	}
	for _, t := range snap.TM {
		if _, err := tx.Exec(ctx, `INSERT INTO tm_entries (id, project_id, source, norm_source, target_language, target, norm_target, import_id, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, t.ID, p.ID, t.Source, t.NormSource, t.Language, t.Target, t.NormTarget, t.ImportID, t.CreatedAt); err != nil {
			return fmt.Errorf("restore TM entry: %w", err)
		}
	}
	after, err := keyFingerprints(ctx, tx, main.ID)
	if err != nil {
		return err
	}
	for keyID, fp := range after {
		if before[keyID] != fp {
			if err := addRevision(ctx, tx, p.ID, keyID, main.Name, "restored", nil, nil, actor); err != nil {
				return err
			}
		}
	}
	for keyID := range before {
		if _, kept := after[keyID]; !kept {
			if err := addRevision(ctx, tx, p.ID, keyID, main.Name, "restored", nil, nil, actor); err != nil {
				return err
			}
		}
	}
	return nil
}

// keyFingerprints summarises each key of a branch with its segments, to find what a restore changed.
func keyFingerprints(ctx context.Context, q db, branchID string) (map[string]string, error) {
	rows, err := q.Query(ctx, `SELECT k.key_id, k.name || '|' || k.source || '|' || k.deleted::text || '|' ||
		coalesce(string_agg(s.id || s.language || coalesce(s.value, '') || s.status || coalesce(s.score::text, '') || s.issues::text || s.comments::text, ',' ORDER BY s.id), '')
		FROM branch_keys k LEFT JOIN segments s ON s.branch_id = k.branch_id AND s.key_id = k.key_id
		WHERE k.branch_id = $1 GROUP BY k.key_id, k.name, k.source, k.deleted`, branchID)
	if err != nil {
		return nil, fmt.Errorf("fingerprint keys: %w", err)
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var id, fp string
		if err := rows.Scan(&id, &fp); err != nil {
			return nil, fmt.Errorf("scan fingerprint: %w", err)
		}
		out[id] = fp
	}
	return out, rows.Err()
}
