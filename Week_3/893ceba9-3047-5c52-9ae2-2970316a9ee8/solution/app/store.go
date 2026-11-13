package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, role text NOT NULL,
  password_hash text NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES users ON DELETE CASCADE, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY, seq bigserial, slug text NOT NULL UNIQUE, name text NOT NULL, client text NOT NULL,
  source_language text NOT NULL, target_languages text[] NOT NULL, repository text NOT NULL,
  mqm_threshold int NOT NULL, ai_routes jsonb NOT NULL, main_rev bigint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS reviewer_scopes (
  user_id text NOT NULL REFERENCES users ON DELETE CASCADE, project_id text NOT NULL REFERENCES projects ON DELETE CASCADE,
  PRIMARY KEY (user_id, project_id));
CREATE TABLE IF NOT EXISTS branches (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects ON DELETE CASCADE, seq bigserial,
  name text NOT NULL, state text NOT NULL, is_main boolean NOT NULL, created_at timestamptz NOT NULL,
  UNIQUE (project_id, name));
CREATE TABLE IF NOT EXISTS keys (id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS branch_keys (
  branch_id text NOT NULL REFERENCES branches ON DELETE CASCADE, key_id text NOT NULL REFERENCES keys ON DELETE CASCADE,
  name text NOT NULL, source text NOT NULL, deleted boolean NOT NULL DEFAULT false, PRIMARY KEY (branch_id, key_id));
CREATE UNIQUE INDEX IF NOT EXISTS branch_keys_live_name ON branch_keys (branch_id, name) WHERE NOT deleted;
CREATE TABLE IF NOT EXISTS base_keys (
  branch_id text NOT NULL REFERENCES branches ON DELETE CASCADE, key_id text NOT NULL,
  name text NOT NULL, source text NOT NULL, PRIMARY KEY (branch_id, key_id));
CREATE TABLE IF NOT EXISTS base_values (
  branch_id text NOT NULL REFERENCES branches ON DELETE CASCADE, key_id text NOT NULL, language text NOT NULL,
  value text, PRIMARY KEY (branch_id, key_id, language));
CREATE TABLE IF NOT EXISTS segments (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects ON DELETE CASCADE,
  branch_id text NOT NULL REFERENCES branches ON DELETE CASCADE, key_id text NOT NULL, language text NOT NULL,
  value text, status text NOT NULL, score int, origin text,
  issues jsonb NOT NULL DEFAULT '[]', comments jsonb NOT NULL DEFAULT '[]', history jsonb NOT NULL DEFAULT '[]',
  UNIQUE (branch_id, key_id, language));
CREATE TABLE IF NOT EXISTS key_revisions (
  id bigserial PRIMARY KEY, project_id text NOT NULL REFERENCES projects ON DELETE CASCADE, key_id text NOT NULL,
  at timestamptz NOT NULL, branch text NOT NULL, field text NOT NULL, from_value text, to_value text, actor text NOT NULL);
CREATE INDEX IF NOT EXISTS key_revisions_key ON key_revisions (key_id);
CREATE TABLE IF NOT EXISTS tm_entries (
  id text PRIMARY KEY, seq bigserial, project_id text NOT NULL REFERENCES projects ON DELETE CASCADE,
  source text NOT NULL, norm_source text NOT NULL, target_language text NOT NULL, target text NOT NULL,
  norm_target text NOT NULL, import_id text, created_at timestamptz NOT NULL,
  UNIQUE (project_id, target_language, norm_source, norm_target));
CREATE TABLE IF NOT EXISTS imports (
  id text PRIMARY KEY, seq bigserial, project_id text NOT NULL REFERENCES projects ON DELETE CASCADE,
  filename text NOT NULL, format text NOT NULL, size bigint NOT NULL, sha256 text NOT NULL, object_key text NOT NULL,
  at timestamptz NOT NULL, added int NOT NULL, duplicates int NOT NULL, applied int NOT NULL, rows jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS operations (
  id text PRIMARY KEY, seq bigserial, project_id text NOT NULL REFERENCES projects ON DELETE CASCADE,
  kind text NOT NULL, label text NOT NULL, at timestamptz NOT NULL, restored_at timestamptz,
  rev_after bigint NOT NULL, snapshot_key text NOT NULL, branch_id text, import_id text);
CREATE TABLE IF NOT EXISTS source_files (
  id text PRIMARY KEY, seq bigserial, project_id text NOT NULL REFERENCES projects ON DELETE CASCADE,
  branch text NOT NULL, filename text NOT NULL, content_type text NOT NULL, size bigint NOT NULL,
  sha256 text NOT NULL, object_key text NOT NULL, at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS resolutions (
  branch_id text NOT NULL REFERENCES branches ON DELETE CASCADE, conflict_id text NOT NULL, choice text NOT NULL,
  value text, by text NOT NULL, at timestamptz NOT NULL, main_seen text, PRIMARY KEY (branch_id, conflict_id));
CREATE TABLE IF NOT EXISTS holds (
  branch_id text NOT NULL REFERENCES branches ON DELETE CASCADE, conflict_id text NOT NULL,
  session_id text NOT NULL, held_until timestamptz NOT NULL, PRIMARY KEY (branch_id, conflict_id));
CREATE TABLE IF NOT EXISTS assignments (
  id text PRIMARY KEY, seq bigserial, project_id text NOT NULL REFERENCES projects ON DELETE CASCADE,
  reviewer_id text NOT NULL REFERENCES users ON DELETE CASCADE, branch_id text NOT NULL REFERENCES branches ON DELETE CASCADE,
  language text NOT NULL, state text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS assignment_segments (
  assignment_id text NOT NULL REFERENCES assignments ON DELETE CASCADE, segment_id text NOT NULL,
  PRIMARY KEY (assignment_id, segment_id));
CREATE TABLE IF NOT EXISTS tokens (
  id text PRIMARY KEY, seq bigserial, project_id text NOT NULL REFERENCES projects ON DELETE CASCADE,
  label text NOT NULL, token_hash text NOT NULL UNIQUE, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS webhooks (
  project_id text PRIMARY KEY REFERENCES projects ON DELETE CASCADE, url text NOT NULL,
  svix_endpoint_id text NOT NULL, signing_secret text NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  id text PRIMARY KEY, seq bigserial, project_id text NOT NULL REFERENCES projects ON DELETE CASCADE,
  event_id text NOT NULL UNIQUE, type text NOT NULL, payload jsonb NOT NULL, state text NOT NULL,
  attempts int NOT NULL DEFAULT 0, created_at timestamptz NOT NULL, sent_at timestamptz, instance text NOT NULL);
CREATE TABLE IF NOT EXISTS publishes (
  id text PRIMARY KEY, seq bigserial, project_id text NOT NULL REFERENCES projects ON DELETE CASCADE,
  branch text NOT NULL, state text NOT NULL, failure_reason text, languages text[] NOT NULL,
  pr_number int, pr_url text, bundles jsonb NOT NULL, created_at timestamptz NOT NULL, confirmed_at timestamptz);
CREATE UNIQUE INDEX IF NOT EXISTS publishes_one_running ON publishes (project_id)
  WHERE state IN ('queued', 'awaiting_host_confirmation');
CREATE TABLE IF NOT EXISTS idempotency (
  project_id text NOT NULL REFERENCES projects ON DELETE CASCADE, key text NOT NULL, body_hash text NOT NULL,
  status int NOT NULL, response jsonb NOT NULL, PRIMARY KEY (project_id, key));
CREATE TABLE IF NOT EXISTS audit (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL, actor text NOT NULL, action text NOT NULL,
  project text NOT NULL DEFAULT '', project_id text, detail text NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS audit_at ON audit (at);
CREATE TABLE IF NOT EXISTS cleanups (
  id bigserial PRIMARY KEY, kind text NOT NULL, ref text NOT NULL, instance text NOT NULL);
`

const schemaLockKey = 7243108

func (a *App) connect(ctx context.Context) error {
	cfg, err := pgxpool.ParseConfig(a.cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	cfg.ConnConfig.ConnectTimeout = 5 * time.Second
	cfg.MaxConns = 20
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return fmt.Errorf("open pool: %w", err)
	}
	a.pool = pool
	return nil
}

// migrate applies the schema and the first-boot seed under one advisory lock, so any number of
// instances starting together converge on exactly one seed.
func (a *App) migrate(ctx context.Context) error {
	return a.inTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", schemaLockKey); err != nil {
			return fmt.Errorf("take schema lock: %w", err)
		}
		if _, err := tx.Exec(ctx, schema); err != nil {
			return fmt.Errorf("apply schema: %w", err)
		}
		var users int
		if err := tx.QueryRow(ctx, "SELECT count(*) FROM users").Scan(&users); err != nil {
			return fmt.Errorf("count users: %w", err)
		}
		if users > 0 {
			return nil
		}
		return a.seed(ctx, tx)
	})
}

func (a *App) inTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	tx, err := a.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer func() {
		rollback, cancel := detached(ctx)
		defer cancel()
		if err := tx.Rollback(rollback); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
			log.Printf("rollback: %v", err)
		}
	}()
	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	a.kick()
	return nil
}

// inProject runs fn in a transaction holding the project's row lock: every change to a project is
// serialised there, which is what makes "exactly one wins" true for holds, assignments, publishes and merges.
func (a *App) inProject(ctx context.Context, projectID string, fn func(tx pgx.Tx) error) error {
	return a.inTx(ctx, func(tx pgx.Tx) error {
		var locked string
		if err := tx.QueryRow(ctx, "SELECT id FROM projects WHERE id = $1 FOR UPDATE", projectID).Scan(&locked); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return errNotFound()
			}
			return fmt.Errorf("lock project: %w", err)
		}
		return fn(tx)
	})
}

// db is what both a pool and a transaction offer, so read helpers work in either.
type db interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}
