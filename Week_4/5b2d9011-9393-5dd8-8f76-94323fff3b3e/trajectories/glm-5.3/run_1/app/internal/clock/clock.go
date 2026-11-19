// Package clock is the single time authority. Whether something is open, due,
// expired, running or finished comes only from here. It keeps a wall clock that
// can be overridden for calendar tests and a monotonic clock for match timers.
package clock

import (
	"sync"
	"time"
)

// Clock serves the wall clock (calendar rules) and the monotonic clock (match
// timers). With clock control on, the wall clock moves only the wall clock.
type Clock struct {
	mu        sync.Mutex
	origin    time.Time // wall instant mapped at monoRef
	monoRef   time.Time // monotonic reference
	overridden bool
	base      time.Time // the overridden wall instant mapped at monoRef
}

// New returns a clock whose wall time starts at now.
func New() *Clock {
	now := time.Now()
	return &Clock{origin: now, monoRef: now}
}

// Now returns the current wall instant.
func (c *Clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.nowLocked()
}

func (c *Clock) nowLocked() time.Time {
	base := c.origin
	if c.overridden {
		base = c.base
	}
	return base.Add(time.Since(c.monoRef))
}

// Mono returns monotonic elapsed time since the process started, in
// milliseconds. It is unaffected by wall-clock overrides.
func (c *Clock) Mono() int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return int64(time.Since(c.monoRef) / time.Millisecond)
}

// Set moves the wall clock to the given instant and keeps running from there.
// Match timers are unaffected.
func (c *Clock) Set(t time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.monoRef = time.Now()
	c.base = t
	c.overridden = true
}

// Clear returns the wall clock to the real clock.
func (c *Clock) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.overridden = false
	c.origin = time.Now()
	c.monoRef = time.Now()
}

// Overridden reports whether the wall clock is overridden.
func (c *Clock) Overridden() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.overridden
}

// Instant formats t as an RFC 3339 UTC instant to the second.
func Instant(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05Z")
}
