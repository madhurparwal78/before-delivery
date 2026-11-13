package main

import "time"

// Clock is the one server clock. Every time rule, default date and timer reads it.
type Clock struct {
	origin time.Time
	boot   time.Time
	rate   float64
}

func newClock(cfg Config) *Clock {
	boot := time.Now()
	origin := cfg.ClockStart
	if origin.IsZero() {
		origin = boot.UTC()
	}
	return &Clock{origin: origin, boot: boot, rate: cfg.ClockRate}
}

// Now is the current server instant in UTC, truncated to the second.
func (c *Clock) Now() time.Time {
	elapsed := time.Since(c.boot)
	return c.origin.Add(time.Duration(float64(elapsed) * c.rate)).UTC().Truncate(time.Second)
}
