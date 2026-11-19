package api

import (
	"strconv"
	"strings"
	"time"
)

// parseLocal parses YYYY-MM-DDTHH:MM[:SS] with no offset, in the studio zone,
// applying the skipped and repeated hour rules.
func parseLocal(s string, loc *time.Location) (time.Time, error) {
	s = strings.TrimSpace(s)
	var layouts = []string{"2006-01-02T15:04:05", "2006-01-02T15:04"}
	for _, l := range layouts {
		if t, err := time.ParseInLocation(l, s, loc); err == nil {
			utc, _ := studioExpand(t, loc)
			return utc, nil
		}
	}
	return time.Time{}, errBadLocal
}

type badLocalErr struct{}

func (badLocalErr) Error() string { return "bad local time" }

var errBadLocal = badLocalErr{}

// studioExpand resolves a parsed local wall time, applying the skipped and
// repeated hour rules.
func studioExpand(naive time.Time, loc *time.Location) (time.Time, int) {
	utc := naive.UTC()
	back := utc.In(loc)
	hour, min := naive.Hour(), naive.Minute()
	day, month, year := naive.Day(), int(naive.Month()), naive.Year()
	if back.Hour() != hour || back.Minute() != min || back.Day() != day {
		// Skipped hour: move forward by the gap.
		gap := back.Sub(time.Date(year, time.Month(month), day, hour, min, 0, 0, loc))
		return utc.Add(gap), 1
	}
	// Repeated hour: the instant an hour earlier resolves to the same wall
	// time, so this one is the second occurrence; use the first.
	earlier := naive.Add(-time.Hour).UTC()
	eb := earlier.In(loc)
	if eb.Hour() == hour && eb.Minute() == min && eb.Day() == day && int(eb.Month()) == month {
		return utc, 2
	}
	return utc, 0
}

// atoiSafe is a small strconv.Atoi wrapper for query parsing.
func atoiSafe(s string) (int, bool) {
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0, false
	}
	return n, true
}
