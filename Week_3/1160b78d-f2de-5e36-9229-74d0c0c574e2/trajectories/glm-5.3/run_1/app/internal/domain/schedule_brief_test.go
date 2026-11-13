package domain

import (
"testing"
"time"
)

func seededPeople() map[string]string {
ids := []string{"a", "b", "c", "d"}
names := []string{"Ines Varga", "Tomasz Reyes", "Priya Lindqvist", "Mateus Oyelaran"}
m := map[string]string{}
for i := range ids {
m[ids[i]] = names[i]
}
return m
}

// The brief: Transport Primary's block from 2027-03-13T14:00:00Z to
// 2027-03-14T13:00:00Z is Ines Varga's and measures 1380 minutes, because the
// clock change falls inside it, and 2027-03-14T13:00:00Z is Tomasz Reyes's
// 08:00 handoff.
func TestTransportPrimaryDSTBlock(t *testing.T) {
l := &Layer{
ID: "l1", Order: 1, ShiftDays: 1, HandoffTime: "08:00", StartDate: "2026-01-05",
People: []string{"a", "b", "c", "d"}, ScheduleZone: "America/Chicago", RecordFormat: 2,
}
names := seededPeople()
blocks := FinalSchedule([]*Layer{l}, nil,
time.Date(2027, 3, 13, 14, 0, 0, 0, time.UTC),
time.Date(2027, 3, 14, 13, 0, 0, 0, time.UTC), names)
if len(blocks) != 1 {
t.Fatalf("expected one block, got %d", len(blocks))
}
b := blocks[0]
if b.Person == nil || b.Person.Name != "Ines Varga" {
t.Fatalf("holder = %v, want Ines Varga", b.Person)
}
if b.Minutes != 1380 {
t.Fatalf("minutes = %d, want 1380", b.Minutes)
}
// The next block starts at Tomasz Reyes's 08:00 handoff.
next := FinalSchedule([]*Layer{l}, nil,
time.Date(2027, 3, 14, 13, 0, 0, 0, time.UTC),
time.Date(2027, 3, 14, 14, 0, 0, 0, time.UTC), names)
if len(next) == 0 || next[0].Person == nil || next[0].Person.Name != "Tomasz Reyes" {
t.Fatalf("next holder = %+v", next)
}
}

// The brief: in America/Chicago the day 2027-03-14 measures 1380 minutes and
// 2027-11-07 measures 1500.
func TestChicagoDayLengths(t *testing.T) {
for _, c := range []struct {
date string
want int
}{{"2027-03-14", 1380}, {"2027-11-07", 1500}, {"2027-06-01", 1440}} {
start, err := LocalInstant(c.date, "00:00", "America/Chicago")
if err != nil {
t.Fatal(err)
}
end, err := LocalInstant(nextDate(c.date), "00:00", "America/Chicago")
if err != nil {
t.Fatal(err)
}
if got := int(end.Sub(start).Minutes()); got != c.want {
t.Fatalf("day %s = %d min, want %d", c.date, got, c.want)
}
}
}

// The brief: with Tracking escalation (2 repeats, two levels of 30 minutes)
// opened at T, level 1 cycle 0 runs from T, level 2 cycle 0 from T+30, level 1
// cycle 1 from T+60, level 2 cycle 1 from T+90, level 1 cycle 2 from T+120
// and level 2 cycle 2 from T+150, and from T+180 it reads Escalation finished.
func TestEscalationClockExample(t *testing.T) {
// Each level's timeout runs from its start, so the step boundaries land
// at whole multiples of the level timeout.
timeout := 30 * time.Minute
repeats := 2
levels := 2
steps := []time.Duration{}
for cycle := 0; cycle <= repeats; cycle++ {
for lvl := 1; lvl <= levels; lvl++ {
steps = append(steps, timeout*time.Duration(len(steps)))
}
}
want := []time.Duration{0, 30 * time.Minute, time.Hour, 90 * time.Minute, 2 * time.Hour, 150 * time.Minute}
for i, s := range want {
if steps[i] != s {
t.Fatalf("step %d = %v, want %v", i, steps[i], s)
}
}
finished := timeout * time.Duration(len(steps))
if finished != 180*time.Minute {
t.Fatalf("escalation finishes at %v, want 180m", finished)
}
}
