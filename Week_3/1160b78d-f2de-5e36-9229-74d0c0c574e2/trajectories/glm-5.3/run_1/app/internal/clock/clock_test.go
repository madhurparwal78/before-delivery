package clock

import (
	"testing"
	"time"
)

// wallClock is a test double for the store's wall-clock read.
type wallClock struct{ fixed time.Time }

func (f *wallClock) RealNow() time.Time { return f.fixed }

func TestClockMovesForwardOnly(t *testing.T) {
	// The offset only ever grows, so Now only moves forward. The test double
	// keeps a fixed wall time so the offset is the only variable.
	c := &Clock{wall: &wallClock{time.Date(2027, 3, 14, 8, 0, 0, 0, time.UTC)}, offset: 10, frozen: false}
	base := c.Now()
	c.mu.Lock()
	c.offset += 10
	c.mu.Unlock()
	after := c.Now()
	if after.Sub(base) != 10*time.Second {
		t.Fatalf("clock did not advance by the offset: %v to %v", base, after)
	}
}

func TestFrozenClockHolds(t *testing.T) {
	c := &Clock{wall: &wallClock{time.Date(2027, 3, 14, 8, 0, 0, 0, time.UTC)}, frozen: true, frozenAt: time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC)}
	if got := c.Now(); !got.Equal(c.frozenAt) {
		t.Fatalf("frozen clock moved: %v", got)
	}
}
