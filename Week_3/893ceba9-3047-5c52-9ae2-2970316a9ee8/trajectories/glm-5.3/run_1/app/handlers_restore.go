package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"
)

// stateSnapshot is the exact main and TM state recorded before an operation.
type stateSnapshot struct {
	MainVersion int64     `json:"main_version"`
	TmVersion   int64     `json:"tm_version"`
	Keys        []snapKey `json:"keys"`
	Tm          []snapTm  `json:"tm"`
}

type snapKey struct {
	ID      string    `json:"id"`
	Name    string    `json:"name"`
	Source  string    `json:"source"`
	Deleted bool      `json:"deleted"`
	Segs    []snapSeg `json:"segs"`
}

type snapSeg struct {
	ID       string        `json:"id"`
	KeyID    string        `json:"key_id"`
	Language string        `json:"language"`
	Value    *string       `json:"value"`
	Status   string        `json:"status"`
	Score    *int          `json:"score"`
	Origin   *string       `json:"origin"`
	Issues   string        `json:"issues"`
	Comments []snapComment `json:"comments"`
}

type snapComment struct {
	ID     string `json:"id"`
	Author string `json:"author"`
	Body   string `json:"body"`
	At     string `json:"at"`
}

type snapTm struct {
	ID             string  `json:"id"`
	Source         string  `json:"source"`
	Target         string  `json:"target"`
	TargetLanguage string  `json:"target_language"`
	ImportID       *string `json:"import_id"`
}

// bumpMainVersion advances the main change counter; any later change after an
// operation makes a restore superseded.
func bumpMainVersion(ctx context.Context, tx *sql.Tx) (int64, error) {
	if _, err := tx.ExecContext(ctx, `INSERT INTO counters (name, value) VALUES ('main_version', 1)
		ON CONFLICT (name) DO UPDATE SET value = counters.value + 1`); err != nil {
		return 0, err
	}
	var v int64
	if err := tx.QueryRowContext(ctx, `SELECT value FROM counters WHERE name = 'main_version'`).Scan(&v); err != nil {
		return 0, err
	}
	return v, nil
}

func bumpTmVersion(ctx context.Context, tx *sql.Tx) (int64, error) {
	if _, err := tx.ExecContext(ctx, `INSERT INTO counters (name, value) VALUES ('tm_version', 1)
		ON CONFLICT (name) DO UPDATE SET value = counters.value + 1`); err != nil {
		return 0, err
	}
	var v int64
	if err := tx.QueryRowContext(ctx, `SELECT value FROM counters WHERE name = 'tm_version'`).Scan(&v); err != nil {
		return 0, err
	}
	return v, nil
}

// snapshotState records main's and the TM's exact state.
func (s *Server) snapshotState(ctx context.Context, tx *sql.Tx, p *Project) (*stateSnapshot, error) {
	mainID, err := mainBranchIDTx(ctx, tx, p.ID)
	if err != nil {
		return nil, err
	}
	snap := &stateSnapshot{}
	if err := tx.QueryRowContext(ctx, `SELECT value FROM counters WHERE name = 'main_version'`).Scan(&snap.MainVersion); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			snap.MainVersion = 0
		} else {
			return nil, err
		}
	}
	if err := tx.QueryRowContext(ctx, `SELECT value FROM counters WHERE name = 'tm_version'`).Scan(&snap.TmVersion); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			snap.TmVersion = 0
		} else {
			return nil, err
		}
	}
	keyRows, err := tx.QueryContext(ctx, `SELECT id, name, source, deleted FROM keys WHERE branch_id = $1`, mainID)
	if err != nil {
		return nil, err
	}
	var keys []snapKey
	keyIDs := []string{}
	for keyRows.Next() {
		var k snapKey
		if err := keyRows.Scan(&k.ID, &k.Name, &k.Source, &k.Deleted); err != nil {
			keyRows.Close()
			return nil, err
		}
		keys = append(keys, k)
		keyIDs = append(keyIDs, k.ID)
	}
	keyRows.Close()
	for i, k := range keys {
		segs, err := snapshotSegments(ctx, tx, mainID, k.ID)
		if err != nil {
			return nil, err
		}
		keys[i].Segs = segs
	}
	snap.Keys = keys
	tmRows, err := tx.QueryContext(ctx, `SELECT id, source, target, target_language, import_id FROM tm_entries WHERE project_id = $1`, p.ID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tmRows.Close() }()
	for tmRows.Next() {
		var t snapTm
		var importID any
		if err := tmRows.Scan(&t.ID, &t.Source, &t.Target, &t.TargetLanguage, &importID); err != nil {
			return nil, err
		}
		if s, ok := importID.(string); ok {
			t.ImportID = &s
		}
		snap.Tm = append(snap.Tm, t)
	}
	return snap, tmRows.Err()
}

func snapshotSegments(ctx context.Context, tx *sql.Tx, mainID, keyID string) ([]snapSeg, error) {
	rows, err := tx.QueryContext(ctx, `SELECT id, key_id, language, value, status, score, origin, issues FROM segments WHERE key_id = $1 AND branch_id = $2`, keyID, mainID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []snapSeg
	for rows.Next() {
		var g snapSeg
		var value, origin any
		var score any
		if err := rows.Scan(&g.ID, &g.KeyID, &g.Language, &value, &g.Status, &score, &origin, &g.Issues); err != nil {
			return nil, err
		}
		g.Value = nullableString(value)
		if o, ok := origin.(string); ok {
			g.Origin = &o
		}
		if sc, ok := score.(int64); ok {
			v := int(sc)
			g.Score = &v
		}
		out = append(out, g)
	}
	for i, g := range out {
		comments, err := snapshotComments(ctx, tx, g.ID)
		if err != nil {
			return nil, err
		}
		out[i].Comments = comments
	}
	return out, rows.Err()
}

func snapshotComments(ctx context.Context, tx *sql.Tx, segID string) ([]snapComment, error) {
	rows, err := tx.QueryContext(ctx, `SELECT id, author, body, at FROM comments WHERE segment_id = $1 ORDER BY at`, segID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []snapComment
	for rows.Next() {
		var c snapComment
		var at time.Time
		if err := rows.Scan(&c.ID, &c.Author, &c.Body, &at); err != nil {
			return nil, err
		}
		c.At = at.UTC().Format(time.RFC3339)
		out = append(out, c)
	}
	return out, rows.Err()
}

func mainBranchIDTx(ctx context.Context, tx *sql.Tx, projectID string) (string, error) {
	var id string
	if err := tx.QueryRowContext(ctx, `SELECT id FROM branches WHERE project_id = $1 AND is_main`, projectID).Scan(&id); err != nil {
		return "", err
	}
	return id, nil
}

// ---- operations list and restore ----

func (s *Server) handleOperationsList(w http.ResponseWriter, r *http.Request) {
	p, err := s.projectInScope(w, r, r.PathValue("slug"))
	if err != nil {
		return
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT id, kind, label, at, restored_at FROM operations WHERE project_id = $1 ORDER BY at DESC`, p.ID)
	if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	defer func() { _ = rows.Close() }()
	ops := []map[string]any{}
	for rows.Next() {
		var id, kind, label string
		var at time.Time
		var restored any
		if err := rows.Scan(&id, &kind, &label, &at, &restored); err != nil {
			http.Error(w, "internal", 500)
			return
		}
		ops = append(ops, map[string]any{
			"id": id, "kind": kind, "label": label,
			"at": at.UTC().Format(time.RFC3339), "restored_at": restored,
			"restorable": restored == nil,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"operations": ops})
}

func (s *Server) handleOperationRestore(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	p, err := s.projectInScope(w, r, r.PathValue("slug"))
	if err != nil {
		return
	}
	opID := r.PathValue("op_id")
	var kind string
	var snapKey string
	var label string
	var opAt time.Time
	var restored any
	if err := s.db.QueryRowContext(r.Context(), `SELECT kind, snapshot_key, label, at, restored_at FROM operations WHERE id = $1 AND project_id = $2`, opID, p.ID).
		Scan(&kind, &snapKey, &label, &opAt, &restored); err != nil {
		notFoundError(w)
		return
	}
	if restored != nil {
		writeError(w, http.StatusConflict, "already_restored", "This was already restored.")
		return
	}

	// storage holds the snapshot; nothing restores without it
	data, err := s.storage.Get(r.Context(), snapKey)
	if err != nil {
		serviceUnavailable(w, "storage_unavailable", "File storage isn't answering. Nothing was saved; try again in a few minutes.", nil)
		return
	}
	var snap stateSnapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		http.Error(w, "internal", 500)
		return
	}

	// a restore is refused once any later change touched main or the TM
	var currentMain, currentTm int64
	_ = s.db.QueryRowContext(r.Context(), `SELECT coalesce(value,0) FROM counters WHERE name = 'main_version'`).Scan(&currentMain)
	_ = s.db.QueryRowContext(r.Context(), `SELECT coalesce(value,0) FROM counters WHERE name = 'tm_version'`).Scan(&currentTm)
	if currentMain != snap.MainVersion || currentTm != snap.TmVersion {
		writeError(w, http.StatusConflict, "restore_superseded", "Later changes were made after this, so it can't be restored exactly.")
		return
	}

	err = s.store.withTx(r.Context(), func(tx *sql.Tx) error {
		if err := s.restoreSnapshot(r.Context(), tx, p, &snap); err != nil {
			return err
		}
		if _, err := tx.ExecContext(r.Context(), `UPDATE operations SET restored_at = now() WHERE id = $1`, opID); err != nil {
			return err
		}
		if kind == "merge" {
			// restoring a merge returns its branch to in_review with its resolutions
			if _, err := tx.ExecContext(r.Context(), `UPDATE branches SET state = 'in_review' WHERE id = (SELECT branch_id FROM conflicts WHERE project_id = $1 LIMIT 1)`, p.ID); err != nil {
				return err
			}
		}
		// restored revisions on every live key
		if _, err := tx.ExecContext(r.Context(), `INSERT INTO key_revisions (key_id, at, branch, field, from_val, to_val, actor)
			SELECT id, now(), 'main', 'restored', NULL, source, $2 FROM keys WHERE branch_id = (SELECT id FROM branches WHERE project_id = $1 AND is_main)`,
			p.ID, u.Email); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		log.Printf("operation restore failed: %v", err)
		http.Error(w, "internal", 500)
		return
	}
	_ = s.store.AuditInsert(r.Context(), u.Email, "operation.restored", p.Slug, kind)
	writeJSON(w, http.StatusOK, map[string]any{
		"id": opID, "kind": kind, "label": label,
		"at": opAt.UTC().Format(time.RFC3339), "restored_at": time.Now().UTC().Format(time.RFC3339),
		"restorable": false,
	})
}

// restoreSnapshot brings main and the TM back byte for byte.
func (s *Server) restoreSnapshot(ctx context.Context, tx *sql.Tx, p *Project, snap *stateSnapshot) error {
	mainID, err := mainBranchIDTx(ctx, tx, p.ID)
	if err != nil {
		return err
	}
	// remove everything not in the snapshot, then upsert the snapshot exactly
	if _, err := tx.ExecContext(ctx, `DELETE FROM comments WHERE segment_id IN (SELECT id FROM segments WHERE branch_id = $1)`, mainID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM segment_history WHERE segment_id IN (SELECT id FROM segments WHERE branch_id = $1)`, mainID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM segments WHERE branch_id = $1`, mainID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM key_revisions WHERE key_id IN (SELECT id FROM keys WHERE branch_id = $1)`, mainID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM keys WHERE branch_id = $1`, mainID); err != nil {
		return err
	}
	for _, k := range snap.Keys {
		if _, err := tx.ExecContext(ctx, `INSERT INTO keys (id, project_id, branch_id, name, source, deleted, created_at) VALUES ($1,$2,$3,$4,$5,$6, now())`,
			k.ID, p.ID, mainID, k.Name, k.Source, k.Deleted); err != nil {
			return fmt.Errorf("restore key: %w", err)
		}
		for _, g := range k.Segs {
			var score any
			if g.Score != nil {
				score = *g.Score
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO segments (id, project_id, branch_id, key_id, language, value, status, score, origin, issues, created_at, updated_at)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now(), now())`,
				g.ID, p.ID, mainID, k.ID, g.Language, g.Value, g.Status, score, g.Origin, g.Issues); err != nil {
				return fmt.Errorf("restore segment: %w", err)
			}
			for _, c := range g.Comments {
				if _, err := tx.ExecContext(ctx, `INSERT INTO comments (id, segment_id, author, body, at) VALUES ($1,$2,$3,$4,$5)`,
					c.ID, g.ID, c.Author, c.Body, c.At); err != nil {
					return fmt.Errorf("restore comment: %w", err)
				}
			}
		}
	}
	// TM: remove the entries this import added and re-add anything the snapshot had
	if _, err := tx.ExecContext(ctx, `DELETE FROM tm_entries WHERE project_id = $1`, p.ID); err != nil {
		return err
	}
	for _, t := range snap.Tm {
		if _, err := tx.ExecContext(ctx, `INSERT INTO tm_entries (id, project_id, source, source_norm, target, target_norm, target_language, import_id, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())`,
			t.ID, p.ID, t.Source, Normalise(t.Source), t.Target, Normalise(t.Target), t.TargetLanguage, t.ImportID); err != nil {
			return fmt.Errorf("restore tm: %w", err)
		}
	}
	if _, err := bumpMainVersion(ctx, tx); err != nil {
		return err
	}
	if _, err := bumpTmVersion(ctx, tx); err != nil {
		return err
	}
	return nil
}
