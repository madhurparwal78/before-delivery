package domain

import (
	"fmt"
	"strings"
	"time"
	_ "time/tzdata" // the published zones travel with the binary
)

// The three published zones and their cities.
const (
	ZoneNewYork  = "America/New_York"
	ZoneLondon   = "Europe/London"
	ZoneAuckland = "Pacific/Auckland"
)

var zoneCities = []struct {
	Zone string
	City string
}{
	{ZoneNewYork, "New York"},
	{ZoneLondon, "London"},
	{ZoneAuckland, "Auckland"},
}

// CityOrder lists the cities in the published New York, London, Auckland order.
func CityOrder() []string {
	out := make([]string, 0, len(zoneCities))
	for _, zc := range zoneCities {
		out = append(out, zc.City)
	}
	return out
}

func ZoneCity(zone string) string {
	for _, zc := range zoneCities {
		if zc.Zone == zone {
			return zc.City
		}
	}
	return ""
}

func ValidZone(zone string) bool { return ZoneCity(zone) != "" }

var locations = map[string]*time.Location{}

func Location(zone string) *time.Location {
	if loc, ok := locations[zone]; ok {
		return loc
	}
	loc, err := time.LoadLocation(zone)
	if err != nil {
		panic("unknown zone " + zone)
	}
	locations[zone] = loc
	return loc
}

// Wall is a local clock reading with no zone of its own.
type Wall struct {
	Y, M, D, H, Min int
}

const (
	wallLayout  = "2006-01-02T15:04"
	dateLayout  = "2006-01-02"
	keyLayout   = "20060102T1504"
	ClockLayout = "15:04"
)

func ParseWall(s string) (Wall, error) {
	t, err := time.Parse(wallLayout, s)
	if err != nil {
		return Wall{}, fmt.Errorf("want YYYY-MM-DDTHH:MM")
	}
	return wallOf(t), nil
}

func ParseDate(s string) (Wall, error) {
	t, err := time.Parse(dateLayout, s)
	if err != nil {
		return Wall{}, fmt.Errorf("want YYYY-MM-DD")
	}
	return wallOf(t), nil
}

// ParseLocal reads a stored or submitted local value, as a date for an
// all-day event and a date and time otherwise.
func ParseLocal(s string, allDay bool) (Wall, error) {
	if allDay {
		return ParseDate(s)
	}
	return ParseWall(s)
}

func wallOf(t time.Time) Wall {
	return Wall{t.Year(), int(t.Month()), t.Day(), t.Hour(), t.Minute()}
}

func WallFrom(t time.Time) Wall { return wallOf(t) }

func (w Wall) String() string {
	return fmt.Sprintf("%04d-%02d-%02dT%02d:%02d", w.Y, w.M, w.D, w.H, w.Min)
}

func (w Wall) Date() string { return fmt.Sprintf("%04d-%02d-%02d", w.Y, w.M, w.D) }

func (w Wall) Clock() string { return fmt.Sprintf("%02d:%02d", w.H, w.Min) }

func (w Wall) Key() string {
	return fmt.Sprintf("%04d%02d%02dT%02d%02d", w.Y, w.M, w.D, w.H, w.Min)
}

func (w Wall) Local(allDay bool) string {
	if allDay {
		return w.Date()
	}
	return w.String()
}

// AsUTC reads the wall clock as though it were UTC, for ordering and arithmetic.
func (w Wall) AsUTC() time.Time {
	return time.Date(w.Y, time.Month(w.M), w.D, w.H, w.Min, 0, 0, time.UTC)
}

func WallFromUTC(t time.Time) Wall { return wallOf(t.UTC()) }

func (w Wall) AddMinutes(n int) Wall {
	return WallFromUTC(w.AsUTC().Add(time.Duration(n) * time.Minute))
}

func (w Wall) AddDays(n int) Wall { return WallFromUTC(w.AsUTC().AddDate(0, 0, n)) }

func (w Wall) Before(o Wall) bool { return w.AsUTC().Before(o.AsUTC()) }

func (w Wall) After(o Wall) bool { return w.AsUTC().After(o.AsUTC()) }

func (w Wall) Weekday() time.Weekday { return w.AsUTC().Weekday() }

func (w Wall) MinutesUntil(o Wall) int {
	return int(o.AsUTC().Sub(w.AsUTC()) / time.Minute)
}

// ParseOffset reads +HH:MM or -HH:MM as whole minutes east of UTC.
func ParseOffset(s string) (int, error) {
	if len(s) != 6 || (s[0] != '+' && s[0] != '-') || s[3] != ':' {
		return 0, fmt.Errorf("want +HH:MM or -HH:MM")
	}
	var h, m int
	if _, err := fmt.Sscanf(s[1:], "%02d:%02d", &h, &m); err != nil {
		return 0, fmt.Errorf("want +HH:MM or -HH:MM")
	}
	mins := h*60 + m
	if s[0] == '-' {
		mins = -mins
	}
	if mins%15 != 0 || mins < -12*60 || mins > 14*60 {
		return 0, fmt.Errorf("want a whole quarter hour from -12:00 to +14:00")
	}
	return mins, nil
}

// offsetsFor lists, earliest first, the instants whose reading in loc is w.
func offsetsFor(w Wall, loc *time.Location) []time.Time {
	guess := w.AsUTC()
	seen := map[int]bool{}
	var out []time.Time
	for _, probe := range []time.Duration{-15 * time.Hour, 0, 15 * time.Hour} {
		_, off := guess.Add(probe).In(loc).Zone()
		if seen[off] {
			continue
		}
		seen[off] = true
		cand := guess.Add(-time.Duration(off) * time.Second)
		if _, actual := cand.In(loc).Zone(); actual == off {
			out = append(out, cand)
		}
	}
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j].Before(out[j-1]); j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}

// Resolve reads a local clock time in a zone. A time that happens twice takes
// the first of the two instants; a time that does not exist moves forward to
// the first valid minute of that day, reported as moved.
func Resolve(w Wall, zone string) (instant time.Time, actual Wall, moved bool) {
	loc := Location(zone)
	if cands := offsetsFor(w, loc); len(cands) > 0 {
		return cands[0], w, false
	}
	for step := 1; step <= 24*60; step++ {
		next := w.AddMinutes(step)
		if next.Date() != w.Date() {
			break
		}
		if cands := offsetsFor(next, loc); len(cands) > 0 {
			return cands[0], next, true
		}
	}
	// No minute of that day reads back, which the published zones never do.
	return w.AsUTC(), w, false
}

// OffsetAt reports the zone's own offset, in minutes, at a local reading.
func OffsetAt(w Wall, zone string) int {
	instant, _, _ := Resolve(w, zone)
	_, off := instant.In(Location(zone)).Zone()
	return off / 60
}

// InZone reads an instant as a local clock time in a zone.
func InZone(t time.Time, zone string) Wall { return wallOf(t.In(Location(zone))) }

// StartOfDay gives the instant local midnight begins on a date in a zone.
func StartOfDay(date Wall, zone string) time.Time {
	instant, _, _ := Resolve(Wall{date.Y, date.M, date.D, 0, 0}, zone)
	return instant
}

var longDays = []string{"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"}
var months = []string{"", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"}

// ReadableDate writes a date the published way, like Mon 8 Mar 2027.
func ReadableDate(w Wall) string {
	return fmt.Sprintf("%s %d %s %d", longDays[int(w.Weekday())], w.D, months[w.M], w.Y)
}

// WeekdayName writes a weekday in full, as the repeat choices read it.
func WeekdayName(d time.Weekday) string { return d.String() }

// MinutesOfDay reads HH:MM as minutes after local midnight.
func MinutesOfDay(hhmm string) (int, error) {
	var h, m int
	if len(hhmm) != 5 || hhmm[2] != ':' {
		return 0, fmt.Errorf("want HH:MM")
	}
	if _, err := fmt.Sscanf(hhmm, "%02d:%02d", &h, &m); err != nil || h > 23 || m > 59 {
		return 0, fmt.Errorf("want HH:MM")
	}
	return h*60 + m, nil
}

// SameDate reports whether two readings fall on one calendar date.
func SameDate(a, b Wall) bool { return a.Date() == b.Date() }

func TrimSpace(s string) string { return strings.TrimSpace(s) }
