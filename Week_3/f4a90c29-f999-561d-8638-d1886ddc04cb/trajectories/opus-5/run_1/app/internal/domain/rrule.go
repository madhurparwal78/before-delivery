package domain

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

// RRuleError is the one field sentence a rejected repeat rule shows.
const RRuleError = "Use a daily, weekly, monthly or yearly repeat with INTERVAL, BYDAY, COUNT or UNTIL."

type Freq string

const (
	Daily   Freq = "DAILY"
	Weekly  Freq = "WEEKLY"
	Monthly Freq = "MONTHLY"
	Yearly  Freq = "YEARLY"
)

// RRule is a parsed repeat rule. Text keeps what was sent, which is returned
// unchanged.
type RRule struct {
	Text     string
	Freq     Freq
	Interval int
	Count    int
	Until    Wall
	HasUntil bool
	ByDay    []time.Weekday // weekly
	Nth      int            // monthly: 1..4, or -1 for the last
	NthDay   time.Weekday
	HasNth   bool
}

var weekdayCodes = map[string]time.Weekday{
	"MO": time.Monday, "TU": time.Tuesday, "WE": time.Wednesday,
	"TH": time.Thursday, "FR": time.Friday, "SA": time.Saturday, "SU": time.Sunday,
}

func weekdayCode(d time.Weekday) string {
	for code, w := range weekdayCodes {
		if w == d {
			return code
		}
	}
	return ""
}

// ParseRRule reads a published repeat rule and checks it against the start
// date, rejecting every other form.
func ParseRRule(text string, start Wall) (*RRule, error) {
	if text == "" {
		return nil, nil
	}
	r := &RRule{Text: text, Interval: 1}
	seen := map[string]bool{}
	var byDayRaw string
	for _, part := range strings.Split(text, ";") {
		name, value, ok := strings.Cut(part, "=")
		if !ok || name == "" || value == "" || seen[name] {
			return nil, fmt.Errorf("%s", RRuleError)
		}
		seen[name] = true
		switch name {
		case "FREQ":
			switch Freq(value) {
			case Daily, Weekly, Monthly, Yearly:
				r.Freq = Freq(value)
			default:
				return nil, fmt.Errorf("%s", RRuleError)
			}
		case "INTERVAL":
			n, err := wholeNumber(value, 1, 99)
			if err != nil {
				return nil, err
			}
			r.Interval = n
		case "COUNT":
			n, err := wholeNumber(value, 1, 999)
			if err != nil {
				return nil, err
			}
			r.Count = n
		case "UNTIL":
			t, err := time.Parse("20060102", value)
			if err != nil || len(value) != 8 {
				return nil, fmt.Errorf("%s", RRuleError)
			}
			r.Until = wallOf(t)
			r.HasUntil = true
		case "BYDAY":
			byDayRaw = value
		default:
			return nil, fmt.Errorf("%s", RRuleError)
		}
	}
	if r.Freq == "" {
		return nil, fmt.Errorf("%s", RRuleError)
	}
	if r.Count > 0 && r.HasUntil {
		return nil, fmt.Errorf("%s", RRuleError)
	}
	if r.HasUntil && r.Until.Before(Wall{start.Y, start.M, start.D, 0, 0}) {
		return nil, fmt.Errorf("%s", RRuleError)
	}
	if byDayRaw != "" {
		if err := r.parseByDay(byDayRaw); err != nil {
			return nil, err
		}
	}
	if r.Freq == Weekly && len(r.ByDay) == 0 {
		r.ByDay = []time.Weekday{start.Weekday()}
	}
	if err := r.checkStart(start); err != nil {
		return nil, err
	}
	return r, nil
}

func (r *RRule) parseByDay(value string) error {
	switch r.Freq {
	case Weekly:
		seen := map[time.Weekday]bool{}
		for _, code := range strings.Split(value, ",") {
			day, ok := weekdayCodes[code]
			if !ok || seen[day] {
				return fmt.Errorf("%s", RRuleError)
			}
			seen[day] = true
			r.ByDay = append(r.ByDay, day)
		}
		sort.Slice(r.ByDay, func(i, j int) bool { return r.ByDay[i] < r.ByDay[j] })
		return nil
	case Monthly:
		if len(value) < 3 {
			return fmt.Errorf("%s", RRuleError)
		}
		prefix, code := value[:len(value)-2], value[len(value)-2:]
		day, ok := weekdayCodes[code]
		if !ok {
			return fmt.Errorf("%s", RRuleError)
		}
		n, err := strconv.Atoi(prefix)
		if err != nil || (n < 1 || n > 4) && n != -1 {
			return fmt.Errorf("%s", RRuleError)
		}
		r.Nth, r.NthDay, r.HasNth = n, day, true
		return nil
	default:
		return fmt.Errorf("%s", RRuleError)
	}
}

// checkStart holds the start date to the rule it carries.
func (r *RRule) checkStart(start Wall) error {
	switch r.Freq {
	case Weekly:
		for _, d := range r.ByDay {
			if d == start.Weekday() {
				return nil
			}
		}
		return fmt.Errorf("%s", RRuleError)
	case Monthly:
		if r.HasNth {
			if start.Weekday() != r.NthDay {
				return fmt.Errorf("%s", RRuleError)
			}
			if nthOfMonth(start) != r.Nth && !(r.Nth == -1 && isLastOfMonth(start)) {
				return fmt.Errorf("%s", RRuleError)
			}
		}
	}
	return nil
}

func wholeNumber(value string, lo, hi int) (int, error) {
	if value == "" || (len(value) > 1 && value[0] == '0') {
		return 0, fmt.Errorf("%s", RRuleError)
	}
	n, err := strconv.Atoi(value)
	if err != nil || n < lo || n > hi {
		return 0, fmt.Errorf("%s", RRuleError)
	}
	return n, nil
}

// nthOfMonth reports which same-weekday of its month a date is, 1 to 5.
func nthOfMonth(w Wall) int { return (w.D-1)/7 + 1 }

func isLastOfMonth(w Wall) bool { return w.AddDays(7).M != w.M }

// MonthlyChoices lists the Monthly by options a start date offers.
func MonthlyChoices(start Wall) (nth int, nthLabel string, showNth bool, showLast bool) {
	nth = nthOfMonth(start)
	ordinals := []string{"", "first", "second", "third", "fourth"}
	showNth = nth <= 4
	if showNth {
		nthLabel = ordinals[nth]
	}
	showLast = isLastOfMonth(start)
	return
}

// Occurs lists a series' local starts from its start date, in order, stopping
// at the rule's own end, at the window end it is given, or at a count of them.
// Skipped dates never count toward COUNT.
func (r *RRule) Occurs(start Wall, windowEnd *Wall, limit int) []Wall {
	if r == nil {
		return []Wall{start}
	}
	var out []Wall
	done := false
	// take collects one generated date and reports whether to carry on.
	take := func(w Wall) bool {
		if r.HasUntil && (Wall{w.Y, w.M, w.D, 0, 0}).After(r.Until) {
			done = true
			return false
		}
		if windowEnd != nil && w.After(*windowEnd) {
			done = true
			return false
		}
		out = append(out, w)
		if r.Count > 0 && len(out) >= r.Count {
			done = true
		}
		if limit > 0 && len(out) >= limit {
			done = true
		}
		return !done
	}
	for i := 0; !done && i <= generationGuard; i++ {
		switch r.Freq {
		case Daily:
			take(start.AddDays(i * r.Interval))
		case Weekly:
			base := startOfWeek(start).AddDays(i * 7 * r.Interval)
			for offset := 0; offset < 7 && !done; offset++ {
				day := base.AddDays(offset)
				if day.Date() < start.Date() || !matchesDay(r.ByDay, day.Weekday()) {
					continue
				}
				take(day)
			}
		case Monthly:
			y, m := addMonths(start.Y, start.M, i*r.Interval)
			day := start.D
			if r.HasNth {
				day = nthWeekday(y, m, r.NthDay, r.Nth)
			} else if daysInMonth(y, m) < start.D {
				day = 0
			}
			if day != 0 {
				take(Wall{y, m, day, start.H, start.Min})
			}
		case Yearly:
			y := start.Y + i*r.Interval
			if daysInMonth(y, start.M) >= start.D {
				take(Wall{y, start.M, start.D, start.H, start.Min})
			}
		}
	}
	return out
}

// generationGuard stops an endless rule once it has looked far past any window.
const generationGuard = 4000

func matchesDay(days []time.Weekday, d time.Weekday) bool {
	for _, x := range days {
		if x == d {
			return true
		}
	}
	return false
}

// startOfWeek gives the Monday of a date's week, as repeat weeks begin Monday.
func startOfWeek(w Wall) Wall {
	shift := (int(w.Weekday()) + 6) % 7
	return w.AddDays(-shift)
}

func addMonths(y, m, n int) (int, int) {
	total := y*12 + (m - 1) + n
	return total / 12, total%12 + 1
}

func daysInMonth(y, m int) int {
	return time.Date(y, time.Month(m)+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

// nthWeekday gives the day of month of the nth, or last, weekday of a month.
func nthWeekday(y, m int, day time.Weekday, nth int) int {
	if nth == -1 {
		last := daysInMonth(y, m)
		for d := last; d > 0; d-- {
			if time.Date(y, time.Month(m), d, 0, 0, 0, 0, time.UTC).Weekday() == day {
				return d
			}
		}
		return 0
	}
	first := time.Date(y, time.Month(m), 1, 0, 0, 0, 0, time.UTC).Weekday()
	offset := (int(day) - int(first) + 7) % 7
	d := 1 + offset + (nth-1)*7
	if d > daysInMonth(y, m) {
		return 0
	}
	return d
}

// WeeklyByDayText writes a weekly BYDAY list the way it is stored.
func WeeklyByDayText(days []time.Weekday) string {
	order := []time.Weekday{time.Monday, time.Tuesday, time.Wednesday, time.Thursday, time.Friday, time.Saturday, time.Sunday}
	var codes []string
	for _, d := range order {
		if matchesDay(days, d) {
			codes = append(codes, weekdayCode(d))
		}
	}
	return strings.Join(codes, ",")
}
