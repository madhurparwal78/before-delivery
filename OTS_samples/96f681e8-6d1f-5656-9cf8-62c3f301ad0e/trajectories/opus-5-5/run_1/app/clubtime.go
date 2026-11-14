package main

import (
	"fmt"
	"strings"
	"time"
)

const dateLayout = "2006-01-02"

// clubDate is a calendar date in club time, held as midnight UTC of that date.
type clubDate struct{ t time.Time }

func parseClubDate(s string) (clubDate, bool) {
	t, err := time.Parse(dateLayout, s)
	if err != nil || t.Format(dateLayout) != s {
		return clubDate{}, false
	}
	return clubDate{t}, true
}

func (d clubDate) String() string           { return d.t.Format(dateLayout) }
func (d clubDate) AddDays(n int) clubDate   { return clubDate{d.t.AddDate(0, 0, n)} }
func (d clubDate) Before(o clubDate) bool   { return d.t.Before(o.t) }
func (d clubDate) DaysUntil(o clubDate) int { return int(o.t.Sub(d.t).Hours() / 24) }
func (d clubDate) Equal(o clubDate) bool    { return d.t.Equal(o.t) }

// clubDateOf is the one place an instant is turned into the club's calendar date.
func (c *config) clubDateOf(t time.Time) clubDate {
	l := t.In(c.Location)
	return clubDate{time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, time.UTC)}
}

// wallTime resolves a club wall-clock time to an instant. A time inside a
// skipped DST hour does not exist; a repeated hour resolves to its earlier
// occurrence. minuteOfDay may be 1440 for the following midnight.
func (c *config) wallTime(d clubDate, minuteOfDay int) (time.Time, bool) {
	if minuteOfDay == 1440 {
		d, minuteOfDay = d.AddDays(1), 0
	}
	y, m, day := d.t.Date()
	h, mi := minuteOfDay/60, minuteOfDay%60
	t := time.Date(y, m, day, h, mi, 0, 0, c.Location)
	sameWall := func(x time.Time) bool {
		l := x.In(c.Location)
		return l.Year() == y && l.Month() == m && l.Day() == day && l.Hour() == h && l.Minute() == mi
	}
	if !sameWall(t) {
		return time.Time{}, false
	}
	_, offNow := t.Zone()
	_, offBefore := t.Add(-3 * time.Hour).Zone()
	if offBefore > offNow {
		if earlier := t.Add(-time.Duration(offBefore-offNow) * time.Second); sameWall(earlier) {
			t = earlier
		}
	}
	return t, true
}

// dayBounds is the instant the club date starts and the instant the next one starts.
func (c *config) dayBounds(d clubDate) (time.Time, time.Time) {
	from, _ := c.firstInstantOf(d)
	to, _ := c.firstInstantOf(d.AddDays(1))
	return from, to
}

func (c *config) firstInstantOf(d clubDate) (time.Time, bool) {
	for m := 0; m < 1440; m += 30 {
		if t, ok := c.wallTime(d, m); ok {
			return t, true
		}
	}
	return time.Time{}, false
}

func (c *config) openingBounds(d clubDate) (time.Time, time.Time) {
	open, _ := c.wallTime(d, c.OpenMinute)
	closeAt, _ := c.wallTime(d, c.CloseMinute)
	return open, closeAt
}

// openMinutes is the opening time of a club date counted in real minutes.
func (c *config) openMinutes(d clubDate) int {
	open, closeAt := c.openingBounds(d)
	return int(closeAt.Sub(open) / time.Minute)
}

func parseWallStart(s string) (clubDate, int, bool) {
	ds, hm, ok := strings.Cut(s, "T")
	if !ok {
		return clubDate{}, 0, false
	}
	d, ok := parseClubDate(ds)
	if !ok || len(hm) != 5 || hm[2] != ':' {
		return clubDate{}, 0, false
	}
	minute, err := parseClock(hm)
	if err != nil || minute >= 1440 {
		return clubDate{}, 0, false
	}
	return d, minute, true
}

// slotStart validates a requested slot and returns its start instant. The
// slot must start on the slot step counted from opening and end inside the
// opening hours of its club date.
func (c *config) slotStart(d clubDate, minuteOfDay, minutes int) (time.Time, bool) {
	if minuteOfDay < c.OpenMinute || (minuteOfDay-c.OpenMinute)%c.SlotStepMinutes != 0 {
		return time.Time{}, false
	}
	start, ok := c.wallTime(d, minuteOfDay)
	if !ok {
		return time.Time{}, false
	}
	_, closeAt := c.openingBounds(d)
	if start.Add(time.Duration(minutes) * time.Minute).After(closeAt) {
		return time.Time{}, false
	}
	return start, true
}

// gridStarts lists the half-hour cell starts inside opening hours of a club date.
func (c *config) gridStarts(d clubDate) []time.Time {
	var out []time.Time
	for m := c.OpenMinute; m+30 <= c.CloseMinute; m += 30 {
		if t, ok := c.wallTime(d, m); ok {
			out = append(out, t)
		}
	}
	return out
}

func (c *config) clubClock(t time.Time) string {
	return t.In(c.Location).Format("15:04")
}

func (c *config) clubOffsetTime(t time.Time) string {
	return t.In(c.Location).Format(time.RFC3339)
}

// slotLabel is how notices name a slot: "Court 3, 2027-03-26 18:00".
func (c *config) slotLabel(court int, start time.Time) string {
	return fmt.Sprintf("Court %d, %s %s", court, c.clubDateOf(start), c.clubClock(start))
}

func (c *config) clubDateTime(t time.Time) string {
	return fmt.Sprintf("%s %s", c.clubDateOf(t), c.clubClock(t))
}

func utcStamp(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}

// Club instants: each is decided here and nowhere else.
func (c *config) settleAt(start time.Time) time.Time {
	return start.Add(-time.Duration(c.ShareSettleSecs) * time.Second)
}

func (c *config) cutoffAt(start time.Time) time.Time {
	return start.Add(-time.Duration(c.MatchCutoffSecs) * time.Second)
}

func (c *config) freeCancelUntil(start time.Time) time.Time {
	return start.Add(-time.Duration(c.FreeCancelSecs) * time.Second)
}

func (c *config) noShowFrom(start time.Time) time.Time {
	return start.Add(time.Duration(c.NoShowGraceSecs) * time.Second)
}

// weeklyRepeat gives the start of week i of a lesson series at the same club wall time.
func (c *config) weeklyRepeat(d clubDate, minuteOfDay, week, minutes int) (time.Time, bool) {
	return c.slotStart(d.AddDays(7*week), minuteOfDay, minutes)
}
