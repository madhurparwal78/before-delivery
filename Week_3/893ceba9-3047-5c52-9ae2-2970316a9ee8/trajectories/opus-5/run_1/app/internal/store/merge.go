package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/marlowquill/interline-desk/internal/domain"
)

// Resolutions reads a branch's stored conflict resolutions.
func (s *Store) Resolutions(ctx context.Context, db DB, branchID string) (map[string]*domain.Resolution, error) {
	rows, err := db.Query(ctx, `select conflict_id, choice, value, by_actor, at, main_seen from resolutions
	        where branch_id = $1`, branchID)
	if err != nil {
		return nil, fmt.Errorf("list resolutions: %w", err)
	}
	defer rows.Close()
	out := map[string]*domain.Resolution{}
	for rows.Next() {
		var conflictID string
		res := &domain.Resolution{}
		if err := rows.Scan(&conflictID, &res.Choice, &res.Value, &res.By, &res.At, &res.MainSeen); err != nil {
			return nil, fmt.Errorf("scan resolution: %w", err)
		}
		res.At = res.At.UTC()
		out[conflictID] = res
	}
	return out, rows.Err()
}

func (s *Store) SaveResolution(ctx context.Context, db DB, branchID, conflictID string, res *domain.Resolution) error {
	_, err := db.Exec(ctx, `insert into resolutions (branch_id, conflict_id, choice, value, by_actor, at, main_seen)
	        values ($1,$2,$3,$4,$5,$6,$7)
	        on conflict (branch_id, conflict_id) do update set choice = excluded.choice, value = excluded.value,
	        by_actor = excluded.by_actor, at = excluded.at, main_seen = excluded.main_seen`,
		branchID, conflictID, res.Choice, res.Value, res.By, res.At, res.MainSeen)
	if err != nil {
		return fmt.Errorf("save resolution: %w", err)
	}
	return nil
}

// Holds reads the live holds of a branch.
func (s *Store) Holds(ctx context.Context, db DB, branchID string) (map[string]time.Time, error) {
	rows, err := db.Query(ctx, `select conflict_id, held_until from holds
	        where branch_id = $1 and held_until > now()`, branchID)
	if err != nil {
		return nil, fmt.Errorf("list holds: %w", err)
	}
	defer rows.Close()
	out := map[string]time.Time{}
	for rows.Next() {
		var conflictID string
		var until time.Time
		if err := rows.Scan(&conflictID, &until); err != nil {
			return nil, fmt.Errorf("scan hold: %w", err)
		}
		out[conflictID] = until.UTC()
	}
	return out, rows.Err()
}

// TakeHold gives the caller's session the hold, unless another session holds it.
// Of several simultaneous requests exactly one wins.
func (s *Store) TakeHold(ctx context.Context, branchID, conflictID, sessionID string, ttl time.Duration) (time.Time, string, error) {
	until := Now().Add(ttl)
	var heldUntil time.Time
	var holder string
	err := s.Pool.QueryRow(ctx, `insert into holds (branch_id, conflict_id, session_id, held_until)
	        values ($1,$2,$3,$4)
	        on conflict (branch_id, conflict_id) do update set session_id = excluded.session_id,
	            held_until = excluded.held_until
	        where holds.held_until <= now() or holds.session_id = excluded.session_id
	        returning held_until, session_id`, branchID, conflictID, sessionID, until).Scan(&heldUntil, &holder)
	if errors.Is(err, pgx.ErrNoRows) {
		var other time.Time
		if err := s.Pool.QueryRow(ctx, `select held_until from holds where branch_id = $1 and conflict_id = $2`,
			branchID, conflictID).Scan(&other); err != nil {
			return time.Time{}, "", fmt.Errorf("read competing hold: %w", err)
		}
		return other.UTC(), "", nil
	}
	if err != nil {
		return time.Time{}, "", fmt.Errorf("take hold: %w", err)
	}
	return heldUntil.UTC(), holder, nil
}

// HoldBySession reports whether the caller's session still holds a conflict.
func (s *Store) HoldBySession(ctx context.Context, db DB, branchID, conflictID, sessionID string) (bool, error) {
	var n int
	err := db.QueryRow(ctx, `select count(*) from holds where branch_id = $1 and conflict_id = $2
	        and session_id = $3 and held_until > now()`, branchID, conflictID, sessionID).Scan(&n)
	if err != nil {
		return false, fmt.Errorf("read hold: %w", err)
	}
	return n > 0, nil
}

func (s *Store) ReleaseHold(ctx context.Context, db DB, branchID, conflictID string) error {
	if _, err := db.Exec(ctx, `delete from holds where branch_id = $1 and conflict_id = $2`,
		branchID, conflictID); err != nil {
		return fmt.Errorf("release hold: %w", err)
	}
	return nil
}

// Operations lists a project's restorable imports and merges, newest first.
func (s *Store) Operations(ctx context.Context, db DB, projectID string) ([]Operation, error) {
	seq, err := s.ChangeSeq(ctx, db, projectID)
	if err != nil {
		return nil, err
	}
	rows, err := db.Query(ctx, `select id, kind, label, branch, at, restored_at, seq_after from operations
	        where project_id = $1 order by at desc, id desc`, projectID)
	if err != nil {
		return nil, fmt.Errorf("list operations: %w", err)
	}
	defer rows.Close()
	out := []Operation{}
	for rows.Next() {
		var op Operation
		var seqAfter int64
		if err := rows.Scan(&op.ID, &op.Kind, &op.Label, &op.Branch, &op.At, &op.RestoredAt, &seqAfter); err != nil {
			return nil, fmt.Errorf("scan operation: %w", err)
		}
		op.At = op.At.UTC()
		op.Restorable = op.RestoredAt == nil && seqAfter == seq
		out = append(out, op)
	}
	return out, rows.Err()
}

func (s *Store) Operation(ctx context.Context, db DB, projectID, opID string) (*Operation, int64, string, error) {
	var op Operation
	var seqAfter int64
	var snapshotKey string
	err := db.QueryRow(ctx, `select id, kind, label, branch, at, restored_at, seq_after, snapshot_key
	        from operations where project_id = $1 and id = $2`, projectID, opID).
		Scan(&op.ID, &op.Kind, &op.Label, &op.Branch, &op.At, &op.RestoredAt, &seqAfter, &snapshotKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, 0, "", ErrNotFound
	}
	if err != nil {
		return nil, 0, "", fmt.Errorf("read operation: %w", err)
	}
	op.At = op.At.UTC()
	return &op, seqAfter, snapshotKey, nil
}

func (s *Store) InsertOperation(ctx context.Context, db DB, projectID, id, kind, label, branch, snapshotKey string, at time.Time) error {
	if _, err := db.Exec(ctx, `insert into operations (id, project_id, kind, label, branch, at, snapshot_key, seq_after)
	        values ($1,$2,$3,$4,$5,$6,$7,0)`, id, projectID, kind, label, branch, at, snapshotKey); err != nil {
		return fmt.Errorf("insert operation: %w", err)
	}
	return nil
}

// SealOperation records the project change sequence the operation left behind,
// which is what a later restore compares against.
func (s *Store) SealOperation(ctx context.Context, db DB, opID string, seq int64) error {
	if _, err := db.Exec(ctx, `update operations set seq_after = $2 where id = $1`, opID, seq); err != nil {
		return fmt.Errorf("seal operation: %w", err)
	}
	return nil
}

func (s *Store) MarkOperationRestored(ctx context.Context, db DB, opID string, at time.Time) error {
	if _, err := db.Exec(ctx, `update operations set restored_at = $2 where id = $1`, opID, at); err != nil {
		return fmt.Errorf("mark operation restored: %w", err)
	}
	return nil
}

func (s *Store) CountPublished(ctx context.Context, projectID string) (int, error) {
	var n int
	if err := s.Pool.QueryRow(ctx, `select count(*) from publishes where project_id = $1 and state = 'published'`,
		projectID).Scan(&n); err != nil {
		return 0, fmt.Errorf("count publishes: %w", err)
	}
	return n, nil
}
