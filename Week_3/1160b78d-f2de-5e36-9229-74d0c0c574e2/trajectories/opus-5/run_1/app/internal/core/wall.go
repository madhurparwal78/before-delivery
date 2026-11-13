package core

import "time"

// wall is a local date and time with no zone attached.
type wall struct {
	year  int
	month time.Month
	day   int
	hour  int
	min   int
}

func wallOf(t time.Time, loc *time.Location) wall {
	l := t.In(loc)
	return wall{l.Year(), l.Month(), l.Day(), l.Hour(), l.Minute()}
}

func (w wall) addDays(n int) wall {
	t := time.Date(w.year, w.month, w.day, 0, 0, 0, 0, time.UTC).AddDate(0, 0, n)
	return wall{t.Year(), t.Month(), t.Day(), w.hour, w.min}
}

func (w wall) withTime(hour, min int) wall {
	return wall{w.year, w.month, w.day, hour, min}
}

func (w wall) dateOnly() wall { return wall{w.year, w.month, w.day, 0, 0} }

func (w wall) utc() time.Time {
	return time.Date(w.year, w.month, w.day, w.hour, w.min, 0, 0, time.UTC)
}

func daysBetween(a, b wall) int {
	return int(b.dateOnly().utc().Sub(a.dateOnly().utc()) / (24 * time.Hour))
}

// resolveWall turns a local date and time into the one instant it names. A
// local time that does not exist that day takes the first valid instant after
// the jump; a local time that happens twice takes its first occurrence.
func resolveWall(loc *time.Location, w wall) time.Time {
	intended := w.utc()
	_, offBefore := intended.Add(-24 * time.Hour).In(loc).Zone()
	_, offAfter := intended.Add(24 * time.Hour).In(loc).Zone()
	candidates := []time.Time{
		intended.Add(-time.Duration(offBefore) * time.Second),
		intended.Add(-time.Duration(offAfter) * time.Second),
	}
	var valid []time.Time
	for _, c := range candidates {
		if wallOf(c, loc) == w {
			valid = append(valid, c)
		}
	}
	switch len(valid) {
	case 1:
		return valid[0]
	case 2:
		if valid[0].Before(valid[1]) {
			return valid[0]
		}
		return valid[1]
	}
	// The local time is missing: find the instant the offset changes, which is
	// the first valid instant after the jump.
	lo, hi := candidates[1], candidates[0]
	if lo.After(hi) {
		lo, hi = hi, lo
	}
	for hi.Sub(lo) > time.Second {
		mid := lo.Add(hi.Sub(lo) / 2).Truncate(time.Second)
		if mid.Equal(lo) {
			break
		}
		_, off := mid.In(loc).Zone()
		if off == offBefore {
			lo = mid
		} else {
			hi = mid
		}
	}
	return hi
}

func parseHHMM(s string) (int, int, bool) {
	if len(s) != 5 || s[2] != ':' {
		return 0, 0, false
	}
	h := int(s[0]-'0')*10 + int(s[1]-'0')
	m := int(s[3]-'0')*10 + int(s[4]-'0')
	if s[0] < '0' || s[0] > '9' || s[1] < '0' || s[1] > '9' || s[3] < '0' || s[3] > '9' || s[4] < '0' || s[4] > '9' {
		return 0, 0, false
	}
	if h > 24 || m > 59 || (h == 24 && m != 0) {
		return 0, 0, false
	}
	return h, m, true
}

func parseDate(s string) (wall, bool) {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return wall{}, false
	}
	return wall{t.Year(), t.Month(), t.Day(), 0, 0}, true
}
