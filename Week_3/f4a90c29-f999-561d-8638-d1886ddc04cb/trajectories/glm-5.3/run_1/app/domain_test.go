package main

import (
	"testing"
	"time"
)

func TestPartnersWeeklyAcrossDST(t *testing.T) {
	cases := []struct {
		date     string
		ny       string
		london   string
		auckland string
	}{
		{"2026-10-06", "09:00", "14:00", "02:00 next day"},
		{"2027-03-09", "09:00", "14:00", "03:00 next day"},
		{"2027-03-16", "09:00", "13:00", "02:00 next day"},
		{"2027-03-30", "09:00", "14:00", "02:00 next day"},
		{"2027-04-06", "09:00", "14:00", "01:00 next day"},
	}
	for _, c := range cases {
		inst, _, gap := InstantFromLocal("America/New_York", c.date, 9*60)
		if gap {
			t.Fatalf("%s: unexpected gap", c.date)
		}
		if got := InZone(inst, "America/New_York").Format("15:04"); got != c.ny {
			t.Errorf("%s NY = %s want %s", c.date, got, c.ny)
		}
		if got := InZone(inst, "Europe/London").Format("15:04"); got != c.london {
			t.Errorf("%s London = %s want %s", c.date, got, c.london)
		}
		// auckland next day
		ak := InZone(inst, "Pacific/Auckland")
		if ak.Format("15:04") != c.auckland[:5] {
			t.Errorf("%s Auckland = %s want %s", c.date, ak.Format("15:04"), c.auckland[:5])
		}
	}
}

func TestGapHandling(t *testing.T) {
	// New York spring forward: 02:00 does not exist on 2027-03-14
	inst, _, gap := InstantFromLocal("America/New_York", "2027-03-14", 2*60)
	if !gap {
		t.Fatalf("02:00 on 2027-03-14 should be a gap")
	}
	if got := InZone(inst, "America/New_York").Format("15:04"); got != "03:00" {
		t.Errorf("gap moved to %s, want 03:00", got)
	}
	// normal day
	inst2, _, gap2 := InstantFromLocal("America/New_York", "2027-03-15", 2*60)
	if gap2 {
		t.Fatalf("unexpected gap on normal day")
	}
	if got := InZone(inst2, "America/New_York").Format("15:04"); got != "02:00" {
		t.Errorf("normal day = %s want 02:00", got)
	}
}

func TestFoldHandling(t *testing.T) {
	// New York fall back: 01:30 happens twice on 2027-11-07
	inst, fold, _ := InstantFromLocal("America/New_York", "2027-11-07", 90)
	if !fold {
		t.Fatalf("01:30 on 2027-11-07 should be a fold")
	}
	if got := inst.UTC().Format("15:04"); got != "05:30" {
		t.Errorf("fold first instant = %s UTC want 05:30", got)
	}
}

func TestSundayMarketsCheck(t *testing.T) {
	// 02:30-03:00 New York weekly from 2027-03-07, count 4
	r, err := ParseRRule("FREQ=WEEKLY;COUNT=4")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	dates := r.Expand("2027-03-07", 0, time.Time{})
	want := []string{"2027-03-07", "2027-03-14", "2027-03-21", "2027-03-28"}
	if len(dates) != len(want) {
		t.Fatalf("dates = %v want %v", dates, want)
	}
	for i := range want {
		if dates[i] != want[i] {
			t.Errorf("date[%d] = %s want %s", i, dates[i], want[i])
		}
	}
	// 02:30 does not exist on 2027-03-14 → moves to 03:30
	_, _, gap := InstantFromLocal("America/New_York", "2027-03-14", 150)
	if !gap {
		t.Fatalf("02:30 on 2027-03-14 should be a gap")
	}
}

func TestRRuleForms(t *testing.T) {
	good := []string{
		"FREQ=DAILY",
		"FREQ=WEEKLY;BYDAY=TU,MO",
		"COUNT=4;FREQ=WEEKLY;INTERVAL=2",
		"FREQ=MONTHLY;UNTIL=20271231",
		"FREQ=MONTHLY;BYDAY=2TU",
		"FREQ=MONTHLY;BYDAY=-1FR",
		"FREQ=YEARLY;INTERVAL=2",
	}
	for _, g := range good {
		if _, err := ParseRRule(g); err != nil {
			t.Errorf("accept %q: %v", g, err)
		}
	}
	bad := []string{
		"freq=daily",
		"FREQ=WEEKLY;BYDAY=mo",
		"FREQ=WEEKLY;BYDAY=MO,MO",
		"FREQ=WEEKLY;BYDAY=1MO",
		"FREQ=WEEKLY;INTERVAL=0",
		"FREQ=WEEKLY;INTERVAL=100",
		"FREQ=WEEKLY;COUNT=0",
		"FREQ=WEEKLY;COUNT=1000",
		"FREQ=MONTHLY;BYDAY=MO",
		"FREQ=MONTHLY;BYDAY=5TU",
		"FREQ=MONTHLY;BYDAY=2TU,3TU",
		"FREQ=MONTHLY;BYMONTHDAY=1",
		"FREQ=MONTHLY;UNTIL=20271231T000000Z",
		"FREQ=YEARLY;COUNT=2;UNTIL=20301231",
		"INTERVAL=2",
		"FREQ=HOURLY",
	}
	for _, b := range bad {
		if _, err := ParseRRule(b); err == nil {
			t.Errorf("reject %q: accepted", b)
		}
	}
}

func TestMonthlyByDay(t *testing.T) {
	// second Tuesday of March 2027 is the 9th
	r, err := ParseRRule("FREQ=MONTHLY;BYDAY=2TU")
	if err != nil {
		t.Fatal(err)
	}
	dates := r.Expand("2027-03-09", 0, time.Time{})
	if len(dates) == 0 || dates[0] != "2027-03-09" {
		t.Fatalf("first = %v", dates)
	}
	if len(dates) < 4 || dates[3] != "2027-06-08" {
		t.Errorf("fourth = %v want 2027-06-08", dates)
	}
	// last Friday of March 2027 is the 26th
	r2, _ := ParseRRule("FREQ=MONTHLY;BYDAY=-1FR")
	d2 := r2.Expand("2027-03-26", 0, time.Time{})
	if len(d2) == 0 || d2[0] != "2027-03-26" {
		t.Fatalf("last friday first = %v", d2)
	}
}

func TestMonthly31SkipsShortMonths(t *testing.T) {
	r, _ := ParseRRule("FREQ=MONTHLY")
	dates := r.Expand("2027-01-31", 0, time.Time{})
	if len(dates) < 3 {
		t.Fatalf("dates = %v", dates)
	}
	for _, d := range dates {
		day := d[8:10]
		if day != "31" {
			// February and April have no 31st: they must be skipped
			if d[5:7] == "02" || d[5:7] == "04" {
				t.Errorf("month %s generated date %s", d[5:7], d)
			}
		}
	}
}

func TestYearlyFeb29(t *testing.T) {
	r, _ := ParseRRule("FREQ=YEARLY")
	dates := r.Expand("2028-02-29", 0, time.Time{})
	if len(dates) < 2 {
		t.Fatalf("dates = %v", dates)
	}
	for _, d := range dates {
		if !IsLeapYear(mustDate(d).Year()) {
			t.Errorf("non-leap %s", d)
		}
	}
}

func TestZoneRuleShift(t *testing.T) {
	// Wellington workshop: Auckland rules give +12:00 on 2027-04-20; a rule
	// with +13:00 from 2026-06-01 shifts it by 60 minutes.
	o := &Occurrence{Zone: "Pacific/Auckland", StartDate: "2027-04-20", StartMinutes: 600, AllDay: false}
	rules := []*ZoneRule{{
		ID: "r1", Zone: "Pacific/Auckland", EffectiveDate: "2026-06-01",
		OffsetMinutes: 780, NewOffset: "+13:00", Note: "test",
	}}
	w, ok := occWarning(o, rules, map[string]bool{})
	if !ok {
		t.Fatalf("expected warning")
	}
	if w.ShiftMinutes != 60 {
		t.Errorf("shift = %d want 60", w.ShiftMinutes)
	}
	if w.SavedTime != "10:00" || w.ShownTime != "11:00" {
		t.Errorf("saved=%s shown=%s", w.SavedTime, w.ShownTime)
	}
}

func TestZoneRuleShiftWeeklySeasons(t *testing.T) {
	// Hana's Focus time at 09:00 Mondays Auckland
	o := func(d string) *Occurrence {
		return &Occurrence{Zone: "Pacific/Auckland", StartDate: d, StartMinutes: 540, AllDay: false}
	}
	rules := []*ZoneRule{{
		ID: "r1", Zone: "Pacific/Auckland", EffectiveDate: "2026-06-01",
		OffsetMinutes: 780, NewOffset: "+13:00", Note: "test",
	}}
	cases := []struct {
		date  string
		shift int
	}{
		{"2027-03-29", 0},
		{"2027-04-19", 60},
		{"2027-12-06", 0},
	}
	for _, c := range cases {
		w, ok := occWarning(o(c.date), rules, map[string]bool{})
		if c.shift == 0 {
			if ok && w.ShiftMinutes != 0 {
				t.Errorf("%s: unexpected warning %+v", c.date, w)
			}
		} else {
			if !ok {
				t.Errorf("%s: expected warning", c.date)
				continue
			}
			if w.ShiftMinutes != c.shift {
				t.Errorf("%s: shift=%d want %d", c.date, w.ShiftMinutes, c.shift)
			}
		}
	}
}

func TestOffsetParse(t *testing.T) {
	if n, _ := ParseOffsetMinutes("+13:00"); n != 780 {
		t.Errorf("+13:00 = %d", n)
	}
	if n, _ := ParseOffsetMinutes("-04:30"); n != -270 {
		t.Errorf("-04:30 = %d", n)
	}
	if _, ok := ParseOffsetMinutes("13:00"); ok {
		t.Errorf("13:00 accepted")
	}
	if _, ok := ParseOffsetMinutes("+13:07"); ok {
		t.Errorf("odd minutes accepted")
	}
}
