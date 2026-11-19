// Package calendar decides every night question in the studio zone: a night's
// instant, its sign-up window and its status.
package calendar

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/cinderlatch/holdfast/internal/clockx"
	"github.com/cinderlatch/holdfast/internal/store"
)

// The night window, measured from the start instant.
const (
	SignupsOpenLead  = 168 * time.Hour
	SignupsCloseLead = 2 * time.Hour
	NightDuration    = 3 * time.Hour
)

// Night statuses, in the order a night passes through them.
const (
	StatusScheduled   = "scheduled"
	StatusSignupsOpen = "signups_open"
	StatusClosed      = "closed"
	StatusLive        = "live"
	StatusDone        = "done"
)

// NightView is a night exactly as the API publishes it.
type NightView struct {
	ID                 string  `json:"id"`
	SeriesID           string  `json:"series_id"`
	Title              string  `json:"title"`
	Mode               string  `json:"mode"`
	Date               string  `json:"date"`
	ScheduledLocalTime string  `json:"scheduled_local_time"`
	LocalStart         string  `json:"local_start"`
	UTCOffset          string  `json:"utc_offset"`
	ZoneAbbr           string  `json:"zone_abbr"`
	StartsAt           string  `json:"starts_at"`
	SignupsOpenAt      string  `json:"signups_open_at"`
	SignupsCloseAt     string  `json:"signups_close_at"`
	EndsAt             string  `json:"ends_at"`
	Status             string  `json:"status"`
	StatusChangesInMS  *int64  `json:"status_changes_in_ms"`
	Capacity           int     `json:"capacity"`
	SignedUp           int     `json:"signed_up"`
	SeatsLeft          int     `json:"seats_left"`
	DSTNote            *string `json:"dst_note"`

	// starts carries the instant for ordering and for the window checks.
	starts         time.Time
	signupsOpenAt  time.Time
	signupsCloseAt time.Time
}

// StartsAtTime reports the night's start instant.
func (v NightView) StartsAtTime() time.Time { return v.starts }

// SignupsOpenAtTime reports the instant sign-ups open.
func (v NightView) SignupsOpenAtTime() time.Time { return v.signupsOpenAt }

// SignupsCloseAtTime reports the instant sign-ups close.
func (v NightView) SignupsCloseAtTime() time.Time { return v.signupsCloseAt }

// Resolve turns a stored night's date and wall time into its instant, applying
// the skipped and repeated hour rules.
func Resolve(night store.Night, zone *time.Location) (time.Time, time.Time, clockx.DSTNote) {
	hour, minute := splitHHMM(night.ScheduledLocalTime)
	return clockx.ResolveLocal(zone, night.Date.Year(), night.Date.Month(), night.Date.Day(), hour, minute, 0)
}

// Build renders a stored night against the server's wall clock.
func Build(night store.Night, zone *time.Location, now time.Time) NightView {
	starts, local, note := Resolve(night, zone)
	openAt := starts.Add(-SignupsOpenLead)
	closeAt := starts.Add(-SignupsCloseLead)
	endsAt := starts.Add(NightDuration)

	view := NightView{
		ID:                 night.ID,
		SeriesID:           night.SeriesID,
		Title:              night.Title,
		Mode:               night.Mode,
		Date:               night.Date.Format("2006-01-02"),
		ScheduledLocalTime: night.ScheduledLocalTime,
		LocalStart:         local.Format("15:04"),
		UTCOffset:          clockx.Offset(starts, zone),
		ZoneAbbr:           clockx.Abbr(starts, zone),
		StartsAt:           instant(starts),
		SignupsOpenAt:      instant(openAt),
		SignupsCloseAt:     instant(closeAt),
		EndsAt:             instant(endsAt),
		Capacity:           night.Capacity,
		SignedUp:           night.SignedUp,
		SeatsLeft:          max(night.Capacity-night.SignedUp, 0),
		starts:             starts,
		signupsOpenAt:      openAt,
		signupsCloseAt:     closeAt,
	}
	if note != clockx.NoteNone {
		text := string(note)
		view.DSTNote = &text
	}
	view.Status, view.StatusChangesInMS = status(now, openAt, closeAt, starts, endsAt)
	return view
}

// status decides a night's status and the time until it changes. Each instant
// belongs to the later status.
func status(now, openAt, closeAt, startsAt, endsAt time.Time) (string, *int64) {
	switch {
	case now.Before(openAt):
		return StatusScheduled, msUntil(now, openAt)
	case now.Before(closeAt):
		return StatusSignupsOpen, msUntil(now, closeAt)
	case now.Before(startsAt):
		return StatusClosed, msUntil(now, startsAt)
	case now.Before(endsAt):
		return StatusLive, msUntil(now, endsAt)
	default:
		return StatusDone, nil
	}
}

func msUntil(now, next time.Time) *int64 {
	ms := next.Sub(now).Milliseconds()
	if ms < 0 {
		ms = 0
	}
	return &ms
}

func instant(t time.Time) string { return t.UTC().Format(time.RFC3339) }

// Weekdays maps the published weekday names onto Go weekdays.
var Weekdays = map[string]time.Weekday{
	"monday":    time.Monday,
	"tuesday":   time.Tuesday,
	"wednesday": time.Wednesday,
	"thursday":  time.Thursday,
	"friday":    time.Friday,
	"saturday":  time.Saturday,
	"sunday":    time.Sunday,
}

// WeekdayTitle renders a weekday name for the first_date field message.
func WeekdayTitle(name string) string {
	if name == "" {
		return ""
	}
	return strings.ToUpper(name[:1]) + name[1:]
}

// SeriesDates expands a series into one studio date per week.
func SeriesDates(firstDate time.Time, weeks int) []time.Time {
	dates := make([]time.Time, 0, weeks)
	for week := 0; week < weeks; week++ {
		dates = append(dates, firstDate.AddDate(0, 0, 7*week))
	}
	return dates
}

// ParseHHMM reads a 24-hour HH:MM wall time.
func ParseHHMM(value string) (int, int, bool) {
	parts := strings.Split(value, ":")
	if len(parts) != 2 || len(parts[0]) != 2 || len(parts[1]) != 2 {
		return 0, 0, false
	}
	hour, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0, 0, false
	}
	minute, err := strconv.Atoi(parts[1])
	if err != nil {
		return 0, 0, false
	}
	if hour < 0 || hour > 23 || minute < 0 || minute > 59 {
		return 0, 0, false
	}
	return hour, minute, true
}

// ParseDate reads a YYYY-MM-DD studio date.
func ParseDate(value string) (time.Time, bool) {
	t, err := time.ParseInLocation("2006-01-02", value, time.UTC)
	if err != nil || t.Format("2006-01-02") != value {
		return time.Time{}, false
	}
	return t, true
}

// ParseLocalWallTime reads a studio wall time, accepting a date and time joined
// by a T or a space, with optional seconds.
func ParseLocalWallTime(value string) (year int, month time.Month, day, hour, minute, second int, ok bool) {
	normalised := strings.Replace(strings.TrimSpace(value), " ", "T", 1)
	for _, layout := range []string{"2006-01-02T15:04:05", "2006-01-02T15:04"} {
		t, err := time.ParseInLocation(layout, normalised, time.UTC)
		if err == nil {
			return t.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), t.Second(), true
		}
	}
	return 0, 0, 0, 0, 0, 0, false
}

// FormatLocalWallTime renders a studio wall time as the API writes it back.
func FormatLocalWallTime(year int, month time.Month, day, hour, minute int) string {
	return fmt.Sprintf("%04d-%02d-%02dT%02d:%02d", year, int(month), day, hour, minute)
}

func splitHHMM(value string) (int, int) {
	hour, minute, _ := ParseHHMM(value)
	return hour, minute
}

// StudioDate reports the studio-local date of an instant.
func StudioDate(at time.Time, zone *time.Location) time.Time {
	local := at.In(zone)
	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC)
}
