package main

import (
	"regexp"
	"strconv"
	"strings"
	"time"
)

const ruleCopy = "Use a daily, weekly, monthly or yearly repeat with INTERVAL, BYDAY, COUNT or UNTIL."

// RepeatRule is a parsed repeat rule of the published forms.
type RepeatRule struct {
	parts    []string
	Freq     string
	Interval int
	Count    int
	Until    time.Time
	ByDay    []time.Weekday
	Nth      int
	HasNth   bool
}

var (
	intervalPattern = regexp.MustCompile(`^[1-9][0-9]?$`)
	countPattern    = regexp.MustCompile(`^[1-9][0-9]{0,2}$`)
	untilPattern    = regexp.MustCompile(`^[0-9]{8}$`)
	nthDayPattern   = regexp.MustCompile(`^(-1|[1-4])(MO|TU|WE|TH|FR|SA|SU)$`)
)

var weekdayCodes = map[string]time.Weekday{
	"MO": time.Monday, "TU": time.Tuesday, "WE": time.Wednesday, "TH": time.Thursday,
	"FR": time.Friday, "SA": time.Saturday, "SU": time.Sunday,
}

func weekdayCode(w time.Weekday) string {
	for code, day := range weekdayCodes {
		if day == w {
			return code
		}
	}
	return ""
}

// parseRule validates raw against the published forms for a series starting on start (a date).
func parseRule(raw string, start time.Time) (*RepeatRule, bool) {
	r := &RepeatRule{Interval: 1, parts: strings.Split(raw, ";")}
	seen := map[string]bool{}
	var byDay string
	for _, part := range r.parts {
		name, value, ok := strings.Cut(part, "=")
		if !ok || value == "" || seen[name] {
			return nil, false
		}
		seen[name] = true
		switch name {
		case "FREQ":
			if value != "DAILY" && value != "WEEKLY" && value != "MONTHLY" && value != "YEARLY" {
				return nil, false
			}
			r.Freq = value
		case "INTERVAL":
			if !intervalPattern.MatchString(value) {
				return nil, false
			}
			r.Interval, _ = strconv.Atoi(value)
		case "COUNT":
			if !countPattern.MatchString(value) {
				return nil, false
			}
			r.Count, _ = strconv.Atoi(value)
		case "UNTIL":
			if !untilPattern.MatchString(value) {
				return nil, false
			}
			until, err := time.Parse("20060102", value)
			if err != nil || until.Before(start) {
				return nil, false
			}
			r.Until = until
		case "BYDAY":
			byDay = value
		default:
			return nil, false
		}
	}
	if r.Freq == "" || (r.Count > 0 && !r.Until.IsZero()) {
		return nil, false
	}
	if byDay != "" && !r.parseByDay(byDay, start) {
		return nil, false
	}
	if byDay == "" && r.Freq == "WEEKLY" {
		r.ByDay = []time.Weekday{start.Weekday()}
	}
	return r, true
}

func (r *RepeatRule) parseByDay(value string, start time.Time) bool {
	switch r.Freq {
	case "WEEKLY":
		seen := map[time.Weekday]bool{}
		for _, token := range strings.Split(value, ",") {
			day, ok := weekdayCodes[token]
			if !ok || seen[day] {
				return false
			}
			seen[day] = true
			r.ByDay = append(r.ByDay, day)
		}
		return seen[start.Weekday()]
	case "MONTHLY":
		m := nthDayPattern.FindStringSubmatch(value)
		if m == nil {
			return false
		}
		r.Nth, _ = strconv.Atoi(m[1])
		r.HasNth = true
		r.ByDay = []time.Weekday{weekdayCodes[m[2]]}
		return nthWeekday(start.Year(), start.Month(), r.Nth, r.ByDay[0]).Equal(start)
	}
	return false
}

func daysIn(year int, month time.Month) int {
	return time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

// nthWeekday is the nth (1 to 4) or last (-1) given weekday of a month.
func nthWeekday(year int, month time.Month, nth int, wd time.Weekday) time.Time {
	if nth > 0 {
		first := time.Date(year, month, 1, 0, 0, 0, 0, time.UTC)
		shift := (int(wd) - int(first.Weekday()) + 7) % 7
		return first.AddDate(0, 0, shift+7*(nth-1))
	}
	last := time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC)
	return last.AddDate(0, 0, -((int(last.Weekday()) - int(wd) + 7) % 7))
}

func mondayIndex(w time.Weekday) int { return (int(w) + 6) % 7 }

func (r *RepeatRule) period(start time.Time, n int) (begin time.Time, dates []time.Time) {
	switch r.Freq {
	case "DAILY":
		d := start.AddDate(0, 0, n*r.Interval)
		return d, []time.Time{d}
	case "WEEKLY":
		monday := start.AddDate(0, 0, -mondayIndex(start.Weekday())+7*r.Interval*n)
		days := append([]time.Weekday(nil), r.ByDay...)
		for i := range days {
			for j := i + 1; j < len(days); j++ {
				if mondayIndex(days[j]) < mondayIndex(days[i]) {
					days[i], days[j] = days[j], days[i]
				}
			}
		}
		for _, wd := range days {
			if d := monday.AddDate(0, 0, mondayIndex(wd)); !d.Before(start) {
				dates = append(dates, d)
			}
		}
		return monday, dates
	case "MONTHLY":
		index := start.Year()*12 + int(start.Month()) - 1 + n*r.Interval
		year, month := index/12, time.Month(index%12+1)
		first := time.Date(year, month, 1, 0, 0, 0, 0, time.UTC)
		if r.HasNth {
			return first, []time.Time{nthWeekday(year, month, r.Nth, r.ByDay[0])}
		}
		if start.Day() <= daysIn(year, month) {
			return first, []time.Time{time.Date(year, month, start.Day(), 0, 0, 0, 0, time.UTC)}
		}
		return first, nil
	}
	year := start.Year() + n*r.Interval
	jan := time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC)
	if start.Month() == time.February && start.Day() == 29 && daysIn(year, time.February) != 29 {
		return jan, nil
	}
	return jan, []time.Time{time.Date(year, start.Month(), start.Day(), 0, 0, 0, 0, time.UTC)}
}

// dates lists the rule's nominal dates inside [from, to], counting skipped dates out of COUNT.
func (r *RepeatRule) dates(start, from, to time.Time) []time.Time {
	var out []time.Time
	first := 0
	if r.Count == 0 && from.After(start) {
		span := from.Sub(start).Hours() / 24
		switch r.Freq {
		case "DAILY":
			first = int(span) / r.Interval
		case "WEEKLY":
			first = int(span/7) / r.Interval
		case "MONTHLY":
			first = int(span/31) / r.Interval
		default:
			first = int(span/366) / r.Interval
		}
		if first > 0 {
			first--
		}
	}
	produced := 0
	for n := first; n < 100000; n++ {
		begin, dates := r.period(start, n)
		if begin.After(to) {
			break
		}
		for _, d := range dates {
			if r.Count > 0 && produced >= r.Count {
				return out
			}
			if !r.Until.IsZero() && d.After(r.Until) {
				return out
			}
			produced++
			if !d.Before(from) && !d.After(to) {
				out = append(out, d)
			}
		}
		if r.Count > 0 && produced >= r.Count {
			break
		}
	}
	return out
}

// CountBefore is the number of nominal occurrences strictly before date.
func (r *RepeatRule) CountBefore(start, date time.Time) int {
	if !date.After(start) {
		return 0
	}
	return len(r.dates(start, start, date.AddDate(0, 0, -1)))
}

// With returns the rule text with COUNT or UNTIL replaced; zero count and empty until mean neither.
func (r *RepeatRule) With(count int, until string) string {
	kept := make([]string, 0, len(r.parts)+1)
	for _, p := range r.parts {
		if !strings.HasPrefix(p, "COUNT=") && !strings.HasPrefix(p, "UNTIL=") {
			kept = append(kept, p)
		}
	}
	if count > 0 {
		kept = append(kept, "COUNT="+strconv.Itoa(count))
	}
	if until != "" {
		kept = append(kept, "UNTIL="+until)
	}
	return strings.Join(kept, ";")
}

// Shifted returns the rule text moved by whole days so a series starting on the new date still matches it.
func (r *RepeatRule) Shifted(newStart time.Time) string {
	kept := make([]string, 0, len(r.parts))
	for _, p := range r.parts {
		switch {
		case strings.HasPrefix(p, "BYDAY=") && r.Freq == "WEEKLY":
			kept = append(kept, "BYDAY="+r.shiftedWeekdays(newStart))
		case strings.HasPrefix(p, "BYDAY=") && r.Freq == "MONTHLY":
			nth := (newStart.Day()-1)/7 + 1
			if newStart.Day()+7 > daysIn(newStart.Year(), newStart.Month()) {
				kept = append(kept, "BYDAY=-1"+weekdayCode(newStart.Weekday()))
			} else {
				kept = append(kept, "BYDAY="+strconv.Itoa(nth)+weekdayCode(newStart.Weekday()))
			}
		default:
			kept = append(kept, p)
		}
	}
	return strings.Join(kept, ";")
}

func (r *RepeatRule) shiftedWeekdays(newStart time.Time) string {
	var codes []string
	oldFirst := r.ByDay[0]
	delta := (int(newStart.Weekday()) - int(oldFirst) + 7) % 7
	for _, wd := range r.ByDay {
		codes = append(codes, weekdayCode(time.Weekday((int(wd)+delta)%7)))
	}
	return strings.Join(codes, ",")
}
