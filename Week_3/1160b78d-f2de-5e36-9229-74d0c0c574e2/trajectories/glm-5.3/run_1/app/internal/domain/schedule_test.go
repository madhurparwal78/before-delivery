package domain

import (
	"testing"
	"time"
)

func TestLocalInstantSpringForward(t *testing.T) {
	// America/Chicago 2027-03-14 02:30 does not exist; it takes the first valid
	// instant after the jump, which is 03:00.
	inst, err := LocalInstant("2027-03-14", "02:30", "America/Chicago")
	if err != nil {
		t.Fatal(err)
	}
	if got := inst.Format("2006-01-02T15:04Z07:00"); got != "2027-03-14T03:00-05:00" {
		t.Fatalf("spring forward gave %s", got)
	}
}

func TestLocalInstantFallBack(t *testing.T) {
	// America/Chicago 2027-11-07 01:30 happens twice; the first occurrence is
	// the earlier instant, 01:30 CDT.
	inst, err := LocalInstant("2027-11-07", "01:30", "America/Chicago")
	if err != nil {
		t.Fatal(err)
	}
	if got := inst.Format("2006-01-02T15:04Z07:00"); got != "2027-11-07T01:30-05:00" {
		t.Fatalf("fall back gave %s", got)
	}
}

func TestDayMinutes(t *testing.T) {
	// The brief: 2027-03-14 measures 1380 minutes and 2027-11-07 measures 1500.
	zone := "America/Chicago"
	for _, c := range []struct {
		date string
		want int
	}{{"2027-03-14", 1380}, {"2027-11-07", 1500}, {"2027-06-01", 1440}} {
		start, err := LocalInstant(c.date, "00:00", zone)
		if err != nil {
			t.Fatal(err)
		}
		next, err := LocalInstant(nextDate(c.date), "00:00", zone)
		if err != nil {
			t.Fatal(err)
		}
		if got := int(next.Sub(start).Minutes()); got != c.want {
			t.Fatalf("day %s measured %d, want %d", c.date, got, c.want)
		}
	}
}

func nextDate(date string) string {
	d, _ := time.Parse("2006-01-02", date)
	return d.AddDate(0, 0, 1).Format("2006-01-02")
}

func TestTransportPrimaryAcrossClockChange(t *testing.T) {
	// The brief: the block from 2027-03-13T14:00:00Z to 2027-03-14T13:00:00Z is
	// Ines Varga's and measures 1380 minutes.
	l := &Layer{
		ID:          "l1",
		Order:       1,
		ShiftDays:   1,
		HandoffTime: "08:00",
		StartDate:   "2026-01-05",
		People:      []string{"ines", "tomasz", "priya", "mateus"},
		ScheduleZone: "America/Chicago",
		RecordFormat: 2,
	}
	names := map[string]string{"ines": "Ines Varga", "tomasz": "Tomasz Reyes", "priya": "Priya Lindqvist", "mateus": "Mateus Oyelaran"}
	h := l.HolderAt(time.Date(2027, 3, 13, 20, 0, 0, 0, time.UTC), "", names)
	if h == nil || h.Name != "Ines Varga" {
		t.Fatalf("holder at 2027-03-13T20:00Z = %v, want Ines Varga", h)
	}
	blocks := FinalSchedule([]*Layer{l}, nil,
		time.Date(2027, 3, 13, 14, 0, 0, 0, time.UTC),
		time.Date(2027, 3, 14, 13, 0, 0, 0, time.UTC), names)
	if len(blocks) != 1 {
		t.Fatalf("expected one block, got %d", len(blocks))
	}
	if blocks[0].Person == nil || blocks[0].Person.Name != "Ines Varga" {
		t.Fatalf("block holder = %v", blocks[0].Person)
	}
	if blocks[0].Minutes != 1380 {
		t.Fatalf("block minutes = %d, want 1380", blocks[0].Minutes)
	}
}

func TestRestrictionCrossesMidnight(t *testing.T) {
	// Friday 22:00 to Saturday 06:00 in the layer's own zone.
	l := &Layer{
		ID:           "l2",
		Order:        1,
		ShiftDays:    1,
		HandoffTime:  "20:00",
		StartDate:    "2026-01-05",
		People:       []string{"mateus", "priya"},
		ScheduleZone: "Europe/Berlin",
		RecordFormat: 2,
		Restrictions: []Restriction{{Days: []string{"fri"}, Start: "22:00", End: "06:00"}},
	}
	// Friday 23:00 Berlin is inside the window.
	fri, _ := LocalInstant("2027-03-12", "23:00", "Europe/Berlin")
	if !l.RestrictionAllows(fri, "") {
		t.Fatal("Friday 23:00 should be allowed")
	}
	// Saturday 03:00 Berlin belongs to the Friday window.
	sat, _ := LocalInstant("2027-03-13", "03:00", "Europe/Berlin")
	if !l.RestrictionAllows(sat, "") {
		t.Fatal("Saturday 03:00 should be allowed through the Friday window")
	}
	// Monday 03:00 is outside.
	mon, _ := LocalInstant("2027-03-15", "03:00", "Europe/Berlin")
	if l.RestrictionAllows(mon, "") {
		t.Fatal("Monday 03:00 should not be allowed")
	}
}
