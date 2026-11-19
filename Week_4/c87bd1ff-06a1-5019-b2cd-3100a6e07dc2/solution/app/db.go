package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	_ "embed"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/lib/pq"
)

//go:embed schema.sql
var schemaSQL string

const notifyChannel = "gavelhouse"

// querier is what both *sql.DB and *sql.Tx offer.
type querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// pendingEvent is a change feed entry waiting for its sequence number.
type pendingEvent struct {
	kind     string
	lotID    string
	cause    string
	noticeID int64
	personID string
}

// Tx is a transaction that collects change feed events and writes them, with
// their sequence numbers, as the last statements before the commit. The
// counter row lock then orders sequence numbers exactly as commits happen.
type Tx struct {
	*sql.Tx
	pending []pendingEvent
}

// afterCommit lets a callback commit its work and still answer with an error.
type afterCommit struct{ err error }

func (e *afterCommit) Error() string { return e.err.Error() }

func (a *App) openDB() error {
	db, err := sql.Open("postgres", a.cfg.databaseURL)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	db.SetMaxOpenConns(40)
	db.SetMaxIdleConns(10)
	a.db = db
	return nil
}

func (a *App) migrate(ctx context.Context) error {
	conn, err := a.db.Conn(ctx)
	if err != nil {
		return fmt.Errorf("migration connection: %w", err)
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, `SELECT pg_advisory_lock(7301)`); err != nil {
		return fmt.Errorf("lock migration: %w", err)
	}
	defer conn.ExecContext(ctx, `SELECT pg_advisory_unlock(7301)`)
	if _, err := conn.ExecContext(ctx, schemaSQL); err != nil {
		return fmt.Errorf("apply schema: %w", err)
	}
	return nil
}

func (a *App) tx(ctx context.Context, fn func(*Tx) error) error {
	raw, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	t := &Tx{Tx: raw}
	if err := fn(t); err != nil {
		after, ok := err.(*afterCommit)
		if !ok {
			raw.Rollback()
			return err
		}
		if cerr := t.commit(ctx); cerr != nil {
			return cerr
		}
		return after.err
	}
	return t.commit(ctx)
}

func (t *Tx) commit(ctx context.Context) error {
	var last int64
	for i, e := range t.pending {
		if i > 0 && e == t.pending[i-1] {
			continue
		}
		var seq int64
		if err := t.QueryRowContext(ctx, `UPDATE counters SET n = n + 1 WHERE name = 'event' RETURNING n`).Scan(&seq); err != nil {
			t.Rollback()
			return fmt.Errorf("next event sequence: %w", err)
		}
		_, err := t.ExecContext(ctx, `INSERT INTO events (seq, kind, lot_id, cause, notice_id, person_id) VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, ''), NULLIF($5, 0), NULLIF($6, ''))`,
			seq, e.kind, e.lotID, e.cause, e.noticeID, e.personID)
		if err != nil {
			t.Rollback()
			return fmt.Errorf("write event: %w", err)
		}
		last = seq
	}
	if last > 0 {
		if _, err := t.ExecContext(ctx, `SELECT pg_notify($1, $2)`, notifyChannel, fmt.Sprint(last)); err != nil {
			t.Rollback()
			return fmt.Errorf("announce event: %w", err)
		}
	}
	if err := t.Tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}

func (t *Tx) lotChanged(lotID, cause string) {
	t.pending = append(t.pending, pendingEvent{kind: "lot", lotID: lotID, cause: cause})
}

// watchChanged records that one bidder started or stopped watching a lot; only that bidder's sockets get the frame.
func (t *Tx) watchChanged(lotID, personID string) {
	t.pending = append(t.pending, pendingEvent{kind: "lot", lotID: lotID, cause: "watch", personID: personID})
}

// snapshot runs fn in one read-only repeatable-read transaction.
func (a *App) snapshot(ctx context.Context, fn func(*sql.Tx) error) error {
	raw, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return fmt.Errorf("begin snapshot: %w", err)
	}
	defer raw.Rollback()
	return fn(raw)
}

// wrap adds what was being done to a non-nil error.
func wrap(what string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%s: %w", what, err)
}

// readErr wraps the error a finished row iteration reports, naming what was being read.
func readErr(rows *sql.Rows, what string) error {
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read %s: %w", what, err)
	}
	return nil
}

func dbNow(ctx context.Context, q querier) (time.Time, error) {
	var now time.Time
	if err := q.QueryRowContext(ctx, `SELECT clock_timestamp()`).Scan(&now); err != nil {
		return now, fmt.Errorf("read database time: %w", err)
	}
	return now, nil
}

func newID(prefix string) string {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		panic("random source failed: " + err.Error())
	}
	return prefix + hex.EncodeToString(b)
}

func nextCounter(ctx context.Context, t *Tx, name string) (int64, error) {
	var n int64
	if err := t.QueryRowContext(ctx, `UPDATE counters SET n = n + 1 WHERE name = $1 RETURNING n`, name).Scan(&n); err != nil {
		return 0, fmt.Errorf("next %s number: %w", name, err)
	}
	return n, nil
}

func isUniqueViolation(err error) bool {
	pe, ok := err.(*pq.Error)
	return ok && pe.Code == "23505"
}
