package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata" // the runtime image may lack system zone files
)

const (
	studioName = "Cinderlatch Games"
	studioZone = "America/Chicago"
)

// studioLoc is the studio's business zone; main refuses to start when its data is missing.
var studioLoc, studioLocErr = time.LoadLocation(studioZone)

const (
	noteShiftedForward  = "shifted_forward"
	noteFirstOccurrence = "first_occurrence"
)

var localWallPattern = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$`)

// resolveStudioWall is the one place that applies the skipped and repeated hour rule: a wall
// time inside the spring-forward gap moves forward by the gap, and a wall time that occurs
// twice uses its first occurrence. note says which rule fired.
func resolveStudioWall(year int, month time.Month, day, hour, minute, second int) (at time.Time, note string) {
	wall := time.Date(year, month, day, hour, minute, second, 0, time.UTC)
	_, before := wall.Add(-24 * time.Hour).In(studioLoc).Zone()
	_, after := wall.Add(24 * time.Hour).In(studioLoc).Zone()
	var valid []time.Time
	for _, offset := range []int{before, after} {
		candidate := wall.Add(-time.Duration(offset) * time.Second)
		if _, got := candidate.In(studioLoc).Zone(); got == offset {
			valid = append(valid, candidate)
		}
		if before == after {
			break
		}
	}
	switch len(valid) {
	case 0:
		return wall.Add(-time.Duration(before) * time.Second), noteShiftedForward
	case 1:
		return valid[0], ""
	default:
		if valid[1].Before(valid[0]) {
			return valid[1], noteFirstOccurrence
		}
		return valid[0], noteFirstOccurrence
	}
}

// parseStudioLocal reads YYYY-MM-DDTHH:MM or YYYY-MM-DDTHH:MM:SS as studio wall time.
func parseStudioLocal(s string) (at time.Time, normalized string, ok bool) {
	m := localWallPattern.FindStringSubmatch(s)
	if m == nil {
		return time.Time{}, "", false
	}
	var n [6]int
	for i := 1; i <= 6; i++ {
		if m[i] == "" {
			continue
		}
		v, err := strconv.Atoi(m[i])
		if err != nil {
			return time.Time{}, "", false
		}
		n[i-1] = v
	}
	check := time.Date(n[0], time.Month(n[1]), n[2], 0, 0, 0, 0, time.UTC)
	if check.Year() != n[0] || int(check.Month()) != n[1] || check.Day() != n[2] || n[3] > 23 || n[4] > 59 || n[5] > 59 {
		return time.Time{}, "", false
	}
	at, _ = resolveStudioWall(n[0], time.Month(n[1]), n[2], n[3], n[4], n[5])
	normalized = fmt.Sprintf("%04d-%02d-%02dT%02d:%02d", n[0], n[1], n[2], n[3], n[4])
	if n[5] != 0 {
		normalized += fmt.Sprintf(":%02d", n[5])
	}
	return at, normalized, true
}

// mailTime prints an instant as `Ddd D Mon YYYY, HH:MM <abbr> (<IANA zone>)`.
func mailTime(t time.Time, zone string, loc *time.Location) string {
	return t.In(loc).Format("Mon 2 Jan 2006, 15:04 MST") + " (" + zone + ")"
}

func dayLabel(t time.Time, loc *time.Location) string { return t.In(loc).Format("Mon 2 Jan 2006") }

func validZone(name string) (*time.Location, bool) {
	if strings.TrimSpace(name) == "" || name != strings.TrimSpace(name) || name == "Local" {
		return nil, false
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return nil, false
	}
	return loc, true
}
