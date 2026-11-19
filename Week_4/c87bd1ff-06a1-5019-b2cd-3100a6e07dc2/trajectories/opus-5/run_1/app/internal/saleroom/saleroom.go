// Package saleroom holds the saleroom's system of record: the PostgreSQL
// schema, the seed data and every transition the brief's state machines allow.
package saleroom

import (
	"context"
	"crypto/rand"
	"embed"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"gavelhouse/internal/config"
)

//go:embed schema.sql
var schemaFS embed.FS

// changeChannel carries the sequence number of each committed change to every
// app process serving the same database.
const changeChannel = "gavelhouse_changes"

// Saleroom owns the database pool and every rule that touches it.
type Saleroom struct {
	pool *pgxpool.Pool
	cfg  *config.Config
	// Changes receives the sequence number of each committed change.
	Changes chan int64
}

// Open waits for PostgreSQL, applies the schema and the seed, and starts
// listening for changes from every app process.
func Open(ctx context.Context, cfg *config.Config) (*Saleroom, error) {
	pool, err := waitForDatabase(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, err
	}
	s := &Saleroom{pool: pool, cfg: cfg, Changes: make(chan int64, 256)}

	schema, err := schemaFS.ReadFile("schema.sql")
	if err != nil {
		return nil, fmt.Errorf("read schema: %w", err)
	}
	if _, err := pool.Exec(ctx, string(schema)); err != nil {
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	if err := s.applySeed(ctx); err != nil {
		return nil, fmt.Errorf("apply seed data: %w", err)
	}
	go s.listenForChanges(ctx)
	return s, nil
}

// Config exposes the settings the HTTP layer shares with the saleroom.
func (s *Saleroom) Config() *config.Config { return s.cfg }

// Close releases the pool.
func (s *Saleroom) Close() { s.pool.Close() }

func waitForDatabase(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	cfg.MaxConns = 16
	for {
		pool, err := pgxpool.NewWithConfig(ctx, cfg)
		if err == nil {
			pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
			err = pool.Ping(pingCtx)
			cancel()
			if err == nil {
				return pool, nil
			}
			pool.Close()
		}
		log.Printf("saleroom: waiting for PostgreSQL: %v", err)
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("waiting for PostgreSQL: %w", ctx.Err())
		case <-time.After(time.Second):
		}
	}
}

func (s *Saleroom) listenForChanges(ctx context.Context) {
	for ctx.Err() == nil {
		if err := s.listenOnce(ctx); err != nil && ctx.Err() == nil {
			log.Printf("saleroom: change feed listener: %v", err)
			time.Sleep(time.Second)
		}
	}
}

func (s *Saleroom) listenOnce(ctx context.Context) error {
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire listener connection: %w", err)
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, "LISTEN "+changeChannel); err != nil {
		return fmt.Errorf("listen on change channel: %w", err)
	}
	for {
		n, err := conn.Conn().WaitForNotification(ctx)
		if err != nil {
			return fmt.Errorf("wait for change notification: %w", err)
		}
		var seq int64
		if _, err := fmt.Sscan(n.Payload, &seq); err != nil {
			continue
		}
		select {
		case s.Changes <- seq:
		default:
		}
	}
}

// inTx runs fn in a single transaction and commits it, so that every change
// and its change-feed event land together.
func (s *Saleroom) inTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}
	return nil
}

func now(ctx context.Context, tx pgx.Tx) (time.Time, error) {
	var t time.Time
	if err := tx.QueryRow(ctx, "SELECT now()").Scan(&t); err != nil {
		return time.Time{}, fmt.Errorf("read database server time: %w", err)
	}
	return t, nil
}

// newID mints an opaque identifier.
func newID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(fmt.Sprintf("read random bytes: %v", err))
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// newToken mints an unguessable token of at least 128 random bits.
func newToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(fmt.Sprintf("read random bytes: %v", err))
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// ErrNotFound marks an unknown id, or one belonging to another person.
var ErrNotFound = errors.New("not found")

// Conflict is a refused state transition. Code is the API error code.
type Conflict struct {
	Code    string
	Message string
	// Lot carries the lot projection the bids endpoint adds to some conflicts.
	Lot any
}

func (c *Conflict) Error() string { return c.Code + ": " + c.Message }

func conflict(code, message string) error { return &Conflict{Code: code, Message: message} }

// Invalid is a validation failure carrying one sentence per failing field.
type Invalid struct {
	Fields map[string]string
}

func (i *Invalid) Error() string { return "invalid" }

func invalidField(field, sentence string) error {
	return &Invalid{Fields: map[string]string{field: sentence}}
}

func nextCounter(ctx context.Context, tx pgx.Tx, name string) (int64, error) {
	var v int64
	err := tx.QueryRow(ctx,
		`UPDATE counters SET value = value + 1 WHERE name = $1 RETURNING value`, name).Scan(&v)
	if err != nil {
		return 0, fmt.Errorf("take next %s number: %w", name, err)
	}
	return v, nil
}
