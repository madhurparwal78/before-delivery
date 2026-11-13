package main

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// seed.go — the seed loads once into an empty database and is never
// duplicated.

const seedPasscode = "wren-seed-2027"

type seedPerson struct {
	id, first, last, office, zone, role string
}

var seedPeople = []seedPerson{
	{"p-marit", "marit", "Holloway", "London", "Europe/London", "office_manager"},
	{"p-ines", "ines", "Okafor", "London", "Europe/London", "member"},
	{"p-edith", "edith", "Sarr", "London", "Europe/London", "member"},
	{"p-rafe", "rafe", "Moncrieff", "London", "Europe/London", "member"},
	{"p-yuki", "yuki", "Tamblyn", "London", "Europe/London", "member"},
	{"p-dara", "dara", "Kessler", "New York", "America/New_York", "member"},
	{"p-joss", "joss", "Abernathy", "New York", "America/New_York", "member"},
	{"p-priya", "priya", "Venn", "New York", "America/New_York", "member"},
	{"p-callum", "callum", "Reyes", "New York", "America/New_York", "member"},
	{"p-noor", "noor", "Lindqvist", "New York", "America/New_York", "member"},
	{"p-tane", "tane", "Whitcombe", "Auckland", "Pacific/Auckland", "member"},
	{"p-hana", "hana", "Rewiti", "Auckland", "Pacific/Auckland", "member"},
	{"p-oren", "oren", "Castell", "Auckland", "Pacific/Auckland", "member"},
	{"p-lia", "lia", "Fenwick", "Auckland", "Pacific/Auckland", "member"},
	{"p-sam", "sam", "Aldous", "New York", "America/New_York", "guest"},
	{"p-bea", "bea", "Marchetti", "London", "Europe/London", "guest"},
}

var calendarColours = map[string]string{
	"cal-marit": "mauve", "cal-ines": "teal", "cal-edith": "rose", "cal-rafe": "indigo",
	"cal-yuki": "amber", "cal-dara": "plum", "cal-joss": "teal", "cal-priya": "rose",
	"cal-callum": "indigo", "cal-noor": "amber", "cal-tane": "plum", "cal-hana": "mauve",
	"cal-oren": "rose", "cal-lia": "teal", "cal-firm": "plum", "cal-holidays": "mauve",
}

// ApplySeed inserts the seed data when the database is empty, and never
// otherwise.
func (s *Store) ApplySeed(ctx context.Context) error {
	var n int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM people`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	return s.Tx(ctx, func(tx pgx.Tx) error { return seedInsert(ctx, tx) })
}

func seedInsert(ctx context.Context, tx pgx.Tx) error {
	fullNames := map[string]string{}
	for _, p := range seedPeople {
		name := personName(p.first, p.last)
		fullNames[p.id] = name
		if _, err := tx.Exec(ctx, `INSERT INTO people (id, name, email, passcode, role, office, zone)
		  VALUES ($1,$2,$3,$4,$5,$6,$7)`, p.id, name, p.first+"@sundialwren.example", seedPasscode, p.role, p.office, p.zone); err != nil {
			return err
		}
	}
	// calendars
	cals := []struct{ id, name, owner string }{
		{"cal-firm", "Firm calendar", "p-marit"},
		{"cal-holidays", "Public holidays", ""},
	}
	for _, p := range seedPeople {
		if p.role == "guest" {
			continue
		}
		cals = append(cals, struct{ id, name, owner string }{
			"cal-" + p.id[2:], fullNames[p.id], p.id,
		})
	}
	for _, c := range cals {
		var owner *string
		if c.owner != "" {
			owner = &c.owner
		}
		colour := calendarColours[c.id]
		readonly := c.id == "cal-holidays"
		if _, err := tx.Exec(ctx, `INSERT INTO calendars (id, name, owner_id, colour, readonly)
		  VALUES ($1,$2,$3,$4,$5)`, c.id, c.name, owner, colour, readonly); err != nil {
			return err
		}
	}
	// office hours: every office 09:00 to 17:30 Monday to Friday
	for _, z := range zones {
		days := []int{1, 2, 3, 4, 5}
		if _, err := tx.Exec(ctx, `INSERT INTO office_hours (zone, open, close, days) VALUES ($1,'09:00','17:30',$2)`,
			z.Name, days); err != nil {
			return err
		}
	}
	// guest defaults: all off
	if _, err := tx.Exec(ctx, `INSERT INTO guest_defaults (id, modify_event, invite_others, see_guest_list)
	  VALUES (1, false, false, false)`); err != nil {
		return err
	}
	// shares
	shares := []struct{ cal, person, level string }{
		// cal-firm: all 13 other staff details
		{"cal-firm", "p-ines", "details"}, {"cal-firm", "p-edith", "details"},
		{"cal-firm", "p-rafe", "details"}, {"cal-firm", "p-yuki", "details"},
		{"cal-firm", "p-dara", "details"}, {"cal-firm", "p-joss", "details"},
		{"cal-firm", "p-priya", "details"}, {"cal-firm", "p-callum", "details"},
		{"cal-firm", "p-noor", "details"}, {"cal-firm", "p-tane", "details"},
		{"cal-firm", "p-hana", "details"}, {"cal-firm", "p-oren", "details"},
		{"cal-firm", "p-lia", "details"},
		{"cal-dara", "p-marit", "details"}, {"cal-dara", "p-ines", "edit"},
		{"cal-dara", "p-joss", "free_busy"}, {"cal-dara", "p-priya", "manage"},
		{"cal-ines", "p-marit", "details"}, {"cal-ines", "p-dara", "edit"},
		{"cal-tane", "p-hana", "details"}, {"cal-tane", "p-ines", "free_busy"},
		{"cal-oren", "p-marit", "edit"}, {"cal-lia", "p-marit", "edit"},
	}
	for _, sh := range shares {
		if _, err := tx.Exec(ctx, `INSERT INTO shares (calendar_id, person_id, level) VALUES ($1,$2,$3)`,
			sh.cal, sh.person, sh.level); err != nil {
			return err
		}
	}
	// events
	type ev struct {
		id, title, cal, organiser, kind, zone string
		allDay                                bool
		startDate, endDate                    string
		startMins, endMins                    int
		rrule                                 *string
		visibility, colour                    string
		savedAt                               string
		declineMode                           *string
		location, notes                       string
		switches                              *EventSwitches
	}
	strp := func(s string) *string { return &s }
	weeklyTu := "FREQ=WEEKLY;BYDAY=TU"
	events := []ev{
		{"evt-partners-weekly", "Partners' weekly", "cal-dara", "p-dara", "event", "America/New_York",
			false, "2026-09-01", "", 540, 600, &weeklyTu, "default", "", "2026-08-20T10:00:00Z",
			nil, "", "", &EventSwitches{false, false, true}},
		{"evt-client-readout", "Client readout", "cal-dara", "p-dara", "event", "America/New_York",
			false, "2026-10-06", "", 690, 750, nil, "default", "", "2026-08-20T10:00:00Z",
			nil, "", "", nil},
		{"evt-board-review", "Northgate board review", "cal-ines", "p-ines", "event", "Europe/London",
			false, "2027-03-10", "", 900, 960, nil, "default", "", "2026-08-20T10:00:00Z",
			nil, "Northgate House", "", &EventSwitches{false, false, false}},
		{"evt-harbour-kickoff", "Harbour kickoff", "cal-tane", "p-tane", "event", "Pacific/Auckland",
			false, "2027-03-11", "", 600, 660, nil, "default", "", "2026-08-20T10:00:00Z",
			nil, "", "", &EventSwitches{true, false, true}},
		{"evt-pay-talk", "Partner pay talk", "cal-dara", "p-dara", "event", "America/New_York",
			false, "2027-03-11", "", 840, 870, nil, "private", "", "2026-08-20T10:00:00Z",
			nil, "", "Confidential", nil},
		{"evt-sunday-check", "Sunday markets check", "cal-joss", "p-joss", "event", "America/New_York",
			false, "2027-03-07", "", 150, 180, strp("FREQ=WEEKLY;COUNT=4"), "default", "", "2026-08-20T10:00:00Z",
			nil, "", "", nil},
		{"evt-month-end", "Month-end close", "cal-marit", "p-marit", "event", "Europe/London",
			false, "2027-01-31", "", 960, 1020, strp("FREQ=MONTHLY"), "default", "", "2026-08-20T10:00:00Z",
			nil, "", "", nil},
		{"evt-founders-day", "Founders' day", "cal-firm", "p-marit", "event", "Europe/London",
			true, "2028-02-29", "2028-02-29", 0, 0, strp("FREQ=YEARLY"), "default", "", "2026-08-20T10:00:00Z",
			nil, "", "", nil},
		{"evt-london-offsite", "London offsite", "cal-firm", "p-marit", "event", "Europe/London",
			true, "2027-03-12", "2027-03-12", 0, 0, nil, "default", "", "2026-08-20T10:00:00Z",
			nil, "", "", nil},
		{"evt-tane-away", "Out of office", "cal-tane", "p-tane", "out_of_office", "Pacific/Auckland",
			true, "2027-03-15", "2027-03-19", 0, 0, nil, "default", "", "2026-08-20T10:00:00Z",
			nil, "", "", nil},
		{"evt-hana-focus", "Focus time", "cal-hana", "p-hana", "focus", "Pacific/Auckland",
			false, "2027-03-01", "", 540, 720, strp("FREQ=WEEKLY"), "default", "", "2026-08-20T10:00:00Z",
			strp("new_and_existing"), "", "", nil},
		{"evt-wellington-workshop", "Wellington workshop", "cal-oren", "p-oren", "event", "Pacific/Auckland",
			false, "2027-04-20", "", 600, 720, nil, "default", "", "2026-08-01T10:00:00Z",
			nil, "", "", nil},
		{"evt-queen-street", "Queen Street review", "cal-lia", "p-lia", "event", "Pacific/Auckland",
			false, "2027-04-21", "", 600, 660, nil, "default", "", "2026-03-01T10:00:00Z",
			nil, "", "", nil},
		{"hol-christmas", "Christmas Day", "cal-holidays", "p-marit", "event", "Europe/London",
			true, "2026-12-25", "2026-12-25", 0, 0, nil, "default", "", "2026-08-20T10:00:00Z",
			nil, "", "", nil},
		{"hol-new-year", "New Year's Day", "cal-holidays", "p-marit", "event", "Europe/London",
			true, "2027-01-01", "2027-01-01", 0, 0, nil, "default", "", "2026-08-20T10:00:00Z",
			nil, "", "", nil},
		{"hol-good-friday", "Good Friday", "cal-holidays", "p-marit", "event", "Europe/London",
			true, "2027-03-26", "2027-03-26", 0, 0, nil, "default", "", "2026-08-20T10:00:00Z",
			nil, "", "", nil},
	}
	for _, e := range events {
		endDate, endMins := e.endDate, e.endMins
		if !e.allDay && endDate == "" {
			endDate = e.startDate
		}
		if e.allDay {
			endMins = 0
		}
		savedAt, _ := time.Parse("2006-01-02T15:04:05Z", e.savedAt)
		savedDate := e.savedAt[:10]
		if _, err := tx.Exec(ctx, `INSERT INTO events (id, calendar_id, organiser_id, title, location, notes,
		  kind, colour, all_day, start_date, start_minutes, end_date, end_minutes, zone, visibility,
		  rrule, decline_mode, decline_message, saved_at, saved_date, version)
		  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,1)`,
			e.id, e.cal, e.organiser, e.title, e.location, e.notes, e.kind,
			e.colour, e.allDay, e.startDate, e.startMins, endDate, endMins, e.zone,
			e.visibility, e.rrule, e.declineMode, nil, savedAt, savedDate); err != nil {
			return err
		}
		if e.switches != nil {
			if _, err := tx.Exec(ctx, `INSERT INTO switches (event_id, modify_event, invite_others, see_guest_list)
			  VALUES ($1,$2,$3,$4)`, e.id, e.switches.ModifyEvent, e.switches.InviteOthers, e.switches.SeeGuestList); err != nil {
				return err
			}
		}
	}
	// Partners' weekly guests and answers
	pwGuests := []struct{ person, answer string }{
		{"p-ines", "yes"}, {"p-tane", "maybe"}, {"p-marit", "invited"},
	}
	for _, g := range pwGuests {
		if _, err := tx.Exec(ctx, `INSERT INTO guests (event_id, person_id, series_answer) VALUES ('evt-partners-weekly',$1,$2)`,
			g.person, g.answer); err != nil {
			return err
		}
	}
	// Exceptions for Partners' weekly:
	// 23 Mar 2027 at 10:00 to 11:00 (moved)
	occ23 := "evt-partners-weekly@20270323T0900"
	if _, err := tx.Exec(ctx, `INSERT INTO exceptions (event_id, occurrence_id, deleted, start_date, start_minutes, end_date, end_minutes)
	  VALUES ('evt-partners-weekly', $1, false, '2027-03-23', 600, '2027-03-23', 660)`, occ23); err != nil {
		return err
	}
	// 13 Apr 2027 deleted
	occ13 := "evt-partners-weekly@20270413T0900"
	if _, err := tx.Exec(ctx, `INSERT INTO exceptions (event_id, occurrence_id, deleted)
	  VALUES ('evt-partners-weekly', $1, true)`, occ13); err != nil {
		return err
	}
	// Tane 'no' for 16 Mar 2027 with the out-of-office message
	occ16 := "evt-partners-weekly@20270316T0900"
	if _, err := tx.Exec(ctx, `INSERT INTO replies (event_id, person_id, occurrence_id, answer, message)
	  VALUES ('evt-partners-weekly','p-tane',$1,'no','Tane Whitcombe is out of office until 19 Mar 2027, so this was declined automatically.')`, occ16); err != nil {
		return err
	}
	// Northgate board review guests: the loop above already wrote its switches
	for _, g := range []string{"p-sam", "p-bea", "p-hana"} {
		if _, err := tx.Exec(ctx, `INSERT INTO guests (event_id, person_id) VALUES ('evt-board-review',$1)`, g); err != nil {
			return err
		}
	}
	// Harbour kickoff guests: Sam, Oren
	for _, g := range []string{"p-sam", "p-oren"} {
		if _, err := tx.Exec(ctx, `INSERT INTO guests (event_id, person_id) VALUES ('evt-harbour-kickoff',$1)`, g); err != nil {
			return err
		}
	}
	// shared link token seed-harbour-link, expires well after seed dates
	if _, err := tx.Exec(ctx, `INSERT INTO share_links (event_id, token, expires_at)
	  VALUES ('evt-harbour-kickoff','seed-harbour-link', $1)`, time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC)); err != nil {
		return err
	}
	// London offsite guests: Dara, Tane, Ines
	for _, g := range []string{"p-dara", "p-tane", "p-ines"} {
		if _, err := tx.Exec(ctx, `INSERT INTO guests (event_id, person_id) VALUES ('evt-london-offsite',$1)`, g); err != nil {
			return err
		}
	}
	return nil
}

func personName(first, last string) string {
	return strings.ToUpper(first[:1]) + first[1:] + " " + last
}
