package main

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// clockface.go — the zone and instant layer of the app.
//
// The three office zones are fixed, so the tz database entries below are the
// only places the real offset rules for them live. Nothing else in the app
// may compute an offset by hand.

// Zone carries the IANA name of a working zone.
type Zone struct {
	Name string
	City string
}

var (
	ZoneNewYork  = Zone{"America/New_York", "New York"}
	ZoneLondon   = Zone{"Europe/London", "London"}
	ZoneAuckland = Zone{"Pacific/Auckland", "Auckland"}
)

var zones = []Zone{ZoneNewYork, ZoneLondon, ZoneAuckland}

var zoneByName = map[string]Zone{
	ZoneNewYork.Name:  ZoneNewYork,
	ZoneLondon.Name:   ZoneLondon,
	ZoneAuckland.Name: ZoneAuckland,
}

func (z Zone) String() string { return z.Name }

func ZoneFor(name string) (Zone, bool) {
	z, ok := zoneByName[name]
	return z, ok
}

// LoadZone loads the IANA rules for a zone.
func LoadZone(name string) (*time.Location, error) {
	if _, ok := zoneByName[name]; !ok {
		return nil, fmt.Errorf("unknown zone %s", name)
	}
	return time.LoadLocation(name)
}

// OffsetAt gives the zone's rule offset, in minutes, at an instant.
func OffsetAt(zone string, t time.Time) int {
	loc, err := LoadZone(zone)
	if err != nil {
		return 0
	}
	_, off := t.In(loc).Zone()
	return off / 60
}

// InstantFromLocal resolves a local wall time in a zone with gap and fold
// handling. On a fold the first of the two instants is returned; in a gap the
// time moves forward to the first valid minute of that day.
func InstantFromLocal(zone, date string, minutes int) (time.Time, bool, bool) {
	loc, err := LoadZone(zone)
	if err != nil {
		return time.Time{}, false, false
	}
	stamp := date + " " + minutesToTime(minutes)
	cand, err := time.ParseInLocation("2006-01-02 15:04:05", stamp, loc)
	if err != nil {
		return time.Time{}, false, false
	}
	// Try the stamp again with each offset the zone offers within a day: the
	// same wall time may resolve twice (a fold) or to a different wall time
	// (a gap).
	naiveUTC := time.Unix(cand.Unix()-int64(func() int { _, o := cand.Zone(); return o }()), 0).UTC()
	type resolution struct {
		inst time.Time
		ok   bool
	}
	var first, second resolution
	for _, delta := range []int{-15 * 3600, -14 * 3600, -13 * 3600, -12 * 3600, -11 * 3600, -10 * 3600, -9 * 3600, -8 * 3600, -7 * 3600, -6 * 3600, -5 * 3600, -4 * 3600, -3 * 3600, -2 * 3600, -1 * 3600, 0, 1 * 3600, 2 * 3600, 3 * 3600, 4 * 3600, 5 * 3600, 6 * 3600, 7 * 3600, 8 * 3600, 9 * 3600, 10 * 3600, 11 * 3600, 12 * 3600, 13 * 3600, 14 * 3600} {
		guess := naiveUTC.Add(time.Duration(delta) * time.Second)
		localShown := guess.In(loc)
		if localShown.Format("2006-01-02 15:04") == stamp[:16] {
			if !first.ok {
				first = resolution{guess, true}
			} else if !second.ok {
				second = resolution{guess, true}
			}
		}
	}
	if first.ok && second.ok {
		return first.inst.UTC(), true, false
	}
	if first.ok {
		return first.inst.UTC(), false, false
	}
	// gap: the wall time does not exist; move forward to the first valid
	// minute of that day, which is the zone's next transition.
	return nextTransitionAfter(loc, cand.In(loc)), false, true
}

// nextTransitionAfter gives the instant of the zone's first transition
// strictly after t, as a UTC instant.
func nextTransitionAfter(loc *time.Location, t time.Time) time.Time {
	// Binary search on the zone's offset: the offset changes only at
	// transitions, and all three zones use whole-hour or half-hour jumps well
	// under a day apart.
	utc := t.UTC()
	lo := utc
	hi := utc.Add(24 * time.Hour)
	_, baseOff := utc.In(loc).Zone()
	if off := func() int { _, o := hi.In(loc).Zone(); return o }(); off == baseOff {
		return hi // no transition within a day; callers never hit this
	}
	for hi.Sub(lo) > 500*time.Millisecond {
		mid := lo.Add(hi.Sub(lo) / 2)
		if _, midOff := mid.In(loc).Zone(); midOff == baseOff {
			lo = mid
		} else {
			hi = mid
		}
	}
	return hi.UTC()
}

// LocalExists reports whether a local wall time exists in the zone on that
// date and is unambiguous.
func LocalExists(zone, date string, minutes int) bool {
	_, fold, gap := InstantFromLocal(zone, date, minutes)
	return !fold && !gap
}

// ForceLocal gives the instant of a local wall time ignoring the zone's
// daylight rules, using a recorded rule offset instead.
func ForceLocal(date string, minutes, offsetMinutes int) time.Time {
	base, _ := time.Parse("2006-01-02", date)
	y, m, d := base.Date()
	// compute the UTC date boundary and add offset
	utc := time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	return utc.Add(time.Duration(minutes-offsetMinutes) * time.Minute)
}

// OffsetForLocal gives the offset a zone's rules give a local wall time.
func OffsetForLocal(zone, date string, minutes int) int {
	// choose the offset that makes the instant
	loc, err := LoadZone(zone)
	if err != nil {
		return 0
	}
	t, err := time.ParseInLocation("2006-01-02 15:04", date+" "+minutesToTime(minutes)[:5], loc)
	if err != nil {
		return 0
	}
	_, off := t.In(loc).Zone()
	return off / 60
}

func minutesToTime(m int) string {
	m = ((m % 1440) + 1440) % 1440
	return fmt.Sprintf("%02d:%02d:00", m/60, m%60)
}

// MinutesFromMidnight gives the minutes of a wall clock time HH:MM.
func MinutesFromMidnight(s string) (int, bool) {
	parts := strings.Split(s, ":")
	if len(parts) != 2 {
		return 0, false
	}
	h, e1 := strconv.Atoi(parts[0])
	m, e2 := strconv.Atoi(parts[1])
	if e1 != nil || e2 != nil || h < 0 || h > 23 || m < 0 || m > 59 {
		return 0, false
	}
	return h*60 + m, true
}

// ResolveOffset reads a +HH:MM or -HH:MM offset string into minutes.
func ResolveOffset(s string) (int, error) {
	n, ok := ParseOffsetMinutes(s)
	if !ok {
		return 0, fmt.Errorf("Use +HH:MM or -HH:MM.")
	}
	return n, nil
}

// Datels util.
func ParseDate(s string) (time.Time, bool) {
	t, err := time.Parse("2006-01-02", strings.TrimSpace(s))
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}

func FormatDate(t time.Time) string {
	return t.Format("2006-01-02")
}

// LongDate renders Mon 8 Mar 2027.
func LongDate(t time.Time, zone string) string {
	loc, err := LoadZone(zone)
	if err == nil {
		t = t.In(loc)
	}
	return t.Format("Mon 2 Jan 2006")
}

// InZone renders t in a named zone.
func InZone(t time.Time, zone string) time.Time {
	loc, err := LoadZone(zone)
	if err == nil {
		return t.In(loc)
	}
	return t
}

func FirstDayOfMonth(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, t.Location())
}

func LastDayOfMonth(t time.Time) time.Time {
	return FirstDayOfMonth(t).AddDate(0, 1, -1)
}

// IsLeapYear reports whether y is a leap year.
func IsLeapYear(y int) bool {
	return y%4 == 0 && (y%100 != 0 || y%400 == 0)
}
