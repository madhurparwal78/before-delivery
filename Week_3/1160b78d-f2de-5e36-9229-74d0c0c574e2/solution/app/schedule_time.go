package main

import (
	"fmt"
	"strconv"
	"time"
)

const minutesPerDay = 24 * 60

// localDay is a calendar date in some zone, held as midnight UTC of that date so day arithmetic is plain.
type localDay struct{ midnight time.Time }

func dayOf(t time.Time, loc *time.Location) localDay {
	year, month, day := t.In(loc).Date()
	return localDay{time.Date(year, month, day, 0, 0, 0, 0, time.UTC)}
}

func parseLocalDay(text string) (localDay, error) {
	parsed, err := time.Parse(time.DateOnly, text)
	if err != nil {
		return localDay{}, fmt.Errorf("parse date %q: %w", text, err)
	}
	return localDay{parsed}, nil
}

func (d localDay) plus(days int) localDay { return localDay{d.midnight.AddDate(0, 0, days)} }

// since is the whole days from other to d.
func (d localDay) since(other localDay) int {
	return int(d.midnight.Sub(other.midnight) / (24 * time.Hour))
}

func (d localDay) weekday() time.Weekday { return d.midnight.Weekday() }

func (d localDay) String() string { return d.midnight.Format(time.DateOnly) }

// at is the instant of a local clock time on this date, and the one place the daylight saving rule lives: a local time
// that does not exist takes the first valid instant after the jump (02:30 becomes 03:00), and a local time that
// happens twice takes its first occurrence. Minutes may reach 1440, the next midnight.
func (d localDay) at(loc *time.Location, minutes int) time.Time {
	wall := d.midnight.Add(time.Duration(minutes) * time.Minute)
	var earliest, latest time.Time
	for _, probe := range []time.Duration{-24 * time.Hour, 24 * time.Hour} {
		_, offset := wall.Add(probe).In(loc).Zone()
		candidate := wall.Add(-time.Duration(offset) * time.Second)
		if _, actual := candidate.In(loc).Zone(); actual == offset && (earliest.IsZero() || candidate.Before(earliest)) {
			earliest = candidate
		}
		if candidate.After(latest) {
			latest = candidate
		}
	}
	if !earliest.IsZero() {
		return earliest
	}
	jumped, _ := latest.In(loc).ZoneBounds()
	return jumped
}

var weekdayNames = [7]string{"sun", "mon", "tue", "wed", "thu", "fri", "sat"}

// clockMinutes reads HH:MM, or 24:00 when the end of a window allows it.
func clockMinutes(text string, allowMidnightEnd bool) (int, bool) {
	if allowMidnightEnd && text == "24:00" {
		return minutesPerDay, true
	}
	if !clockFormat.MatchString(text) {
		return 0, false
	}
	hours, _ := strconv.Atoi(text[:2])
	minutes, _ := strconv.Atoi(text[3:])
	return hours*60 + minutes, true
}
