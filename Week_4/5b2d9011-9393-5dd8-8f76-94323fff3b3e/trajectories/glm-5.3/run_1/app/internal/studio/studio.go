// Package studio decides every calendar question in the studio's business
// zone: the wall-time expansion of weekly series, the skipped and repeated
// hour rules, and night windows.
package studio

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Night windows, from the brief.
const (
	SignupsLeadHours = 168
	SignupsCloseLead = 2 * time.Hour
	NightDuration    = 3 * time.Hour
	ReminderLead     = 60 * time.Minute
)

// Zone is the studio's business zone.
type Zone struct {
	Name string
	Loc  *time.Location
}

// Rule is the published skipped and repeated hour rule result.
type Rule int

const (
	Normal Rule = iota
	ShiftedForward
	FirstOccurrence
)

// Note is the night's dst_note value for a rule.
func (r Rule) Note() any {
	switch r {
	case ShiftedForward:
		return "shifted_forward"
	case FirstOccurrence:
		return "first_occurrence"
	default:
		return nil
	}
}

// Expand resolves a local wall time on a date in the zone, applying the
// skipped and repeated hour rules.
//
// A wall time that does not exist on that date (the spring-forward gap) moves
// forward by the length of the gap. A wall time that occurs twice uses the
// first occurrence.
func (z Zone) Expand(date string, hhmm string) (time.Time, Rule, error) {
	y, m, d, err := parseDate(date)
	if err != nil {
		return time.Time{}, Normal, err
	}
	hour, min, err := parseHHMM(hhmm)
	if err != nil {
		return time.Time{}, Normal, err
	}
	utc, rule := ExpandInZone(y, m, d, hour, min, z.Loc)
	return utc, rule, nil
}

// ExpandInZone resolves a parsed local wall time in any zone.
func ExpandInZone(y, m, d, hour, min int, loc *time.Location) (time.Time, Rule) {
	naive := time.Date(y, time.Month(m), d, hour, min, 0, 0, loc)
	utc := naive.UTC()
	back := utc.In(loc)
	if back.Hour() != hour || back.Minute() != min || back.Day() != d {
		// Skipped hour. The gap is the offset change across the transition:
		// the normalised instant sits before the gap and an instant at local
		// noon sits after it.
		_, beforeOff := back.Zone()
		noon := time.Date(y, time.Month(m), d, 12, 0, 0, 0, loc)
		_, afterOff := noon.Zone()
		gap := time.Duration(afterOff-beforeOff) * time.Second
		if gap < 0 {
			gap = -gap
		}
		return utc.Add(gap), ShiftedForward
	}
	// Repeated hour: the instant exactly one hour later resolves to the same
	// wall time, which means this instant is the first occurrence.
	later := naive.Add(time.Hour).UTC()
	lb := later.In(loc)
	if lb.Hour() == hour && lb.Minute() == min && lb.Day() == d && lb.Month() == time.Month(m) {
		return utc, FirstOccurrence
	}
	return utc, Normal
}

func parseDate(s string) (int, int, int, error) {
	parts := strings.Split(s, "-")
	if len(parts) != 3 || len(parts[0]) != 4 || len(parts[1]) != 2 || len(parts[2]) != 2 {
		return 0, 0, 0, fmt.Errorf("bad date %q", s)
	}
	y, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1])
	d, err3 := strconv.Atoi(parts[2])
	if err1 != nil || err2 != nil || err3 != nil {
		return 0, 0, 0, fmt.Errorf("bad date %q", s)
	}
	if y < 1 || m < 1 || m > 12 || d < 1 || d > 31 {
		return 0, 0, 0, fmt.Errorf("bad date %q", s)
	}
	return y, m, d, nil
}

func parseHHMM(s string) (int, int, error) {
	if len(s) < 4 || len(s) > 5 {
		return 0, 0, fmt.Errorf("bad time %q", s)
	}
	var hh, mm string
	if len(s) == 4 {
		hh, mm = s[:2], s[2:]
	} else {
		if s[2] != ':' {
			return 0, 0, fmt.Errorf("bad time %q", s)
		}
		hh, mm = s[:2], s[3:]
	}
	h, err1 := strconv.Atoi(hh)
	m, err2 := strconv.Atoi(mm)
	if err1 != nil || err2 != nil || h < 0 || h > 23 || m < 0 || m > 59 {
		return 0, 0, fmt.Errorf("bad time %q", s)
	}
	return h, m, nil
}
