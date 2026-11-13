package main

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"log"
	"sort"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// migrationUnlockWait bounds the unlock that runs after a migration, whether or not the migration's context has ended.
const migrationUnlockWait = 5 * time.Second

//go:embed schema/*.sql
var schemaFiles embed.FS

// connectDatabase retries every five real seconds until Postgres answers.
func connectDatabase(ctx context.Context, url string) (*pgxpool.Pool, error) {
	for {
		pool, err := pgxpool.New(ctx, url)
		if err == nil {
			if err = pool.Ping(ctx); err == nil {
				return pool, nil
			}
			pool.Close()
		}
		log.Printf("postgres not reachable yet: %v", err)
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("connect postgres: %w", ctx.Err())
		case <-time.After(5 * time.Second):
		}
	}
}

// migrate applies every schema file in name order. All statements are idempotent, so it runs on every serve.
func migrate(ctx context.Context, pool *pgxpool.Pool) error {
	names, err := fs.Glob(schemaFiles, "schema/*.sql")
	if err != nil {
		return fmt.Errorf("list schema files: %w", err)
	}
	sort.Strings(names)
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire connection: %w", err)
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, `select pg_advisory_lock(7000)`); err != nil {
		return fmt.Errorf("lock migration: %w", err)
	}
	defer func() {
		unlockCtx, cancel := context.WithTimeout(context.Background(), migrationUnlockWait)
		defer cancel()
		if _, err := conn.Exec(unlockCtx, `select pg_advisory_unlock(7000)`); err != nil {
			log.Printf("unlock migration: %v", err)
		}
	}()
	for _, name := range names {
		sql, err := schemaFiles.ReadFile(name)
		if err != nil {
			return fmt.Errorf("read %s: %w", name, err)
		}
		if _, err := conn.Conn().PgConn().Exec(ctx, string(sql)).ReadAll(); err != nil {
			return fmt.Errorf("apply %s: %w", name, err)
		}
	}
	return nil
}
