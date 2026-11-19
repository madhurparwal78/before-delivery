package main

import (
	"sync"
	"time"
)

// wallClock is the calendar clock: real time, or real time shifted by the founder's override.
type wallClock struct {
	mu         sync.RWMutex
	offset     time.Duration
	overridden bool
}

func (c *wallClock) Now() time.Time {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return time.Now().Add(c.offset)
}

func (c *wallClock) Set(at time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.offset = at.Sub(time.Now())
	c.overridden = true
}

func (c *wallClock) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.offset = 0
	c.overridden = false
}

func (c *wallClock) Overridden() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.overridden
}

const instantLayout = "2006-01-02T15:04:05Z"

func formatInstant(t time.Time) string { return t.UTC().Format(instantLayout) }

func parseInstant(s string) (time.Time, error) { return time.Parse(time.RFC3339, s) }
