package main

import (
	"slices"
	"testing"
	"time"
)

func testConfig(t *testing.T) *config {
	t.Helper()
	loc, err := time.LoadLocation("Europe/Madrid")
	if err != nil {
		t.Fatal(err)
	}
	return &config{Location: loc, OpenMinute: 8 * 60, CloseMinute: 23 * 60, SlotStepMinutes: 30}
}

func TestSafeReturnPath(t *testing.T) {
	cases := map[string]bool{
		"/":                                   true,
		"/courts?day=2027-03-28&cell=3-18:00": true,
		"/share/abc":                          true,
		"":                                    false,
		"courts":                              false,
		"//evil.example":                      false,
		"/\\evil.example":                     false,
		"/%2F%2Fevil.example":                 false,
		"/%5Cevil":                            false,
		"/a\\b":                               false,
		"/a%0Ab":                              false,
		"/a\x7fb":                             false,
		"https://evil.example/":               false,
		"/%2fevil":                            false,
		"/%252F%252Fevil.example":             true,
	}
	for in, want := range cases {
		if got := safeReturnPath(in); got != want {
			t.Errorf("safeReturnPath(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestSplitShares(t *testing.T) {
	if got := splitShares(4801, 4); !slices.Equal(got, []int{1201, 1200, 1200, 1200}) {
		t.Errorf("4801 split %v", got)
	}
	if got := splitShares(4803, 4); !slices.Equal(got, []int{1203, 1200, 1200, 1200}) {
		t.Errorf("4803 split %v", got)
	}
	if got := splitShares(2401, 2); !slices.Equal(got, []int{1201, 1200}) {
		t.Errorf("lesson split %v", got)
	}
}

func TestLateFee(t *testing.T) {
	if got := lateFee(1201, 50); got != 600 {
		t.Errorf("late fee %d", got)
	}
}

func TestPriceSlot(t *testing.T) {
	c := testConfig(t)
	v := pricingVersion{Version: 1, Offpeak: 40, Peak: 60, PeakStart: "17:00", PeakEnd: "22:00",
		PeakDays: []string{"mon", "tue", "wed", "thu", "fri"}}
	friday, _ := c.wallTime(clubDate{time.Date(2027, 3, 26, 0, 0, 0, 0, time.UTC)}, 16*60+30)
	if p := c.priceSlot(v, friday, 90); p.Total != 4800 || p.PeakMinutes != 60 || p.OffpeakMinutes != 30 {
		t.Errorf("weekday price %+v", p)
	}
	saturday, _ := c.wallTime(clubDate{time.Date(2027, 3, 27, 0, 0, 0, 0, time.UTC)}, 16*60+30)
	if p := c.priceSlot(v, saturday, 90); p.Total != 3600 {
		t.Errorf("saturday price %+v", p)
	}
}

func TestWallTimeAndSlots(t *testing.T) {
	c := testConfig(t)
	spring := clubDate{time.Date(2027, 3, 28, 0, 0, 0, 0, time.UTC)}
	if s, ok := c.slotStart(spring, 8*60, 60); !ok || utcStamp(s) != "2027-03-28T06:00:00.000Z" {
		t.Errorf("spring 08:00 = %v %v", s, ok)
	}
	day := clubDate{time.Date(2027, 3, 27, 0, 0, 0, 0, time.UTC)}
	if s, _ := c.slotStart(day, 8*60, 60); utcStamp(s) != "2027-03-27T07:00:00.000Z" {
		t.Errorf("27th 08:00 = %v", s)
	}
	if _, ok := c.wallTime(spring, 2*60+30); ok {
		t.Error("02:30 on the spring change must not exist")
	}
	autumn := clubDate{time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC)}
	if s, ok := c.wallTime(autumn, 2*60+30); !ok || utcStamp(s) != "2026-10-25T00:30:00.000Z" {
		t.Errorf("repeated hour should be its earlier occurrence: %v", s)
	}
	if _, ok := c.slotStart(day, 8*60+15, 60); ok {
		t.Error("off-step start accepted")
	}
	if _, ok := c.slotStart(day, 22*60+30, 60); ok {
		t.Error("slot past closing accepted")
	}
	if _, ok := c.slotStart(day, 22*60, 60); !ok {
		t.Error("last slot refused")
	}
}

func TestWeeklyRepeatKeepsWallTime(t *testing.T) {
	c := testConfig(t)
	monday := clubDate{time.Date(2027, 3, 22, 0, 0, 0, 0, time.UTC)}
	first, _ := c.weeklyRepeat(monday, 10*60, 0, 60)
	second, _ := c.weeklyRepeat(monday, 10*60, 1, 60)
	if utcStamp(first) != "2027-03-22T09:00:00.000Z" || utcStamp(second) != "2027-03-29T08:00:00.000Z" {
		t.Errorf("series starts %s %s", utcStamp(first), utcStamp(second))
	}
}

func TestStoredAnswer(t *testing.T) {
	for _, tc := range []struct {
		status int
		err    error
		want   bool
	}{
		{201, nil, true},
		{200, nil, true},
		{0, fail("PAYMENT_DECLINED"), true},
		{0, fail("SLOT_TAKEN"), true},
		{0, fail("PAYMENT_NOT_CONFIRMED"), true},
		{0, fail("PAYMENT_UNAVAILABLE"), false},
		{0, fail("IDEMPOTENCY_CONFLICT"), false},
		{0, fail("VALIDATION"), false},
		{0, fail("NOT_FOUND"), false},
		{0, fail("RATE_LIMITED"), false},
	} {
		if got := storedAnswer(tc.status, tc.err); got != tc.want {
			t.Errorf("storedAnswer(%d, %v) = %v", tc.status, tc.err, got)
		}
	}
}
