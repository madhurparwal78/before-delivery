// Package store keeps everything durable in Postgres: players and sessions,
// settings, the credit ledger, the price schedule, series, nights, sign-ups, the
// email outbox, match history and laps.
package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/hex"
	"errors"
	"net/url"
	"strings"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store is the Postgres gateway. It is usable before Postgres is reachable: each
// call fails with ErrDown until the service answers.
type Store struct {
	pool  *pgxpool.Pool
	zone  *time.Location
	up    atomic.Bool
	ready atomic.Bool
}

// ErrDown reports that Postgres is unreachable.
var ErrDown = errors.New("postgres unavailable")

const callTimeout = 3 * time.Second

// New opens a lazy pool. It does not wait for Postgres.
func New(dsn string, zone *time.Location) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(plainTCP(dsn))
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 8
	cfg.ConnConfig.ConnectTimeout = callTimeout
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		return nil, err
	}
	return &Store{pool: pool, zone: zone}, nil
}

// plainTCP keeps the connection on plain TCP, since the image ships no TLS
// libraries for Postgres to negotiate with.
func plainTCP(dsn string) string {
	u, err := url.Parse(dsn)
	if err != nil {
		return dsn
	}
	q := u.Query()
	if q.Get("sslmode") == "" {
		q.Set("sslmode", "disable")
		u.RawQuery = q.Encode()
	}
	return u.String()
}

// Close releases the pool.
func (s *Store) Close() { s.pool.Close() }

// Up reports the latest probe result.
func (s *Store) Up() bool { return s.up.Load() }

// Probe checks Postgres and applies the schema and seeds when it is reachable.
func (s *Store) Probe(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, callTimeout)
	defer cancel()
	if err := s.pool.Ping(ctx); err != nil {
		s.up.Store(false)
		s.ready.Store(false)
		return
	}
	if !s.ready.Load() {
		if err := s.migrate(ctx); err != nil {
			s.up.Store(false)
			return
		}
		s.ready.Store(true)
	}
	s.up.Store(true)
}

// acquire hands out a context for one call, or ErrDown when Postgres is away.
func (s *Store) call(ctx context.Context) (context.Context, context.CancelFunc, error) {
	if !s.up.Load() || !s.ready.Load() {
		return nil, nil, ErrDown
	}
	c, cancel := context.WithTimeout(ctx, callTimeout)
	return c, cancel, nil
}

// down marks the service down so the next probe repairs it, and reports ErrDown.
//
// A caller whose own context ended says nothing about Postgres, so a request the
// browser abandoned never takes the service down.
func (s *Store) down(ctx context.Context, err error) error {
	if err == nil {
		return nil
	}
	if ctx.Err() != nil {
		return err
	}
	if isConnectionError(err) {
		s.up.Store(false)
		return ErrDown
	}
	return err
}

func isConnectionError(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	msg := err.Error()
	for _, probe := range []string{
		"connection refused", "connect: ", "broken pipe", "EOF",
		"server closed the connection", "connection reset", "no such host",
		"failed to connect", "unexpected EOF", "i/o timeout",
	} {
		if strings.Contains(msg, probe) {
			return true
		}
	}
	return false
}

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// NewID makes an opaque id.
func NewID() string {
	buf := make([]byte, 10)
	if _, err := rand.Read(buf); err != nil {
		// crypto/rand failing is not a state the rules can recover from.
		panic(err)
	}
	return strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf))
}

// HashKey hashes the studio key, which is only ever stored hashed.
func HashKey(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}
