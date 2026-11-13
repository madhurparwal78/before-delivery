package core

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Clock is the one server clock every product timer runs on: real time plus an
// offset kept in Postgres. It moves only forward, and stands still while held.
type Clock struct {
	pool *pgxpool.Pool
	mu   sync.RWMutex

	offset   time.Duration
	frozen   bool
	frozenAt time.Time
}

func newClock(pool *pgxpool.Pool) *Clock { return &Clock{pool: pool} }

func (c *Clock) load(ctx context.Context) error {
	var seconds int64
	var frozen bool
	var frozenAt *time.Time
	err := c.pool.QueryRow(ctx, `INSERT INTO clock_state (id, offset_seconds, frozen)
		VALUES (1, 0, false) ON CONFLICT (id) DO UPDATE SET id = 1
		RETURNING offset_seconds, frozen, frozen_at`).Scan(&seconds, &frozen, &frozenAt)
	if err != nil {
		return fmt.Errorf("load clock: %w", err)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.offset = time.Duration(seconds) * time.Second
	c.frozen = frozen
	if frozen && frozenAt != nil {
		c.frozenAt = frozenAt.UTC().Truncate(time.Second)
	}
	return nil
}

func (c *Clock) Now() time.Time {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.frozen {
		return c.frozenAt
	}
	return time.Now().UTC().Add(c.offset).Truncate(time.Second)
}

func (c *Clock) Frozen() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.frozen
}

func (c *Clock) OffsetSeconds() int64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return int64(c.offset / time.Second)
}

// Advance moves the clock forward by d.
func (c *Clock) Advance(ctx context.Context, d time.Duration) error {
	c.mu.Lock()
	if c.frozen {
		c.frozenAt = c.frozenAt.Add(d)
		c.offset += d
	} else {
		c.offset += d
	}
	c.mu.Unlock()
	return c.save(ctx)
}

// SetFrozen holds the clock at its present value, or releases it to run on from
// that value.
func (c *Clock) SetFrozen(ctx context.Context, frozen bool) error {
	c.mu.Lock()
	if frozen && !c.frozen {
		c.frozenAt = time.Now().UTC().Add(c.offset).Truncate(time.Second)
		c.frozen = true
	} else if !frozen && c.frozen {
		c.offset = c.frozenAt.Sub(time.Now().UTC().Truncate(time.Second))
		c.frozen = false
	}
	c.mu.Unlock()
	return c.save(ctx)
}

func (c *Clock) save(ctx context.Context) error {
	c.mu.RLock()
	seconds := int64(c.offset / time.Second)
	frozen := c.frozen
	frozenAt := c.frozenAt
	c.mu.RUnlock()
	var at *time.Time
	if frozen {
		at = &frozenAt
	}
	_, err := c.pool.Exec(ctx, `UPDATE clock_state SET offset_seconds=$1, frozen=$2, frozen_at=$3 WHERE id=1`,
		seconds, frozen, at)
	if err != nil {
		return fmt.Errorf("save clock: %w", err)
	}
	return nil
}
