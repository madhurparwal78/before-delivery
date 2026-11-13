package main

import (
	"fmt"
	"strings"
	"time"
)

// rrule.go — the one place a repeat rule is parsed, validated and expanded.

// RepeatRule holds the parsed form of an rrule.
type RepeatRule struct {
	Freq     string // DAILY WEEKLY MONTHLY YEARLY
	Interval int
	Count    int
	Until    string // YYYYMMDD, inclusive
	ByDay    []string
	Monthly  *MonthlyByDay
}

// MonthlyByDay is a MONTHLY BYDAY such as 2TU or -1FR.
type MonthlyByDay struct {
	Ordinal int // 1..4 or -1
	Weekday time.Weekday
}

var weekdayCodes = map[string]time.Weekday{
	"MO": time.Monday, "TU": time.Tuesday, "WE": time.Wednesday,
	"TH": time.Thursday, "FR": time.Friday, "SA": time.Saturday, "SU": time.Sunday,
}

var weekdayName = map[time.Weekday]string{
	time.Monday: "MO", time.Tuesday: "TU", time.Wednesday: "WE",
	time.Thursday: "TH", time.Friday: "FR", time.Saturday: "SA", time.Sunday: "SU",
}

var errRuleForm = fmt.Errorf("Use a daily, weekly, monthly or yearly repeat with INTERVAL, BYDAY, COUNT or UNTIL.")

// ParseRRule accepts the published forms and rejects every other with a
// field error.
func ParseRRule(s string) (*RepeatRule, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, nil
	}
	parts := strings.Split(s, ";")
	seen := map[string]bool{}
	r := &RepeatRule{Interval: 1}
	for _, p := range parts {
		if p == "" {
			return nil, errRuleForm
		}
		kv := strings.SplitN(p, "=", 2)
		if len(kv) != 2 || kv[0] == "" || kv[1] == "" {
			return nil, errRuleForm
		}
		k, v := kv[0], kv[1]
		if seen[k] {
			return nil, errRuleForm
		}
		seen[k] = true
		switch k {
		case "FREQ":
			switch v {
			case "DAILY", "WEEKLY", "MONTHLY", "YEARLY":
				r.Freq = v
			default:
				return nil, errRuleForm
			}
		case "INTERVAL":
			n, ok := parsePlainInt(v)
			if !ok || n < 1 || n > 99 {
				return nil, errRuleForm
			}
			r.Interval = n
		case "COUNT":
			n, ok := parsePlainInt(v)
			if !ok || n < 1 || n > 999 {
				return nil, errRuleForm
			}
			r.Count = n
		case "UNTIL":
			if len(v) != 8 {
				return nil, errRuleForm
			}
			if _, err := time.Parse("20060102", v); err != nil {
				return nil, errRuleForm
			}
			r.Until = v
		case "BYDAY":
			vals := strings.Split(v, ",")
			switch r.Freq {
			case "WEEKLY":
				wdSeen := map[string]bool{}
				for _, d := range vals {
					if _, ok := weekdayCodes[d]; !ok || wdSeen[d] || len(d) != 2 {
						return nil, errRuleForm
					}
					wdSeen[d] = true
					r.ByDay = append(r.ByDay, d)
				}
			case "MONTHLY":
				if len(vals) != 1 {
					return nil, errRuleForm
				}
				mbd, err := parseMonthlyByDay(vals[0])
				if err != nil {
					return nil, err
				}
				r.Monthly = mbd
			default:
				return nil, errRuleForm
			}
		default:
			return nil, errRuleForm
		}
	}
	if r.Freq == "" {
		return nil, errRuleForm
	}
	if r.Count > 0 && r.Until != "" {
		return nil, errRuleForm
	}
	if r.Monthly != nil && r.Freq != "MONTHLY" {
		return nil, errRuleForm
	}
	return r, nil
}

func parsePlainInt(s string) (int, bool) {
	if s == "" || (len(s) > 1 && s[0] == '0') {
		return 0, false
	}
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0, false
		}
		n = n*10 + int(c-'0')
	}
	return n, true
}

func parseMonthlyByDay(s string) (*MonthlyByDay, error) {
	i := 0
	negative := false
	if i < len(s) && s[i] == '-' {
		negative = true
		i++
	}
	start := i
	for i < len(s) && s[i] >= '0' && s[i] <= '9' {
		i++
	}
	numPart := s[start:i]
	wd := s[i:]
	if numPart == "" || len(wd) != 2 {
		return nil, errRuleForm
	}
	w, ok := weekdayCodes[wd]
	if !ok {
		return nil, errRuleForm
	}
	n, ok := parsePlainInt(numPart)
	if !ok {
		return nil, errRuleForm
	}
	if negative {
		if n != 1 {
			return nil, errRuleForm
		}
		return &MonthlyByDay{Ordinal: -1, Weekday: w}, nil
	}
	if n < 1 || n > 4 {
		return nil, errRuleForm
	}
	return &MonthlyByDay{Ordinal: n, Weekday: w}, nil
}

// MatchesStartDate reports whether the rule itself admits the start date.
func (r *RepeatRule) MatchesStartDate(date string) bool {
	d, ok := ParseDate(date)
	if !ok {
		return false
	}
	switch r.Freq {
	case "WEEKLY":
		if len(r.ByDay) > 0 {
			found := false
			for _, b := range r.ByDay {
				if weekdayCodes[b] == d.Weekday() {
					found = true
				}
			}
			if !found {
				return false
			}
		}
	case "MONTHLY":
		if r.Monthly != nil {
			return MonthlyByDayMatches(d, r.Monthly)
		}
	}
	return true
}

// MonthlyByDayMatches reports whether d is the nth or last weekday of its month.
func MonthlyByDayMatches(d time.Time, m *MonthlyByDay) bool {
	if m.Ordinal == -1 {
		lastThis := LastDayOfMonth(d)
		for lastThis.Weekday() != m.Weekday {
			lastThis = lastThis.AddDate(0, 0, -1)
		}
		return lastThis.Day() == d.Day()
	}
	firstThis := FirstDayOfMonth(d)
	for firstThis.Weekday() != m.Weekday {
		firstThis = firstThis.AddDate(0, 0, 1)
	}
	nth := firstThis.AddDate(0, 0, (m.Ordinal-1)*7)
	return nth.Day() == d.Day() && nth.Month() == d.Month()
}

// UntilDate gives the inclusive UNTIL date, or the zero time.
func (r *RepeatRule) UntilDate() time.Time {
	if r.Until == "" {
		return time.Time{}
	}
	t, _ := time.Parse("2006-01-02", r.Until[0:4]+"-"+r.Until[4:6]+"-"+r.Until[6:8])
	return t
}

// horizonSafety caps any expansion so a rule with no end cannot run away.
const horizonSafety = 10000

// Expand generates the local start dates of a rule from its start date.
// Dates are capped by COUNT and UNTIL, by the exclusive horizon when it is
// non-zero, by maxCount when it is positive, and by a hard iteration guard.
// Skipped dates (months without the day) do not count toward COUNT.
func (r *RepeatRule) Expand(startDate string, maxCount int, horizon time.Time) []string {
	start, ok := ParseDate(startDate)
	if !ok || r == nil {
		return nil
	}
	if !r.MatchesStartDate(startDate) {
		return nil
	}
	until := r.UntilDate()
	var out []string
	generated := 0
	iterations := 0
	push := func(d time.Time) bool { // false stops expansion
		iterations++
		if iterations > horizonSafety {
			return false
		}
		generated++
		if r.Count > 0 && generated > r.Count {
			return false
		}
		if !until.IsZero() && d.After(until) {
			return false
		}
		if !horizon.IsZero() && !d.Before(horizon) {
			return false
		}
		if d.Before(start) {
			return true // not a real occurrence; does not count
		}
		out = append(out, FormatDate(d))
		if maxCount > 0 && len(out) >= maxCount {
			return false
		}
		return true
	}
	switch r.Freq {
	case "DAILY":
		for d := start; ; d = d.AddDate(0, 0, r.Interval) {
			if !push(d) {
				return out
			}
		}
	case "WEEKLY":
		if len(r.ByDay) == 0 {
			for d := start; ; d = d.AddDate(0, 0, r.Interval*7) {
				if !push(d) {
					return out
				}
			}
		}
		// weeks begin on Monday; within a week generate in weekday order
		ordered := append([]string(nil), r.ByDay...)
		for i := 1; i < len(ordered); i++ {
			for j := i; j > 0 && weekdayCodes[ordered[j-1]] > weekdayCodes[ordered[j]]; j-- {
				ordered[j-1], ordered[j] = ordered[j], ordered[j-1]
			}
		}
		weekStart := start.AddDate(0, 0, -((int(start.Weekday()) + 6) % 7))
		for ws := weekStart; ; ws = ws.AddDate(0, 0, r.Interval*7) {
			for _, b := range ordered {
				d := ws.AddDate(0, 0, (int(weekdayCodes[b])+6)%7)
				if d.Before(start) {
					continue
				}
				if !push(d) {
					return out
				}
			}
		}
	case "MONTHLY":
		if r.Monthly != nil {
			for m := 0; ; m += r.Interval {
				base := start.AddDate(0, m, 0)
				d, ok := nthWeekdayOfMonth(base, r.Monthly)
				if !ok {
					if iterations > horizonSafety {
						return out
					}
					iterations++
					continue
				}
				if !push(d) {
					return out
				}
			}
		}
		day := start.Day()
		for m := 0; ; m += r.Interval {
			first := FirstDayOfMonth(start.AddDate(0, m, 0))
			if day > LastDayOfMonth(first).Day() {
				if iterations > horizonSafety {
					return out
				}
				iterations++
				continue
			}
			d := first.AddDate(0, 0, day-1)
			if !push(d) {
				return out
			}
		}
	case "YEARLY":
		mon, day := start.Month(), start.Day()
		for y := 0; ; y += r.Interval {
			base := start.AddDate(y, 0, 0)
			if base.Year() > 9999 {
				return out
			}
			if mon == time.February && day == 29 && !IsLeapYear(base.Year()) {
				if iterations > horizonSafety {
					return out
				}
				iterations++
				continue
			}
			d := time.Date(base.Year(), mon, day, 0, 0, 0, 0, time.UTC)
			if !push(d) {
				return out
			}
		}
	}
	return out
}

// nthWeekdayOfMonth gives the date of the nth or last weekday of the month of
// base, or ok=false when there is none.
func nthWeekdayOfMonth(base time.Time, m *MonthlyByDay) (time.Time, bool) {
	first := FirstDayOfMonth(base)
	if m.Ordinal == -1 {
		d := LastDayOfMonth(base)
		for d.Weekday() != m.Weekday {
			d = d.AddDate(0, 0, -1)
		}
		return d, true
	}
	d := first
	for d.Weekday() != m.Weekday {
		d = d.AddDate(0, 0, 1)
		if d.Month() != first.Month() {
			return time.Time{}, false
		}
	}
	d = d.AddDate(0, 0, (m.Ordinal-1)*7)
	if d.Month() != first.Month() {
		return time.Time{}, false
	}
	return d, true
}

// NextAfter gives the next date on or after the given one, or the last date
// when none remain.
func (r *RepeatRule) NextAfter(startDate, afterDate string) (string, bool) {
	after, _ := ParseDate(afterDate)
	dates := r.Expand(startDate, 0, after.AddDate(1, 0, 0))
	for _, d := range dates {
		if d >= afterDate {
			return d, true
		}
	}
	if len(dates) > 0 {
		return dates[len(dates)-1], true
	}
	return "", false
}
