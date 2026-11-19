package clockx

import (
	"testing"
	"time"
)

func TestResolveLocalDST(t *testing.T) {
	zone, err := LoadZone("America/Chicago")
	if err != nil {
		t.Fatalf("load zone: %v", err)
	}
	cases := []struct {
		name       string
		y          int
		m          time.Month
		d, hh, mi  int
		wantUTC    string
		wantLocal  string
		wantNote   DSTNote
		wantAbbr   string
		wantOffset string
	}{
		{"seeded friday siege", 2026, 11, 13, 20, 0, "2026-11-14T02:00:00Z", "20:00", NoteNone, "CST", "-06:00"},
		{"skipped hour shifts forward", 2027, 3, 14, 2, 30, "2027-03-14T08:30:00Z", "03:30", NoteShiftedForward, "CDT", "-05:00"},
		{"repeated hour takes first", 2027, 11, 7, 1, 30, "2027-11-07T06:30:00Z", "01:30", NoteFirstOccurrence, "CDT", "-05:00"},
		{"wall time holds across spring forward", 2027, 3, 19, 20, 0, "2027-03-20T01:00:00Z", "20:00", NoteNone, "CDT", "-05:00"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			inst, local, note := ResolveLocal(zone, c.y, c.m, c.d, c.hh, c.mi, 0)
			if got := inst.Format(time.RFC3339); got != c.wantUTC {
				t.Errorf("instant = %s, want %s", got, c.wantUTC)
			}
			if got := local.Format("15:04"); got != c.wantLocal {
				t.Errorf("local = %s, want %s", got, c.wantLocal)
			}
			if note != c.wantNote {
				t.Errorf("note = %q, want %q", note, c.wantNote)
			}
			if got := Abbr(inst, zone); got != c.wantAbbr {
				t.Errorf("abbr = %s, want %s", got, c.wantAbbr)
			}
			if got := Offset(inst, zone); got != c.wantOffset {
				t.Errorf("offset = %s, want %s", got, c.wantOffset)
			}
		})
	}
}

func TestClockOverrideKeepsRunning(t *testing.T) {
	zone, _ := LoadZone("America/Chicago")
	c := New(zone)
	if c.Overridden() {
		t.Fatal("a fresh clock is not overridden")
	}
	target := time.Date(2026, 11, 13, 19, 0, 0, 0, time.UTC)
	c.Set(target)
	if !c.Overridden() {
		t.Fatal("clock reports the override")
	}
	first := c.Now()
	if d := first.Sub(target); d < 0 || d > time.Second {
		t.Fatalf("clock starts at the override, got %s", first)
	}
	time.Sleep(30 * time.Millisecond)
	if second := c.Now(); !second.After(first) {
		t.Fatal("overridden clock keeps running")
	}
	c.Clear()
	if c.Overridden() {
		t.Fatal("cleared clock is not overridden")
	}
}
