package main

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Clock is the one server clock: real time plus an offset kept in Postgres. It only moves forward and can be held.
// This file is the only place domain code reads system time; every other file calls Clock.Now.
type Clock struct {
	db       *pgxpool.Pool
	mu       sync.RWMutex
	offset   time.Duration
	frozen   bool
	frozenAt time.Time
}

// ClockState is the published shape of the clock.
type ClockState struct {
	Now           string `json:"now"`
	Frozen        bool   `json:"frozen"`
	OffsetSeconds int64  `json:"offset_seconds"`
}

func newClock(db *pgxpool.Pool) *Clock { return &Clock{db: db} }

// load reads the persisted clock state at boot.
func (c *Clock) load(ctx context.Context) error {
	if _, err := c.db.Exec(ctx, `insert into clock_state (id) values (1) on conflict do nothing`); err != nil {
		return fmt.Errorf("create clock row: %w", err)
	}
	var offset int64
	var frozenAt *time.Time
	err := c.db.QueryRow(ctx, `select offset_ns, frozen, frozen_at from clock_state where id = 1`).Scan(&offset, &c.frozen, &frozenAt)
	if err != nil {
		return fmt.Errorf("read clock row: %w", err)
	}
	c.offset = time.Duration(offset)
	if frozenAt != nil {
		c.frozenAt = frozenAt.UTC()
	}
	return nil
}

// Now is the server time in whole seconds.
func (c *Clock) Now() time.Time {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.nowLocked()
}

func (c *Clock) nowLocked() time.Time {
	if c.frozen {
		return c.frozenAt
	}
	return time.Now().Add(c.offset).UTC().Truncate(time.Second)
}

// Real is system time, for the few waits the brief states in real seconds (broker confirms, retries, the late-event wait).
func (c *Clock) Real() time.Time { return time.Now().UTC() }

// State is the published clock.
func (c *Clock) State() ClockState {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return ClockState{Now: formatInstant(c.nowLocked()), Frozen: c.frozen, OffsetSeconds: int64(c.offset / time.Second)}
}

// Frozen reports whether the clock is held.
func (c *Clock) Frozen() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.frozen
}

// Hold freezes or releases the clock. A released clock runs on from the held value.
func (c *Clock) Hold(ctx context.Context, hold bool) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if hold == c.frozen {
		return nil
	}
	if hold {
		c.frozenAt = c.nowLocked()
		c.frozen = true
	} else {
		c.offset = c.frozenAt.Sub(time.Now().UTC())
		c.frozen = false
	}
	if err := c.persistLocked(ctx); err != nil {
		return fmt.Errorf("save clock: %w", err)
	}
	return nil
}

// Advance moves the clock forward by whole seconds.
func (c *Clock) Advance(ctx context.Context, seconds int64) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	delta := time.Duration(seconds) * time.Second
	if c.frozen {
		c.frozenAt = c.frozenAt.Add(delta)
	} else {
		c.offset += delta
	}
	if err := c.persistLocked(ctx); err != nil {
		return fmt.Errorf("save clock: %w", err)
	}
	return nil
}

// SetTo moves the clock to an instant. It reports false when the instant lies in the past.
func (c *Clock) SetTo(ctx context.Context, target time.Time) (bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.nowLocked()
	if target.Before(now) {
		return false, nil
	}
	if c.frozen {
		c.frozenAt = target
	} else {
		c.offset += target.Sub(now)
	}
	if err := c.persistLocked(ctx); err != nil {
		return true, fmt.Errorf("save clock: %w", err)
	}
	return true, nil
}

func (c *Clock) persistLocked(ctx context.Context) error {
	var frozenAt *time.Time
	if c.frozen {
		frozenAt = &c.frozenAt
	}
	_, err := c.db.Exec(ctx, `update clock_state set offset_ns = $1, frozen = $2, frozen_at = $3 where id = 1`,
		int64(c.offset), c.frozen, frozenAt)
	if err != nil {
		return fmt.Errorf("persist clock: %w", err)
	}
	return nil
}

// formatInstant renders an instant as UTC ISO 8601 to the second.
func formatInstant(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05Z") }

// optionalInstant renders an instant that may be absent.
func optionalInstant(t *time.Time) *string {
	if t == nil {
		return nil
	}
	text := formatInstant(*t)
	return &text
}

// parseInstant reads a UTC ISO 8601 instant.
func parseInstant(s string) (time.Time, error) {
	t, err := time.Parse("2006-01-02T15:04:05Z", s)
	if err != nil {
		return time.Time{}, fmt.Errorf("parse instant %q: %w", s, err)
	}
	return t.UTC(), nil
}
