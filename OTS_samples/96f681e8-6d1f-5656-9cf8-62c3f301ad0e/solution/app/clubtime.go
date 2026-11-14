package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata" // the club's zone must resolve on images without a system zoneinfo
)

const (
	clubName = "Marlowe Yard Padel Club"

	dateLayout      = "2006-01-02"
	instantLayout   = "2006-01-02T15:04:05.000Z"
	clubTimeLayout  = "2006-01-02T15:04:05-07:00"
	gridCellMinutes = 30
)

var (
	wallPattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$`)
	hmPattern   = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)
)

// ClubClock knows the club's zone (CLUB_TIMEZONE), opening hours and slot step.
type ClubClock struct {
	zoneName string
	zone     *time.Location
	openMin  int
	closeMin int
	stepMin  int
}

func newClubClock(timing ClubTiming) (*ClubClock, error) {
	zone, err := time.LoadLocation(timing.ClubTimezone)
	if err != nil || timing.ClubTimezone == "Local" {
		return nil, fmt.Errorf("CLUB_TIMEZONE must be an IANA zone such as Europe/Madrid: %q", timing.ClubTimezone)
	}
	first, last, found := strings.Cut(timing.OpeningHours, "-")
	if !found {
		return nil, fmt.Errorf("OPENING_HOURS must look like 08:00-23:00")
	}
	openMin, err := parseClockMinutes(first, false)
	if err != nil {
		return nil, fmt.Errorf("OPENING_HOURS: %w", err)
	}
	closeMin, err := parseClockMinutes(last, true)
	if err != nil || closeMin <= openMin {
		return nil, fmt.Errorf("OPENING_HOURS must end after it starts")
	}
	return &ClubClock{zoneName: timing.ClubTimezone, zone: zone, openMin: openMin, closeMin: closeMin, stepMin: timing.SlotStepMinutes}, nil
}

func parseClockMinutes(text string, allow24 bool) (int, error) {
	if allow24 && text == "24:00" {
		return 24 * 60, nil
	}
	if !hmPattern.MatchString(text) {
		return 0, fmt.Errorf("%q is not HH:MM", text)
	}
	hours, _ := strconv.Atoi(text[:2])
	minutes, _ := strconv.Atoi(text[3:])
	return hours*60 + minutes, nil
}

// parseDay reads a club date written YYYY-MM-DD, as midnight UTC standing for the civil day.
func parseDay(text string) (time.Time, bool) {
	if len(text) != len(dateLayout) {
		return time.Time{}, false
	}
	day, err := time.Parse(dateLayout, text)
	return day, err == nil
}

// wallInstant turns a club wall time into an instant: the earlier occurrence in the repeated autumn hour,
// and no instant at all in the missing spring hour.
func (c *ClubClock) wallInstant(day time.Time, minuteOfDay int) (time.Time, bool) {
	wall := time.Date(day.Year(), day.Month(), day.Day(), minuteOfDay/60, minuteOfDay%60, 0, 0, time.UTC)
	var best time.Time
	found := false
	for _, probe := range []time.Time{wall.Add(-24 * time.Hour), wall.Add(24 * time.Hour)} {
		_, offset := probe.In(c.zone).Zone()
		candidate := wall.Add(-time.Duration(offset) * time.Second)
		local := candidate.In(c.zone)
		if local.Year() != wall.Year() || local.Month() != wall.Month() || local.Day() != wall.Day() ||
			local.Hour() != wall.Hour() || local.Minute() != wall.Minute() {
			continue
		}
		if !found || candidate.Before(best) {
			best, found = candidate, true
		}
	}
	return best, found
}

// clubDate is the one place the club date of an instant is decided: its date in the club's zone, never the UTC date.
func (c *ClubClock) clubDate(instant time.Time) time.Time {
	local := instant.In(c.zone)
	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC)
}

func (c *ClubClock) dayEnd(day time.Time, minuteOfDay int) (time.Time, bool) {
	if minuteOfDay == 24*60 {
		return c.wallInstant(day.AddDate(0, 0, 1), 0)
	}
	return c.wallInstant(day, minuteOfDay)
}

// openMinutes is the club date's opening minutes, counted in real time.
func (c *ClubClock) openMinutes(day time.Time) int {
	open, _ := c.wallInstant(day, c.openMin)
	closing, _ := c.dayEnd(day, c.closeMin)
	return int(closing.Sub(open) / time.Minute)
}

// gridStarts lists the half-hour starts inside opening hours on a club date.
func (c *ClubClock) gridStarts(day time.Time) []time.Time {
	var starts []time.Time
	first := (c.openMin + gridCellMinutes - 1) / gridCellMinutes * gridCellMinutes
	for minute := first; minute+gridCellMinutes <= c.closeMin; minute += gridCellMinutes {
		if instant, ok := c.wallInstant(day, minute); ok {
			starts = append(starts, instant)
		}
	}
	return starts
}

// slotStart validates a request's wall start for a length: inside opening hours, on the slot step, not in the missing hour.
func (c *ClubClock) slotStart(wall string, minutes int) (time.Time, bool) {
	if !wallPattern.MatchString(wall) {
		return time.Time{}, false
	}
	day, ok := parseDay(wall[:10])
	if !ok {
		return time.Time{}, false
	}
	hours, _ := strconv.Atoi(wall[11:13])
	mins, _ := strconv.Atoi(wall[14:])
	if hours > 23 || mins > 59 {
		return time.Time{}, false
	}
	return c.slotAt(day, hours*60+mins, minutes)
}

func (c *ClubClock) slotAt(day time.Time, minuteOfDay, minutes int) (time.Time, bool) {
	if minuteOfDay < c.openMin || (minuteOfDay-c.openMin)%c.stepMin != 0 {
		return time.Time{}, false
	}
	start, ok := c.wallInstant(day, minuteOfDay)
	if !ok {
		return time.Time{}, false
	}
	closing, _ := c.dayEnd(day, c.closeMin)
	if slotEnd(start, minutes).After(closing) {
		return time.Time{}, false
	}
	return start, true
}

// weeklyRepeat is the one place the weekly wall-time repeat is decided: the same weekday and club wall time,
// seven club dates after the week before, so a clock change keeps the wall time.
func (c *ClubClock) weeklyRepeat(first time.Time, minutes, weeks int) ([]time.Time, bool) {
	local := first.In(c.zone)
	day := c.clubDate(first)
	minuteOfDay := local.Hour()*60 + local.Minute()
	starts := make([]time.Time, 0, weeks)
	for week := 0; week < weeks; week++ {
		start, ok := c.slotAt(day.AddDate(0, 0, 7*week), minuteOfDay, minutes)
		if !ok {
			return nil, false
		}
		starts = append(starts, start)
	}
	return starts, true
}

func formatUTC(instant time.Time) string { return instant.UTC().Format(instantLayout) }

func (c *ClubClock) formatClub(instant time.Time) string {
	return instant.In(c.zone).Format(clubTimeLayout)
}

// clubHM is the club wall time as HH:MM.
func (c *ClubClock) clubHM(instant time.Time) string { return instant.In(c.zone).Format("15:04") }

// clubDay is the club date as YYYY-MM-DD.
func (c *ClubClock) clubDay(instant time.Time) string { return c.clubDate(instant).Format(dateLayout) }

// slotLabel is "Court <n>, <date> <HH:MM>" as used in notices and card names.
func (c *ClubClock) slotLabel(court int, start time.Time) string {
	return fmt.Sprintf("Court %d, %s %s", court, c.clubDay(start), c.clubHM(start))
}
