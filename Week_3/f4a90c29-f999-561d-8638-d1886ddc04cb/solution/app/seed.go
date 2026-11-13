package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"strings"
	"time"

	"github.com/lib/pq"
)

// seedPasscodeDigest is the SHA-256 of the seeded people's published passcode; the source keeps no passcode.
const seedPasscodeDigest = "e68ba4121cfc4cfae6fc8b09bc6e8265cff4f5b544b4706ba83ae7c5ab1711b5"

// passcodeHash is the stored form of a passcode typed at sign-in.
func passcodeHash(personID, passcode string) string {
	digest := sha256.Sum256([]byte(passcode))
	return digestHash(personID, hex.EncodeToString(digest[:]))
}

// digestHash salts a passcode's SHA-256 with the person's id.
func digestHash(personID, digest string) string {
	sum := sha256.Sum256([]byte(personID + ":" + digest))
	return hex.EncodeToString(sum[:])
}

type seedPerson struct{ name, zone, role string }

var seedPeople = []seedPerson{
	{"Marit Holloway", zoneLondon, "office_manager"},
	{"Ines Okafor", zoneLondon, "member"}, {"Edith Sarr", zoneLondon, "member"}, {"Rafe Moncrieff", zoneLondon, "member"},
	{"Yuki Tamblyn", zoneLondon, "member"},
	{"Dara Kessler", zoneNewYork, "member"}, {"Joss Abernathy", zoneNewYork, "member"}, {"Priya Venn", zoneNewYork, "member"},
	{"Callum Reyes", zoneNewYork, "member"}, {"Noor Lindqvist", zoneNewYork, "member"},
	{"Tane Whitcombe", zoneAuckland, "member"}, {"Hana Rewiti", zoneAuckland, "member"}, {"Oren Castell", zoneAuckland, "member"},
	{"Lia Fenwick", zoneAuckland, "member"},
	{"Sam Aldous", zoneNewYork, "guest"}, {"Bea Marchetti", zoneLondon, "guest"},
}

func firstName(full string) string { return strings.ToLower(strings.Fields(full)[0]) }

type seedEvent struct {
	id, calendar, title, location, notes, kind, zone, start, end, rrule, visibility, saved string
	allDay                                                                                 bool
	switches                                                                               Switches
	guests                                                                                 []string
	declineMode                                                                            string
}

var seedEvents = []seedEvent{
	{id: "evt-partners-weekly", calendar: "cal-dara", title: "Partners' weekly", kind: "event", zone: zoneNewYork,
		start: at("2026-09-01", "09:00"), end: at("2026-09-01", "10:00"), rrule: "FREQ=WEEKLY;BYDAY=TU", saved: "2026-08-20",
		switches: Switches{SeeGuestList: true}, guests: []string{"p-ines", "p-tane", "p-marit"}},
	{id: "evt-client-readout", calendar: "cal-dara", title: "Client readout", kind: "event", zone: zoneNewYork,
		start: at("2026-10-06", "11:30"), end: at("2026-10-06", "12:30"), saved: "2026-08-20"},
	{id: "evt-board-review", calendar: "cal-ines", title: "Northgate board review", location: "Northgate House", kind: "event",
		zone: zoneLondon, start: at("2027-03-10", "15:00"), end: at("2027-03-10", "16:00"), saved: "2026-08-20",
		guests: []string{"p-sam", "p-bea", "p-hana"}},
	{id: "evt-harbour-kickoff", calendar: "cal-tane", title: "Harbour kickoff", kind: "event", zone: zoneAuckland,
		start: at("2027-03-11", "10:00"), end: at("2027-03-11", "11:00"), saved: "2026-08-20",
		switches: Switches{ModifyEvent: true, SeeGuestList: true}, guests: []string{"p-sam", "p-oren"}},
	{id: "evt-pay-talk", calendar: "cal-dara", title: "Partner pay talk", notes: "Confidential", kind: "event", zone: zoneNewYork,
		start: at("2027-03-11", "14:00"), end: at("2027-03-11", "14:30"), visibility: "private", saved: "2026-08-20"},
	{id: "evt-sunday-check", calendar: "cal-joss", title: "Sunday markets check", kind: "event", zone: zoneNewYork,
		start: at("2027-03-07", "02:30"), end: at("2027-03-07", "03:00"), rrule: "FREQ=WEEKLY;COUNT=4", saved: "2026-08-20"},
	{id: "evt-month-end", calendar: "cal-marit", title: "Month-end close", kind: "event", zone: zoneLondon,
		start: at("2027-01-31", "16:00"), end: at("2027-01-31", "17:00"), rrule: "FREQ=MONTHLY", saved: "2026-08-20"},
	{id: "evt-founders-day", calendar: "cal-firm", title: "Founders' day", kind: "event", zone: zoneLondon, allDay: true,
		start: "2028-02-29", end: "2028-02-29", rrule: "FREQ=YEARLY", saved: "2026-08-20"},
	{id: "evt-london-offsite", calendar: "cal-firm", title: "London offsite", kind: "event", zone: zoneLondon, allDay: true,
		start: "2027-03-12", end: "2027-03-12", saved: "2026-08-20", guests: []string{"p-dara", "p-tane", "p-ines"}},
	{id: "evt-tane-away", calendar: "cal-tane", title: "Out of office", kind: "out_of_office", zone: zoneAuckland, allDay: true,
		start: "2027-03-15", end: "2027-03-19", saved: "2026-08-20"},
	{id: "evt-hana-focus", calendar: "cal-hana", title: "Focus time", kind: "focus", zone: zoneAuckland,
		start: at("2027-03-01", "09:00"), end: at("2027-03-01", "12:00"), rrule: "FREQ=WEEKLY", saved: "2026-08-20", declineMode: "new_and_existing"},
	{id: "evt-wellington-workshop", calendar: "cal-oren", title: "Wellington workshop", kind: "event", zone: zoneAuckland,
		start: at("2027-04-20", "10:00"), end: at("2027-04-20", "12:00"), saved: "2026-08-01"},
	{id: "evt-queen-street", calendar: "cal-lia", title: "Queen Street review", kind: "event", zone: zoneAuckland,
		start: at("2027-04-21", "10:00"), end: at("2027-04-21", "11:00"), saved: "2026-03-01"},
	{id: "hol-christmas", calendar: holidaysCalendar, title: "Christmas Day", kind: "event", zone: zoneLondon, allDay: true,
		start: "2026-12-25", end: "2026-12-25", saved: "2026-08-20"},
	{id: "hol-new-year", calendar: holidaysCalendar, title: "New Year's Day", kind: "event", zone: zoneLondon, allDay: true,
		start: "2027-01-01", end: "2027-01-01", saved: "2026-08-20"},
	{id: "hol-good-friday", calendar: holidaysCalendar, title: "Good Friday", kind: "event", zone: zoneLondon, allDay: true,
		start: "2027-03-26", end: "2027-03-26", saved: "2026-08-20"},
}

type seedShare struct{ calendar, person, level string }

var seedShares = []seedShare{
	{"cal-dara", "p-marit", "details"}, {"cal-dara", "p-ines", "edit"}, {"cal-dara", "p-joss", "free_busy"}, {"cal-dara", "p-priya", "manage"},
	{"cal-ines", "p-marit", "details"}, {"cal-ines", "p-dara", "edit"},
	{"cal-tane", "p-hana", "details"}, {"cal-tane", "p-ines", "free_busy"},
	{"cal-oren", "p-marit", "edit"}, {"cal-lia", "p-marit", "edit"},
}

var calendarColours = []string{"rose", "amber", "teal", "indigo"}

// seed loads the people, calendars, shares, settings and events once into an empty database.
func (s *Server) seed(ctx context.Context, conn *sql.Conn) error {
	var seeded bool
	if err := conn.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM settings WHERE key = 'seeded')`).Scan(&seeded); err != nil || seeded {
		return err
	}
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := s.clock.Now()
	for i, p := range seedPeople {
		id := "p-" + firstName(p.name)
		if _, err := tx.ExecContext(ctx, `INSERT INTO people (id, name, email, passcode_hash, zone, role) VALUES ($1,$2,$3,$4,$5,$6)`,
			id, p.name, firstName(p.name)+"@sundialwren.example", digestHash(id, seedPasscodeDigest), p.zone, p.role); err != nil {
			return err
		}
		if p.role != "guest" {
			if _, err := tx.ExecContext(ctx, `INSERT INTO calendars (id, name, owner_id, colour) VALUES ($1,$2,$3,$4)`,
				"cal-"+firstName(p.name), p.name, id, calendarColours[(i+i/4)%4]); err != nil {
				return err
			}
		}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO calendars (id, name, owner_id, colour) VALUES ('cal-firm','Firm calendar','p-marit','indigo'),
		(`+"'"+holidaysCalendar+"'"+`,'Public holidays',NULL,'rose')`); err != nil {
		return err
	}
	for _, p := range seedPeople {
		if p.role == "guest" || p.name == "Marit Holloway" {
			continue
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO shares VALUES ('cal-firm',$1,'details')`, "p-"+firstName(p.name)); err != nil {
			return err
		}
	}
	for _, sh := range seedShares {
		if _, err := tx.ExecContext(ctx, `INSERT INTO shares VALUES ($1,$2,$3)`, sh.calendar, sh.person, sh.level); err != nil {
			return err
		}
	}
	hours := map[string]Hours{}
	for _, z := range zoneOrder {
		hours[z] = Hours{Open: "09:00", Close: "17:30", Days: []int{1, 2, 3, 4, 5}}
	}
	for key, value := range map[string]any{"guest_defaults": Switches{}, "office_hours": hours} {
		raw, _ := json.Marshal(value)
		if _, err := tx.ExecContext(ctx, `INSERT INTO settings VALUES ($1,$2)`, key, raw); err != nil {
			return err
		}
	}
	ed := &Edit{S: s, Ctx: ctx, Tx: tx, Now: now}
	for _, se := range seedEvents {
		saved, _ := time.Parse(layoutDate, se.saved)
		e := &Event{ID: se.id, CalendarID: se.calendar, SeriesID: se.id, Title: se.title, Location: se.location, Notes: se.notes,
			Kind: se.kind, Colour: "calendar", AllDay: se.allDay, StartLocal: se.start, EndLocal: se.end, Zone: se.zone,
			Visibility: "default", Reminders: []int{}, Switches: se.switches, Version: 1, SavedBy: owner(se.calendar), SavedAt: saved.Add(12 * time.Hour), CreatedAt: now}
		if se.visibility != "" {
			e.Visibility = se.visibility
		}
		if se.rrule != "" {
			e.RRule = &se.rrule
		}
		if se.kind == "focus" {
			e.DeclineMode = &se.declineMode
		}
		if err := insertEvent(ctx, tx, e); err != nil {
			return err
		}
		for _, g := range se.guests {
			if _, err := tx.ExecContext(ctx, `INSERT INTO guests VALUES ($1,$2)`, se.id, g); err != nil {
				return err
			}
			if err := ed.setReply(e, g, "", "invited", nil, false); err != nil {
				return err
			}
		}
	}
	until, _ := parseDate("2027-03-19")
	away := declineCopy("out_of_office", "Tane Whitcombe", longDate(until), "Partners' weekly")
	moved, _ := json.Marshal(map[string]string{"start_local": at("2027-03-23", "10:00"), "end_local": at("2027-03-23", "11:00")})
	for _, stmt := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO exceptions VALUES ('evt-partners-weekly','20270323T0900',false,$1)`, []any{moved}},
		{`INSERT INTO exceptions VALUES ('evt-partners-weekly','20270413T0900',true,'{}')`, nil},
		{`INSERT INTO share_links VALUES ('evt-harbour-kickoff','seed-harbour-link',$1,$2)`, []any{now, now.Add(s.cfg.ShareLinkTTL)}},
	} {
		if _, err := tx.ExecContext(ctx, stmt.sql, stmt.args...); err != nil {
			return err
		}
	}
	partners := &Event{ID: "evt-partners-weekly"}
	for _, r := range []struct {
		person, key, status string
		message             *string
	}{{"p-ines", "", "yes", nil}, {"p-tane", "", "maybe", nil}, {"p-tane", "20270316T0900", "no", &away}} {
		if err := ed.setReply(partners, r.person, r.key, r.status, r.message, false); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO settings VALUES ('seeded','true')`); err != nil {
		return err
	}
	return tx.Commit()
}

func insertEvent(ctx context.Context, q queryer, e *Event) error {
	reminders := pq.Array(e.Reminders)
	if e.Reminders == nil {
		reminders = pq.Array([]int{})
	}
	moved := e.MovedRules
	if moved == nil {
		moved = []string{}
	}
	_, err := q.ExecContext(ctx, `INSERT INTO events (`+eventColumns+`) VALUES
		($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)`,
		e.ID, e.CalendarID, e.SeriesID, e.SplitFrom, e.Title, e.Location, e.Notes, e.Kind, e.Colour, e.AllDay, e.StartLocal,
		e.EndLocal, e.Zone, e.Visibility, e.RRule, e.DeclineMode, e.DeclineMessage, reminders, e.Switches.ModifyEvent,
		e.Switches.InviteOthers, e.Switches.SeeGuestList, e.Version, e.SavedAt, e.CreatedAt, e.Trashed, pq.Array(moved), e.ICalUID, e.SavedBy)
	return err
}

// saveEvent writes every mutable column of an event back.
func saveEvent(ctx context.Context, q queryer, e *Event) error {
	moved := e.MovedRules
	if moved == nil {
		moved = []string{}
	}
	reminders := e.Reminders
	if reminders == nil {
		reminders = []int{}
	}
	_, err := q.ExecContext(ctx, `UPDATE events SET calendar_id=$2, series_id=$3, split_from=$4, title=$5, location=$6, notes=$7,
		kind=$8, colour=$9, all_day=$10, start_local=$11, end_local=$12, zone=$13, visibility=$14, rrule=$15, decline_mode=$16,
		decline_message=$17, reminders=$18, modify_event=$19, invite_others=$20, see_guest_list=$21, version=$22, saved_at=$23,
		trashed=$24, moved_rules=$25, ical_uid=$26, saved_by=$27 WHERE id=$1`,
		e.ID, e.CalendarID, e.SeriesID, e.SplitFrom, e.Title, e.Location, e.Notes, e.Kind, e.Colour, e.AllDay, e.StartLocal,
		e.EndLocal, e.Zone, e.Visibility, e.RRule, e.DeclineMode, e.DeclineMessage, pq.Array(reminders), e.Switches.ModifyEvent,
		e.Switches.InviteOthers, e.Switches.SeeGuestList, e.Version, e.SavedAt, e.Trashed, pq.Array(moved), e.ICalUID, e.SavedBy)
	return err
}

func at(day, clock string) string { return day + "T" + clock }

func owner(calendar string) string {
	if calendar == holidaysCalendar {
		return ""
	}
	if calendar == "cal-firm" {
		return "p-marit"
	}
	return "p-" + strings.TrimPrefix(calendar, "cal-")
}
