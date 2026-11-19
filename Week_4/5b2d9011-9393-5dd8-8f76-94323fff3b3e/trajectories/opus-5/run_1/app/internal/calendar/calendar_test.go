package calendar

import (
	"testing"
	"time"

	"github.com/cinderlatch/holdfast/internal/store"
)

func chicago(t *testing.T) *time.Location {
	t.Helper()
	zone, err := time.LoadLocation("America/Chicago")
	if err != nil {
		t.Fatalf("load zone: %v", err)
	}
	return zone
}

// seededFridaySiege is the brief's worked example.
func seededFridaySiege() store.Night {
	return store.Night{
		ID: "n1", SeriesID: "s1", Title: "Friday Siege", Mode: "siege",
		Date:               time.Date(2026, 11, 13, 0, 0, 0, 0, time.UTC),
		ScheduledLocalTime: "20:00", Capacity: 24,
	}
}

func TestNightWindowsAndStatusBoundaries(t *testing.T) {
	zone := chicago(t)
	night := seededFridaySiege()
	starts := time.Date(2026, 11, 14, 2, 0, 0, 0, time.UTC)

	view := Build(night, zone, starts.Add(-200*time.Hour))
	if view.StartsAt != "2026-11-14T02:00:00Z" {
		t.Errorf("starts_at = %s, want 2026-11-14T02:00:00Z", view.StartsAt)
	}
	if view.Date != "2026-11-13" {
		t.Errorf("date = %s, want the studio-local 2026-11-13", view.Date)
	}
	if view.SignupsOpenAt != "2026-11-07T02:00:00Z" {
		t.Errorf("signups_open_at = %s, want 168 h before the start", view.SignupsOpenAt)
	}
	if view.SignupsCloseAt != "2026-11-14T00:00:00Z" {
		t.Errorf("signups_close_at = %s, want 2 h before the start", view.SignupsCloseAt)
	}
	if view.EndsAt != "2026-11-14T05:00:00Z" {
		t.Errorf("ends_at = %s, want 3 h after the start", view.EndsAt)
	}

	// Each instant belongs to the later status.
	cases := []struct {
		name string
		now  time.Time
		want string
	}{
		{"before opening", starts.Add(-SignupsOpenLead - time.Second), StatusScheduled},
		{"the opening instant", starts.Add(-SignupsOpenLead), StatusSignupsOpen},
		{"a second before closing", starts.Add(-SignupsCloseLead - time.Second), StatusSignupsOpen},
		{"the closing instant", starts.Add(-SignupsCloseLead), StatusClosed},
		{"a second before the start", starts.Add(-time.Second), StatusClosed},
		{"the start instant", starts, StatusLive},
		{"a second before the end", starts.Add(NightDuration - time.Second), StatusLive},
		{"the end instant", starts.Add(NightDuration), StatusDone},
	}
	for _, c := range cases {
		got := Build(night, zone, c.now)
		if got.Status != c.want {
			t.Errorf("%s: status = %s, want %s", c.name, got.Status, c.want)
		}
		if c.want == StatusDone && got.StatusChangesInMS != nil {
			t.Errorf("%s: a done night counts down to nothing", c.name)
		}
		if c.want != StatusDone && got.StatusChangesInMS == nil {
			t.Errorf("%s: status_changes_in_ms is set until done", c.name)
		}
	}

	// The countdown runs to the next boundary.
	open := Build(night, zone, starts.Add(-SignupsOpenLead))
	if want := (SignupsOpenLead - SignupsCloseLead).Milliseconds(); *open.StatusChangesInMS != want {
		t.Errorf("status_changes_in_ms = %d, want %d", *open.StatusChangesInMS, want)
	}
}

func TestSeatsLeftAndCapacity(t *testing.T) {
	zone := chicago(t)
	night := seededFridaySiege()
	night.SignedUp = 24
	view := Build(night, zone, time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC))
	if view.SeatsLeft != 0 {
		t.Errorf("seats left = %d, want 0", view.SeatsLeft)
	}
	night.SignedUp = 30
	if got := Build(night, zone, time.Now()).SeatsLeft; got != 0 {
		t.Errorf("seats left never goes below zero, got %d", got)
	}
}

func TestWallClockHoldsAcrossDaylightSaving(t *testing.T) {
	zone := chicago(t)
	// A Sunday 02:30 series lands in the spring-forward gap on 2027-03-14.
	gap := store.Night{
		ID: "n2", Title: "Gap", Mode: "siege", Capacity: 8,
		Date:               time.Date(2027, 3, 14, 0, 0, 0, 0, time.UTC),
		ScheduledLocalTime: "02:30",
	}
	view := Build(gap, zone, time.Now())
	if view.LocalStart != "03:30" || view.StartsAt != "2027-03-14T08:30:00Z" {
		t.Errorf("gap night = %s at %s, want 03:30 at 2027-03-14T08:30:00Z", view.LocalStart, view.StartsAt)
	}
	if view.DSTNote == nil || *view.DSTNote != "shifted_forward" {
		t.Errorf("dst_note = %v, want shifted_forward", view.DSTNote)
	}

	// A Sunday 01:30 series lands in the fall-back overlap on 2027-11-07.
	overlap := store.Night{
		ID: "n3", Title: "Overlap", Mode: "siege", Capacity: 8,
		Date:               time.Date(2027, 11, 7, 0, 0, 0, 0, time.UTC),
		ScheduledLocalTime: "01:30",
	}
	view = Build(overlap, zone, time.Now())
	if view.LocalStart != "01:30" || view.StartsAt != "2027-11-07T06:30:00Z" {
		t.Errorf("overlap night = %s at %s, want 01:30 at 2027-11-07T06:30:00Z", view.LocalStart, view.StartsAt)
	}
	if view.DSTNote == nil || *view.DSTNote != "first_occurrence" {
		t.Errorf("dst_note = %v, want first_occurrence", view.DSTNote)
	}

	// Every other week keeps its wall-clock time across the change.
	for _, date := range []struct {
		day      time.Time
		wantUTC  string
		wantAbbr string
	}{
		{time.Date(2027, 3, 5, 0, 0, 0, 0, time.UTC), "2027-03-06T02:00:00Z", "CST"},
		{time.Date(2027, 3, 19, 0, 0, 0, 0, time.UTC), "2027-03-20T01:00:00Z", "CDT"},
	} {
		weekly := store.Night{
			ID: "n4", Title: "Friday Siege", Mode: "siege", Capacity: 24,
			Date: date.day, ScheduledLocalTime: "20:00",
		}
		got := Build(weekly, zone, time.Now())
		if got.LocalStart != "20:00" {
			t.Errorf("%s local start = %s, want 20:00", date.day.Format("2006-01-02"), got.LocalStart)
		}
		if got.StartsAt != date.wantUTC {
			t.Errorf("%s starts_at = %s, want %s", date.day.Format("2006-01-02"), got.StartsAt, date.wantUTC)
		}
		if got.ZoneAbbr != date.wantAbbr {
			t.Errorf("%s abbr = %s, want %s", date.day.Format("2006-01-02"), got.ZoneAbbr, date.wantAbbr)
		}
	}
}

func TestSeriesDatesStepOneWeek(t *testing.T) {
	first := time.Date(2026, 11, 13, 0, 0, 0, 0, time.UTC)
	dates := SeriesDates(first, 8)
	if len(dates) != 8 {
		t.Fatalf("dates = %d, want 8", len(dates))
	}
	if dates[0].Format("2006-01-02") != "2026-11-13" {
		t.Errorf("first date = %s", dates[0].Format("2006-01-02"))
	}
	if dates[7].Format("2006-01-02") != "2027-01-01" {
		t.Errorf("eighth date = %s, want 2027-01-01", dates[7].Format("2006-01-02"))
	}
	for _, date := range dates {
		if date.Weekday() != time.Friday {
			t.Errorf("%s is not a Friday", date.Format("2006-01-02"))
		}
	}
}

func TestParseHelpers(t *testing.T) {
	if _, _, ok := ParseHHMM("20:00"); !ok {
		t.Error("20:00 is a valid wall time")
	}
	for _, bad := range []string{"8:00", "20:0", "24:00", "20:60", "2000", "", "ab:cd"} {
		if _, _, ok := ParseHHMM(bad); ok {
			t.Errorf("%q should be refused", bad)
		}
	}
	if _, ok := ParseDate("2026-11-13"); !ok {
		t.Error("2026-11-13 is a valid date")
	}
	for _, bad := range []string{"2026-13-01", "26-11-13", "2026/11/13", ""} {
		if _, ok := ParseDate(bad); ok {
			t.Errorf("%q should be refused", bad)
		}
	}
	// A space is accepted in place of the T.
	for _, good := range []string{"2026-11-20T19:30", "2026-11-20 19:30", "2026-11-20T19:30:45"} {
		if _, _, _, _, _, _, ok := ParseLocalWallTime(good); !ok {
			t.Errorf("%q should be accepted", good)
		}
	}
	if _, _, _, _, _, _, ok := ParseLocalWallTime("20/11/2026 19:30"); ok {
		t.Error("another shape should be refused")
	}
}
