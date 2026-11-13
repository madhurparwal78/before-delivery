package main

import (
	"context"
	"database/sql"
)

// baseKey is one key's state at branch creation, the comparison base.
type baseKey struct {
	KeyID   string
	Name    string
	Source  string
	Present bool
}

// copyBase stores main's state as a branch's base, inside the branch-creation
// transaction.
func copyBase(ctx context.Context, tx *sql.Tx, projectID, branchID string) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO branch_bases (branch_id, key_id, name, source, present)
		SELECT $1, k.id, k.name, k.source, NOT k.deleted
		FROM keys k JOIN branches b ON b.id = k.branch_id
		WHERE b.project_id = $2 AND b.is_main`, branchID, projectID)
	return err
}

func (s *Server) baseKeys(ctx context.Context, branchID string) ([]baseKey, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT key_id, name, source, present FROM branch_bases WHERE branch_id = $1`, branchID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []baseKey
	for rows.Next() {
		var b baseKey
		if err := rows.Scan(&b.KeyID, &b.Name, &b.Source, &b.Present); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}
