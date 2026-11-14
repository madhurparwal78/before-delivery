package main

import (
	"context"
	"crypto/rand"
	_ "embed"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schemaSQL string

// querier is what a pool and a transaction share.
type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

const schemaLockKey = 7420001

func openPool(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	cfg.MaxConns = 24
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("open pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("reach PostgreSQL: %w", err)
	}
	return pool, nil
}

// applySchema runs on every start; every statement is idempotent and harmless to existing data.
func applySchema(ctx context.Context, pool *pgxpool.Pool) error {
	return withTx(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", schemaLockKey); err != nil {
			return fmt.Errorf("lock schema: %w", err)
		}
		if _, err := tx.Exec(ctx, schemaSQL); err != nil {
			return fmt.Errorf("apply schema: %w", err)
		}
		return nil
	})
}

// withTx runs fn in one short transaction.
func withTx(ctx context.Context, pool *pgxpool.Pool, fn func(tx pgx.Tx) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	if err := fn(tx); err != nil {
		if rollback := tx.Rollback(ctx); rollback != nil && !errors.Is(rollback, pgx.ErrTxClosed) {
			return fmt.Errorf("%w (rollback: %v)", err, rollback)
		}
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}

// lockCourt serialises every claim on one court's time until the transaction ends.
func lockCourt(ctx context.Context, tx pgx.Tx, court int) error {
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext($1))", fmt.Sprintf("court:%d", court)); err != nil {
		return fmt.Errorf("lock court %d: %w", court, err)
	}
	return nil
}

func dbNow(ctx context.Context, q querier) (time.Time, error) {
	var now time.Time
	if err := q.QueryRow(ctx, "SELECT date_trunc('milliseconds', clock_timestamp())").Scan(&now); err != nil {
		return time.Time{}, fmt.Errorf("read database clock: %w", err)
	}
	return now, nil
}

func newID(prefix string) string { return prefix + strings.ToLower(rand.Text())[:16] }

// newToken makes an unguessable opaque token: 128 random bits.
func newToken() string { return rand.Text() }
