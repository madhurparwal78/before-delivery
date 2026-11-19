// Package clockx owns the server's wall clock and the studio-zone calendar rules.
//
// Match timers never come from here: they run on Go's monotonic reading, so an
// overridden wall clock leaves them untouched.
package clockx

import (
	"sync"
	"time"

	// The runtime image may lack system zone files, so carry IANA data along.
	_ "time/tzdata"
)

// DSTNote records why a scheduled wall time moved or was ambiguous.
type DSTNote string

const (
	NoteNone            DSTNote = ""
	NoteShiftedForward  DSTNote = "shifted_forward"
	NoteFirstOccurrence DSTNote = "first_occurrence"
)

// Clock is the server's wall clock, which clock control may move.
type Clock struct {
	mu         sync.RWMutex
	offset     time.Duration
	overridden bool
	zone       *time.Location
}

// New builds a clock reading the real time in the given studio zone.
func New(zone *time.Location) *Clock {
	return &Clock{zone: zone}
}

// Now reports the server's wall clock in UTC.
func (c *Clock) Now() time.Time {
	c.mu.RLock()
	off := c.offset
	c.mu.RUnlock()
	return time.Now().UTC().Add(off).Truncate(time.Millisecond)
}

// Set moves the wall clock to an instant and lets it keep running from there.
func (c *Clock) Set(at time.Time) {
	c.mu.Lock()
	c.offset = at.Sub(time.Now().UTC())
	c.overridden = true
	c.mu.Unlock()
}

// Clear returns the wall clock to real time.
func (c *Clock) Clear() {
	c.mu.Lock()
	c.offset = 0
	c.overridden = false
	c.mu.Unlock()
}

// Overridden reports whether clock control has moved the wall clock.
func (c *Clock) Overridden() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.overridden
}

// Zone reports the studio's business zone.
func (c *Clock) Zone() *time.Location { return c.zone }

// StudioNow reports the wall clock as studio-local time.
func (c *Clock) StudioNow() time.Time { return c.Now().In(c.zone) }

// LoadZone resolves an IANA zone name.
func LoadZone(name string) (*time.Location, error) { return time.LoadLocation(name) }

// ResolveLocal turns a studio wall time into an instant, applying the skipped and
// repeated hour rules. This is the only place those rules are decided.
//
// A wall time is read with the offsets in force on either side of any nearby
// daylight-saving transition. When both readings land on the requested wall time
// the hour is repeated, so the earlier instant wins. When neither does, the hour
// is skipped, so reading it with the pre-transition offset carries it forward by
// the length of the gap.
func ResolveLocal(zone *time.Location, year int, month time.Month, day, hour, minute, second int) (time.Time, time.Time, DSTNote) {
	naive := time.Date(year, month, day, hour, minute, second, 0, time.UTC)
	_, before := naive.Add(-probeWindow).In(zone).Zone()
	_, after := naive.Add(probeWindow).In(zone).Zone()

	withBefore := naive.Add(-time.Duration(before) * time.Second)
	if before == after {
		return withBefore, withBefore.In(zone), NoteNone
	}
	withAfter := naive.Add(-time.Duration(after) * time.Second)

	beforeFits := sameWallTime(withBefore.In(zone), year, month, day, hour, minute)
	afterFits := sameWallTime(withAfter.In(zone), year, month, day, hour, minute)

	switch {
	case beforeFits && afterFits:
		first := withBefore
		if withAfter.Before(first) {
			first = withAfter
		}
		return first, first.In(zone), NoteFirstOccurrence
	case beforeFits:
		return withBefore, withBefore.In(zone), NoteNone
	case afterFits:
		return withAfter, withAfter.In(zone), NoteNone
	default:
		return withBefore, withBefore.In(zone), NoteShiftedForward
	}
}

// probeWindow reaches past any transition adjacent to the requested wall time.
const probeWindow = 26 * time.Hour

func sameWallTime(t time.Time, year int, month time.Month, day, hour, minute int) bool {
	return t.Year() == year && t.Month() == month && t.Day() == day &&
		t.Hour() == hour && t.Minute() == minute
}

// Abbr reports the zone abbreviation in force at an instant, such as CST or +03.
func Abbr(at time.Time, zone *time.Location) string {
	return at.In(zone).Format("MST")
}

// Offset reports the UTC offset in force at an instant, such as -06:00.
func Offset(at time.Time, zone *time.Location) string {
	return at.In(zone).Format("-07:00")
}
