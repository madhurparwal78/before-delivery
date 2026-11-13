package main

import (
	"fmt"
	"sort"
	"time"
	_ "time/tzdata"
)

const (
	zoneNewYork  = "America/New_York"
	zoneLondon   = "Europe/London"
	zoneAuckland = "Pacific/Auckland"
)

// zoneOrder is the order of every clocks array: New York, London, Auckland.
var zoneOrder = []string{zoneNewYork, zoneLondon, zoneAuckland}

var zoneCity = map[string]string{zoneNewYork: "New York", zoneLondon: "London", zoneAuckland: "Auckland"}

var zoneLocations = func() map[string]*time.Location {
	out := map[string]*time.Location{}
	for _, z := range zoneOrder {
		l, err := time.LoadLocation(z)
		if err != nil {
			panic(err)
		}
		out[z] = l
	}
	return out
}()

func validZone(z string) bool { _, ok := zoneLocations[z]; return ok }

const (
	layoutDate     = "2006-01-02"
	layoutDateTime = "2006-01-02T15:04"
	layoutKey      = "20060102T1504"
)

// wall is a clock reading without a zone, held as a UTC-labelled time.
type wall = time.Time

func parseWall(s string) (wall, error) { return time.Parse(layoutDateTime, s) }

func parseDate(s string) (time.Time, error) { return time.Parse(layoutDate, s) }

func wallString(w wall) string { return w.Format(layoutDateTime) }

func wallOf(instant time.Time, l *time.Location) wall {
	in := instant.In(l)
	return time.Date(in.Year(), in.Month(), in.Day(), in.Hour(), in.Minute(), 0, 0, time.UTC)
}

func offsetSeconds(l *time.Location, instant time.Time) int {
	_, off := instant.In(l).Zone()
	return off
}

// resolveLocal turns a clock reading in a zone into an instant. It is the only place that
// decides a skipped local time (moves forward to the first valid minute, adjusted) and a
// repeated one (uses the first instant). A fixed offset in seconds replaces the zone's rules
// for events moved for a recorded zone rule.
func resolveLocal(l *time.Location, w wall, fixed *int) (instant time.Time, shown wall, adjusted bool) {
	if fixed != nil {
		return w.Add(-time.Duration(*fixed) * time.Second), w, false
	}
	var found []time.Time
	seen := map[int]bool{}
	for _, probe := range []time.Duration{-24 * time.Hour, 24 * time.Hour} {
		off := offsetSeconds(l, w.Add(probe))
		if seen[off] {
			continue
		}
		seen[off] = true
		candidate := w.Add(-time.Duration(off) * time.Second)
		if offsetSeconds(l, candidate) == off {
			found = append(found, candidate)
		}
	}
	if len(found) > 0 {
		sort.Slice(found, func(i, j int) bool { return found[i].Before(found[j]) })
		return found[0], w, false
	}
	after := offsetSeconds(l, w.Add(24*time.Hour))
	probe := w.Add(-time.Duration(after) * time.Second)
	for offsetSeconds(l, probe) != after {
		probe = probe.Add(time.Minute)
	}
	return probe, wallOf(probe, l), true
}

// latestRule is the recorded rule for a zone with the latest effective date on or before a date.
func latestRule(rules []ZoneRule, zone, date string) *ZoneRule {
	var chosen *ZoneRule
	for i := range rules {
		r := &rules[i]
		if r.Zone == zone && r.EffectiveDate <= date && (chosen == nil || r.EffectiveDate > chosen.EffectiveDate) {
			chosen = r
		}
	}
	return chosen
}

// fixedOffsetFor is the offset a recorded zone rule forces for an event moved for it.
func fixedOffsetFor(rules []ZoneRule, moved []string, zone string, date string) *int {
	chosen := latestRule(rules, zone, date)
	if chosen == nil {
		return nil
	}
	for _, id := range moved {
		if id == chosen.ID {
			off := offsetToSeconds(chosen.NewOffset)
			return &off
		}
	}
	return nil
}

func offsetToSeconds(s string) int {
	var sign, h, m int
	if s[0] == '-' {
		sign = -1
	} else {
		sign = 1
	}
	fmt.Sscanf(s[1:], "%d:%d", &h, &m)
	return sign * (h*3600 + m*60)
}

func longDate(d time.Time) string { return d.Format("Mon 2 Jan 2006") }

func dateOnly(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}
