// Package clock keeps the one server clock: real time plus an offset, held in
// Postgres. Domain logic never reads system time directly; it asks this clock.
package clock

import (
	"context"
	"sync"
	"time"

	"switchlamp/internal/db"
)

// Clock serves the server's single instant. The wall is the real clock read;
// a test double can stand in for it.
type Clock struct {
	store    *db.Store
	wall     wallReader
	mu       sync.Mutex
	offset   int64 // seconds
	frozen   bool
	frozenAt time.Time
	lastRead time.Time
}

// wallReader reads the real wall clock.
type wallReader interface {
	RealNow() time.Time
}

// New builds the clock from the stored row.
func New(ctx context.Context, store *db.Store) (*Clock, error) {
	c := &Clock{store: store, wall: store}
	if err := c.reload(ctx); err != nil {
		return nil, err
	}
	return c, nil
}

func (c *Clock) reload(ctx context.Context) error {
	st, err := c.store.LoadClock(ctx)
	if err != nil {
		return err
	}
	c.mu.Lock()
	c.offset = st.OffsetSeconds
	c.frozen = st.Frozen
	if st.FrozenAt != nil {
		c.frozenAt = *st.FrozenAt
	} else {
		c.frozenAt = time.Time{}
	}
	c.lastRead = c.wall.RealNow()
	c.mu.Unlock()
	return nil
}

// Now returns the server clock, truncated to whole seconds.
func (c *Clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.frozen {
		return c.frozenAt
	}
	return c.wall.RealNow().Add(time.Duration(c.offset) * time.Second)
}

// State is the published operator-clock view.
type State struct {
	Now           time.Time `json:"now"`
	Frozen        bool      `json:"frozen"`
	OffsetSeconds int64     `json:"offset_seconds"`
}

// Snapshot returns the clock state for the API.
func (c *Clock) Snapshot() State {
	c.mu.Lock()
	defer c.mu.Unlock()
	return State{Now: c.NowLocked(), Frozen: c.frozen, OffsetSeconds: c.offset}
}

// NowLocked is Now for callers already holding the mutex.
func (c *Clock) NowLocked() time.Time {
	if c.frozen {
		return c.frozenAt
	}
	return c.wall.RealNow().Add(time.Duration(c.offset) * time.Second)
}

// Freeze holds the clock at its present value.
func (c *Clock) Freeze(ctx context.Context) error {
	c.mu.Lock()
	now := c.NowLocked()
	c.frozen = true
	c.frozenAt = now
	c.mu.Unlock()
	return c.store.SaveClock(ctx, c.offset, true, &now)
}

// Release lets the clock run on from its held value.
func (c *Clock) Release(ctx context.Context) error {
	c.mu.Lock()
	c.frozen = false
	c.mu.Unlock()
	return c.store.SaveClock(ctx, c.offset, false, nil)
}

// Move advances the clock by whole seconds, forward only. It returns the new
// instant. The caller applies due timers after this returns.
func (c *Clock) Move(ctx context.Context, seconds int64) (time.Time, error) {
	c.mu.Lock()
	c.offset += seconds
	c.frozen = false
	c.frozenAt = time.Time{}
	c.mu.Unlock()
	if err := c.store.SaveClock(ctx, c.offset, false, nil); err != nil {
		return time.Time{}, err
	}
	return c.Now(), nil
}
