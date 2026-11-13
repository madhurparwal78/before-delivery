package store

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"sundialwren/internal/domain"
)

// Passcode is the one seeded passcode.
const Passcode = "wren-seed-2027"

type seedPerson struct {
	first string
	last  string
	zone  string
	role  string
}

var seedPeople = []seedPerson{
	{"Marit", "Holloway", domain.ZoneLondon, domain.RoleOfficeManager},
	{"Ines", "Okafor", domain.ZoneLondon, domain.RoleMember},
	{"Edith", "Sarr", domain.ZoneLondon, domain.RoleMember},
	{"Rafe", "Moncrieff", domain.ZoneLondon, domain.RoleMember},
	{"Yuki", "Tamblyn", domain.ZoneLondon, domain.RoleMember},
	{"Dara", "Kessler", domain.ZoneNewYork, domain.RoleMember},
	{"Joss", "Abernathy", domain.ZoneNewYork, domain.RoleMember},
	{"Priya", "Venn", domain.ZoneNewYork, domain.RoleMember},
	{"Callum", "Reyes", domain.ZoneNewYork, domain.RoleMember},
	{"Noor", "Lindqvist", domain.ZoneNewYork, domain.RoleMember},
	{"Tane", "Whitcombe", domain.ZoneAuckland, domain.RoleMember},
	{"Hana", "Rewiti", domain.ZoneAuckland, domain.RoleMember},
	{"Oren", "Castell", domain.ZoneAuckland, domain.RoleMember},
	{"Lia", "Fenwick", domain.ZoneAuckland, domain.RoleMember},
	{"Sam", "Aldous", domain.ZoneNewYork, domain.RoleGuest},
	{"Bea", "Marchetti", domain.ZoneLondon, domain.RoleGuest},
}

// EventColours are the published colour choices a calendar chip may carry.
var EventColours = []string{"Rose", "Amber", "Teal", "Indigo"}

type seedEvent struct {
	id            string
	title         string
	calendar      string
	kind          string
	allDay        bool
	start, end    string
	zone          string
	rrule         string
	location      string
	notes         string
	visibility    string
	declineMode   string
	switches      domain.Switches
	guests        []string
	savedAt       string
	shareToken    string
	seriesAnswers map[string]string
}

var seedEvents = []seedEvent{
	{
		id: "evt-partners-weekly", title: "Partners' weekly", calendar: "cal-dara", kind: domain.KindEvent,
		start: "2026-09-01T09:00", end: "2026-09-01T10:00", zone: domain.ZoneNewYork,
		rrule: "FREQ=WEEKLY;BYDAY=TU", switches: domain.Switches{SeeGuestList: true},
		guests:  []string{"p-ines", "p-tane", "p-marit"},
		savedAt: "2026-08-20",
		seriesAnswers: map[string]string{
			"p-ines": domain.AnswerYes, "p-tane": domain.AnswerMaybe, "p-marit": domain.AnswerInvited,
		},
	},
	{
		id: "evt-client-readout", title: "Client readout", calendar: "cal-dara", kind: domain.KindEvent,
		start: "2026-10-06T11:30", end: "2026-10-06T12:30", zone: domain.ZoneNewYork, savedAt: "2026-08-20",
	},
	{
		id: "evt-board-review", title: "Northgate board review", calendar: "cal-ines", kind: domain.KindEvent,
		start: "2027-03-10T15:00", end: "2027-03-10T16:00", zone: domain.ZoneLondon,
		location: "Northgate House", guests: []string{"p-sam", "p-bea", "p-hana"}, savedAt: "2026-08-20",
	},
	{
		id: "evt-harbour-kickoff", title: "Harbour kickoff", calendar: "cal-tane", kind: domain.KindEvent,
		start: "2027-03-11T10:00", end: "2027-03-11T11:00", zone: domain.ZoneAuckland,
		switches: domain.Switches{ModifyEvent: true, SeeGuestList: true},
		guests:   []string{"p-sam", "p-oren"}, savedAt: "2026-08-20", shareToken: "seed-harbour-link",
	},
	{
		id: "evt-pay-talk", title: "Partner pay talk", calendar: "cal-dara", kind: domain.KindEvent,
		start: "2027-03-11T14:00", end: "2027-03-11T14:30", zone: domain.ZoneNewYork,
		notes: "Confidential", visibility: domain.VisibilityPrivate, savedAt: "2026-08-20",
	},
	{
		id: "evt-sunday-check", title: "Sunday markets check", calendar: "cal-joss", kind: domain.KindEvent,
		start: "2027-03-07T02:30", end: "2027-03-07T03:00", zone: domain.ZoneNewYork,
		rrule: "FREQ=WEEKLY;COUNT=4", savedAt: "2026-08-20",
	},
	{
		id: "evt-month-end", title: "Month-end close", calendar: "cal-marit", kind: domain.KindEvent,
		start: "2027-01-31T16:00", end: "2027-01-31T17:00", zone: domain.ZoneLondon,
		rrule: "FREQ=MONTHLY", savedAt: "2026-08-20",
	},
	{
		id: "evt-founders-day", title: "Founders' day", calendar: "cal-firm", kind: domain.KindEvent,
		allDay: true, start: "2028-02-29", end: "2028-02-29", zone: domain.ZoneLondon,
		rrule: "FREQ=YEARLY", savedAt: "2026-08-20",
	},
	{
		id: "evt-london-offsite", title: "London offsite", calendar: "cal-firm", kind: domain.KindEvent,
		allDay: true, start: "2027-03-12", end: "2027-03-12", zone: domain.ZoneLondon,
		guests: []string{"p-dara", "p-tane", "p-ines"}, savedAt: "2026-08-20",
	},
	{
		id: "evt-tane-away", title: "Out of office", calendar: "cal-tane", kind: domain.KindOutOfOffice,
		allDay: true, start: "2027-03-15", end: "2027-03-19", zone: domain.ZoneAuckland, savedAt: "2026-08-20",
	},
	{
		id: "evt-hana-focus", title: "Focus time", calendar: "cal-hana", kind: domain.KindFocusTime,
		start: "2027-03-01T09:00", end: "2027-03-01T12:00", zone: domain.ZoneAuckland,
		rrule: "FREQ=WEEKLY", declineMode: domain.DeclineNewAndExisting, savedAt: "2026-08-20",
	},
	{
		id: "evt-wellington-workshop", title: "Wellington workshop", calendar: "cal-oren", kind: domain.KindEvent,
		start: "2027-04-20T10:00", end: "2027-04-20T12:00", zone: domain.ZoneAuckland, savedAt: "2026-08-01",
	},
	{
		id: "evt-queen-street", title: "Queen Street review", calendar: "cal-lia", kind: domain.KindEvent,
		start: "2027-04-21T10:00", end: "2027-04-21T11:00", zone: domain.ZoneAuckland, savedAt: "2026-03-01",
	},
	{
		id: "hol-christmas", title: "Christmas Day", calendar: domain.HolidaysCalendarID, kind: domain.KindEvent,
		allDay: true, start: "2026-12-25", end: "2026-12-25", zone: domain.ZoneLondon, savedAt: "2026-08-20",
	},
	{
		id: "hol-new-year", title: "New Year's Day", calendar: domain.HolidaysCalendarID, kind: domain.KindEvent,
		allDay: true, start: "2027-01-01", end: "2027-01-01", zone: domain.ZoneLondon, savedAt: "2026-08-20",
	},
	{
		id: "hol-good-friday", title: "Good Friday", calendar: domain.HolidaysCalendarID, kind: domain.KindEvent,
		allDay: true, start: "2027-03-26", end: "2027-03-26", zone: domain.ZoneLondon, savedAt: "2026-08-20",
	},
}

var seedShares = []struct {
	calendar string
	person   string
	level    string
}{
	{"cal-dara", "p-marit", domain.LevelDetails},
	{"cal-dara", "p-ines", domain.LevelEdit},
	{"cal-dara", "p-joss", domain.LevelFreeBusy},
	{"cal-dara", "p-priya", domain.LevelManage},
	{"cal-ines", "p-marit", domain.LevelDetails},
	{"cal-ines", "p-dara", domain.LevelEdit},
	{"cal-tane", "p-hana", domain.LevelDetails},
	{"cal-tane", "p-ines", domain.LevelFreeBusy},
	{"cal-oren", "p-marit", domain.LevelEdit},
	{"cal-lia", "p-marit", domain.LevelEdit},
}

// Seed loads the published seed data once into an empty database. Every
// statement is written so a second serve changes nothing.
func (s *Store) Seed(ctx context.Context) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	for _, p := range seedPeople {
		first := strings.ToLower(p.first)
		_, err := tx.Exec(ctx, `INSERT INTO people (id, name, email, passcode, zone, role)
			VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
			"p-"+first, p.first+" "+p.last, first+"@sundialwren.example", Passcode, p.zone, p.role)
		if err != nil {
			return fmt.Errorf("seed person %s: %w", first, err)
		}
	}

	colour := 0
	for _, p := range seedPeople {
		if p.role == domain.RoleGuest {
			continue
		}
		first := strings.ToLower(p.first)
		_, err := tx.Exec(ctx, `INSERT INTO calendars (id, name, owner_id, colour)
			VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
			"cal-"+first, p.first+" "+p.last, "p-"+first, EventColours[colour%len(EventColours)])
		if err != nil {
			return err
		}
		colour++
	}
	if _, err := tx.Exec(ctx, `INSERT INTO calendars (id, name, owner_id, colour)
		VALUES ('cal-firm','Firm calendar','p-marit','Indigo') ON CONFLICT (id) DO NOTHING`); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO calendars (id, name, owner_id, colour, read_only)
		VALUES ($1,'Public holidays',NULL,'Teal',true) ON CONFLICT (id) DO NOTHING`, domain.HolidaysCalendarID); err != nil {
		return err
	}

	for _, p := range seedPeople {
		if p.role == domain.RoleGuest || p.first == "Marit" {
			continue
		}
		if _, err := tx.Exec(ctx, `INSERT INTO shares (calendar_id, person_id, level)
			VALUES ('cal-firm',$1,$2) ON CONFLICT DO NOTHING`, "p-"+strings.ToLower(p.first), domain.LevelDetails); err != nil {
			return err
		}
	}
	for _, sh := range seedShares {
		if _, err := tx.Exec(ctx, `INSERT INTO shares (calendar_id, person_id, level)
			VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, sh.calendar, sh.person, sh.level); err != nil {
			return err
		}
	}

	hours := map[string]domain.OfficeHours{}
	for _, zone := range []string{domain.ZoneNewYork, domain.ZoneLondon, domain.ZoneAuckland} {
		hours[zone] = domain.OfficeHours{Open: "09:00", Close: "17:30", Days: []int{1, 2, 3, 4, 5}}
	}
	defaults, _ := json.Marshal(domain.Switches{})
	officeHours, _ := json.Marshal(hours)
	if _, err := tx.Exec(ctx, `INSERT INTO firm_settings (id, guest_defaults, office_hours)
		VALUES (1,$1,$2) ON CONFLICT (id) DO NOTHING`, defaults, officeHours); err != nil {
		return err
	}

	for _, e := range seedEvents {
		var organiser *string
		if e.calendar != domain.HolidaysCalendarID {
			owner := "p-" + strings.TrimPrefix(e.calendar, "cal-")
			if e.calendar == "cal-firm" {
				owner = "p-marit"
			}
			organiser = &owner
		}
		savedAt, err := time.Parse(time.RFC3339, e.savedAt+"T12:00:00Z")
		if err != nil {
			return err
		}
		visibility := e.visibility
		if visibility == "" {
			visibility = domain.VisibilityDefault
		}
		switches, _ := json.Marshal(e.switches)
		_, err = tx.Exec(ctx, `INSERT INTO events
			(id, calendar_id, series_id, organiser_id, title, location, notes, kind, colour,
			 all_day, start_local, end_local, zone, visibility, rrule, decline_mode, switches, version, saved_at)
			VALUES ($1,$2,$1,$3,$4,$5,$6,$7,'Calendar colour',$8,$9,$10,$11,$12,$13,$14,$15,1,$16)
			ON CONFLICT (id) DO NOTHING`,
			e.id, e.calendar, organiser, e.title, e.location, e.notes, e.kind,
			e.allDay, e.start, e.end, e.zone, visibility, e.rrule, e.declineMode, switches, savedAt)
		if err != nil {
			return fmt.Errorf("seed event %s: %w", e.id, err)
		}
		for _, g := range e.guests {
			answer := domain.AnswerInvited
			if a, ok := e.seriesAnswers[g]; ok {
				answer = a
			}
			if _, err := tx.Exec(ctx, `INSERT INTO guests (event_id, person_id, answer)
				VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, e.id, g, answer); err != nil {
				return err
			}
		}
		if e.shareToken != "" {
			if _, err := tx.Exec(ctx, `INSERT INTO share_links (event_id, token, expires_at)
				VALUES ($1,$2,$3) ON CONFLICT (event_id) DO NOTHING`,
				e.id, e.shareToken, savedAt.AddDate(10, 0, 0)); err != nil {
				return err
			}
		}
	}

	// Partners' weekly carries one moved occurrence, one deleted occurrence and
	// one automatic decline from Tane Whitcombe's out-of-office week.
	moved := "2027-03-23T10:00"
	movedEnd := "2027-03-23T11:00"
	if _, err := tx.Exec(ctx, `INSERT INTO exceptions (event_id, occurrence_key, start_local, end_local)
		VALUES ('evt-partners-weekly','20270323T0900',$1,$2) ON CONFLICT DO NOTHING`, moved, movedEnd); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO exceptions (event_id, occurrence_key, deleted)
		VALUES ('evt-partners-weekly','20270413T0900',true) ON CONFLICT DO NOTHING`); err != nil {
		return err
	}
	declineMessage := "Tane Whitcombe is out of office until Fri 19 Mar 2027, so Partners' weekly was declined automatically."
	if _, err := tx.Exec(ctx, `INSERT INTO replies (event_id, occurrence_key, person_id, answer, message)
		VALUES ('evt-partners-weekly','20270316T0900','p-tane','no',$1) ON CONFLICT DO NOTHING`, declineMessage); err != nil {
		return err
	}

	return tx.Commit(ctx)
}
