package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Store wraps the Postgres pool and owns the schema.
type Store struct {
	Pool *pgxpool.Pool
}

// Connect waits for Postgres, retrying every 5 seconds until it is reachable.
func Connect(ctx context.Context, databaseURL string) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parsing DATABASE_URL: %w", err)
	}
	cfg.MaxConns = 40
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	for {
		pingCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
		err = pool.Ping(pingCtx)
		cancel()
		if err == nil {
			return &Store{Pool: pool}, nil
		}
		select {
		case <-ctx.Done():
			pool.Close()
			return nil, ctx.Err()
		case <-time.After(5 * time.Second):
		}
	}
}
