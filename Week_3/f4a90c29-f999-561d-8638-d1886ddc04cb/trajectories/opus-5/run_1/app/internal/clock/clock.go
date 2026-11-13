// Package clock holds the one server clock every time rule reads.
package clock

import "time"

// Clock reports the server's own notion of now. With a rehearsal start it
// begins there at boot and runs forward at the configured rate.
type Clock struct {
	bootReal time.Time
	origin   time.Time
	rate     float64
}

func New(start time.Time, startSet bool, rate float64) *Clock {
	now := time.Now().UTC()
	origin := now
	if startSet {
		origin = start.UTC()
	}
	return &Clock{bootReal: now, origin: origin, rate: rate}
}

func (c *Clock) Now() time.Time {
	elapsed := time.Since(c.bootReal)
	return c.origin.Add(time.Duration(float64(elapsed) * c.rate)).UTC()
}

// Rate reports server seconds per real second.
func (c *Clock) Rate() float64 { return c.rate }

// RealDuration converts a span of server time into real time to wait.
func (c *Clock) RealDuration(d time.Duration) time.Duration {
	return time.Duration(float64(d) / c.rate)
}
