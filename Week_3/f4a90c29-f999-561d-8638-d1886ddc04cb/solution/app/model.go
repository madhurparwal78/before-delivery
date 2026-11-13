package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"sort"
	"strings"
	"time"

	"github.com/lib/pq"
)

// queryer is satisfied by *sql.DB and *sql.Tx.
type queryer interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

type Person struct {
	ID, Name, Email, Zone, Role, WeekStart string
	HideWeekends                           bool
	CustomDays                             int
	SecondZone                             *string
}

func (p *Person) City() string { return zoneCity[p.Zone] }

type Calendar struct {
	ID, Name, Colour string
	OwnerID          *string
	DefaultReminders []int
}

type ZoneRule struct{ ID, Zone, EffectiveDate, NewOffset, Note, RecordedBy string }

type Switches struct {
	ModifyEvent  bool `json:"modify_event"`
	InviteOthers bool `json:"invite_others"`
	SeeGuestList bool `json:"see_guest_list"`
}

type Hours struct {
	Open  string `json:"open"`
	Close string `json:"close"`
	Days  []int  `json:"days"`
}

type Exception struct {
	Key     string
	Deleted bool
	Over    map[string]string
}

type Reply struct {
	PersonID, Key, Status string
	Message               *string
}

type Event struct {
	ID, CalendarID, SeriesID               string
	SplitFrom                              *string
	Title, Location, Notes, Kind, Colour   string
	AllDay                                 bool
	StartLocal, EndLocal, Zone, Visibility string
	RRule, DeclineMode, DeclineMessage     *string
	Reminders                              []int
	Switches                               Switches
	Version                                int
	SavedAt, CreatedAt                     time.Time
	Trashed                                bool
	MovedRules                             []string
	ICalUID                                *string
	SavedBy                                string
	Exceptions                             map[string]*Exception
	GuestIDs                               []string
	Replies                                []Reply
	Proposals                              []Proposal
	Link                                   *ShareLink
}

type Proposal struct {
	ID, EventID, Key, ProposerID, StartLocal, EndLocal, Note, Status string
}

type ShareLink struct {
	Token                string
	CreatedAt, ExpiresAt time.Time
}

const eventColumns = `id, calendar_id, series_id, split_from, title, location, notes, kind, colour, all_day, start_local,
 end_local, zone, visibility, rrule, decline_mode, decline_message, reminders, modify_event, invite_others,
 see_guest_list, version, saved_at, created_at, trashed, moved_rules, ical_uid, saved_by`

func scanEvent(rows *sql.Rows) (*Event, error) {
	e := &Event{Exceptions: map[string]*Exception{}}
	var reminders pq.Int64Array
	var moved pq.StringArray
	err := rows.Scan(&e.ID, &e.CalendarID, &e.SeriesID, &e.SplitFrom, &e.Title, &e.Location, &e.Notes, &e.Kind, &e.Colour,
		&e.AllDay, &e.StartLocal, &e.EndLocal, &e.Zone, &e.Visibility, &e.RRule, &e.DeclineMode, &e.DeclineMessage,
		&reminders, &e.Switches.ModifyEvent, &e.Switches.InviteOthers, &e.Switches.SeeGuestList, &e.Version,
		&e.SavedAt, &e.CreatedAt, &e.Trashed, &moved, &e.ICalUID, &e.SavedBy)
	for _, m := range reminders {
		e.Reminders = append(e.Reminders, int(m))
	}
	e.MovedRules = []string(moved)
	return e, err
}

// loadEvents reads events with their exceptions and guest ids.
func loadEvents(ctx context.Context, q queryer, where string, args ...any) ([]*Event, error) {
	rows, err := q.QueryContext(ctx, `SELECT `+eventColumns+` FROM events WHERE `+where, args...)
	if err != nil {
		return nil, err
	}
	var out []*Event
	byID := map[string]*Event{}
	ids := pq.StringArray{}
	for rows.Next() {
		e, err := scanEvent(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, e)
		byID[e.ID] = e
		ids = append(ids, e.ID)
	}
	rows.Close()
	if len(out) == 0 {
		return out, rows.Err()
	}
	er, err := q.QueryContext(ctx, `SELECT event_id, key, deleted, over FROM exceptions WHERE event_id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	for er.Next() {
		var id string
		x := &Exception{}
		var raw []byte
		if err := er.Scan(&id, &x.Key, &x.Deleted, &raw); err != nil {
			er.Close()
			return nil, err
		}
		json.Unmarshal(raw, &x.Over)
		byID[id].Exceptions[x.Key] = x
	}
	er.Close()
	gr, err := q.QueryContext(ctx, `SELECT g.event_id, g.person_id FROM guests g JOIN people p ON p.id = g.person_id
		WHERE g.event_id = ANY($1) ORDER BY p.name`, ids)
	if err != nil {
		return nil, err
	}
	for gr.Next() {
		var id, person string
		if err := gr.Scan(&id, &person); err != nil {
			gr.Close()
			return nil, err
		}
		byID[id].GuestIDs = append(byID[id].GuestIDs, person)
	}
	gr.Close()
	return out, nil
}

func loadEvent(ctx context.Context, q queryer, id string) (*Event, error) {
	events, err := loadEvents(ctx, q, `id = $1`, id)
	if err != nil || len(events) == 0 {
		return nil, err
	}
	return events[0], nil
}

// attachReplies loads every reply of the given events.
func attachReplies(ctx context.Context, q queryer, events []*Event) error {
	ids := pq.StringArray{}
	byID := map[string]*Event{}
	for _, e := range events {
		ids = append(ids, e.ID)
		byID[e.ID] = e
		e.Replies = nil
	}
	rows, err := q.QueryContext(ctx, `SELECT event_id, person_id, key, status, message FROM replies WHERE event_id = ANY($1)`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var r Reply
		if err := rows.Scan(&id, &r.PersonID, &r.Key, &r.Status, &r.Message); err != nil {
			return err
		}
		byID[id].Replies = append(byID[id].Replies, r)
	}
	return rows.Err()
}

// replyFor is a guest's reply status for an occurrence key: the occurrence's own row, else the series default.
func (e *Event) replyFor(person, key string) (string, *string) {
	var def *Reply
	for i := range e.Replies {
		r := &e.Replies[i]
		if r.PersonID != person {
			continue
		}
		if r.Key == key && key != "" {
			return r.Status, r.Message
		}
		if r.Key == "" {
			def = r
		}
	}
	if def != nil {
		return def.Status, def.Message
	}
	return "invited", nil
}

// attachDetails loads replies, proposals and live shared links of the given events.
func attachDetails(ctx context.Context, q queryer, events []*Event, now time.Time) error {
	if len(events) == 0 {
		return nil
	}
	if err := attachReplies(ctx, q, events); err != nil {
		return err
	}
	ids := pq.StringArray{}
	byID := map[string]*Event{}
	for _, e := range events {
		ids = append(ids, e.ID)
		byID[e.ID] = e
		e.Proposals, e.Link = nil, nil
	}
	rows, err := q.QueryContext(ctx, `SELECT id, event_id, occurrence_key, proposer_id, start_local, end_local, note, status
		FROM proposals WHERE event_id = ANY($1) ORDER BY created_at, id`, ids)
	if err != nil {
		return err
	}
	for rows.Next() {
		var p Proposal
		if err := rows.Scan(&p.ID, &p.EventID, &p.Key, &p.ProposerID, &p.StartLocal, &p.EndLocal, &p.Note, &p.Status); err != nil {
			rows.Close()
			return err
		}
		byID[p.EventID].Proposals = append(byID[p.EventID].Proposals, p)
	}
	rows.Close()
	rows, err = q.QueryContext(ctx, `SELECT event_id, token, created_at, expires_at FROM share_links WHERE event_id = ANY($1) AND expires_at > $2`, ids, now)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		l := &ShareLink{}
		if err := rows.Scan(&id, &l.Token, &l.CreatedAt, &l.ExpiresAt); err != nil {
			return err
		}
		byID[id].Link = l
	}
	return rows.Err()
}

func (e *Event) isGuest(person string) bool {
	for _, g := range e.GuestIDs {
		if g == person {
			return true
		}
	}
	return false
}

func (e *Event) recurring() bool { return e.RRule != nil && *e.RRule != "" }

// World is the per-request snapshot of the small shared tables.
type World struct {
	People    map[string]*Person
	Calendars map[string]*Calendar
	Shares    map[string]map[string]string
	Rules     []ZoneRule
	Hours     map[string]Hours
	Defaults  Switches
	Now       time.Time
}

func loadWorld(ctx context.Context, q queryer, now time.Time) (*World, error) {
	w := &World{People: map[string]*Person{}, Calendars: map[string]*Calendar{}, Shares: map[string]map[string]string{},
		Hours: map[string]Hours{}, Now: now}
	rows, err := q.QueryContext(ctx, `SELECT id, name, email, zone, role, week_start, hide_weekends, custom_days, second_zone FROM people`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		p := &Person{}
		if err := rows.Scan(&p.ID, &p.Name, &p.Email, &p.Zone, &p.Role, &p.WeekStart, &p.HideWeekends, &p.CustomDays, &p.SecondZone); err != nil {
			rows.Close()
			return nil, err
		}
		w.People[p.ID] = p
	}
	rows.Close()
	rows, err = q.QueryContext(ctx, `SELECT id, name, owner_id, colour, default_reminders FROM calendars`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		c := &Calendar{}
		var reminders pq.Int64Array
		if err := rows.Scan(&c.ID, &c.Name, &c.OwnerID, &c.Colour, &reminders); err != nil {
			rows.Close()
			return nil, err
		}
		c.DefaultReminders = []int{}
		for _, m := range reminders {
			c.DefaultReminders = append(c.DefaultReminders, int(m))
		}
		w.Calendars[c.ID] = c
	}
	rows.Close()
	rows, err = q.QueryContext(ctx, `SELECT calendar_id, person_id, level FROM shares`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var c, p, l string
		if err := rows.Scan(&c, &p, &l); err != nil {
			rows.Close()
			return nil, err
		}
		if w.Shares[c] == nil {
			w.Shares[c] = map[string]string{}
		}
		w.Shares[c][p] = l
	}
	rows.Close()
	rows, err = q.QueryContext(ctx, `SELECT id, zone, effective_date, new_offset, note, recorded_by FROM zone_rules ORDER BY effective_date, id`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var r ZoneRule
		if err := rows.Scan(&r.ID, &r.Zone, &r.EffectiveDate, &r.NewOffset, &r.Note, &r.RecordedBy); err != nil {
			rows.Close()
			return nil, err
		}
		w.Rules = append(w.Rules, r)
	}
	rows.Close()
	return w, w.loadSettings(ctx, q)
}

func (w *World) loadSettings(ctx context.Context, q queryer) error {
	rows, err := q.QueryContext(ctx, `SELECT key, value FROM settings WHERE key IN ('guest_defaults','office_hours')`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		var raw []byte
		if err := rows.Scan(&key, &raw); err != nil {
			return err
		}
		if key == "guest_defaults" {
			json.Unmarshal(raw, &w.Defaults)
		} else {
			json.Unmarshal(raw, &w.Hours)
		}
	}
	return rows.Err()
}

func (w *World) peopleSorted() []*Person {
	out := make([]*Person, 0, len(w.People))
	for _, p := range w.People {
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// shareLevel is a person's level on a calendar: owner, manage, edit, details, free_busy, read_only or "".
func (w *World) shareLevel(c *Calendar, p *Person) string {
	if c.ID == holidaysCalendar {
		return "read_only"
	}
	if c.OwnerID != nil && *c.OwnerID == p.ID {
		return "owner"
	}
	switch l := w.Shares[c.ID][p.ID]; l {
	case "manage", "edit", "details", "free_busy":
		return l
	}
	return ""
}

const holidaysCalendar = "cal-holidays"

// canRead reports whether a person can see anything of a calendar.
func (w *World) canRead(c *Calendar, p *Person) bool { return w.shareLevel(c, p) != "" }

// canWrite reports whether a person can create and change events on a calendar.
func (w *World) canWrite(c *Calendar, p *Person) bool {
	switch w.shareLevel(c, p) {
	case "owner", "manage", "edit":
		return true
	}
	return false
}

// canManage reports whether a person can change a calendar's default reminders and, with the office manager, its shares.
func (w *World) canManage(c *Calendar, p *Person) bool {
	l := w.shareLevel(c, p)
	return l == "owner" || l == "manage"
}

// access is the one place that decides a caller's access level to an event: full, guest, details, busy or "".
func (w *World) access(e *Event, p *Person) string {
	cal := w.Calendars[e.CalendarID]
	if w.canWrite(cal, p) {
		return "full"
	}
	level := w.shareLevel(cal, p)
	if e.isGuest(p.ID) {
		return "guest"
	}
	switch level {
	case "read_only":
		return "details"
	case "details":
		if e.Visibility != "private" {
			return "details"
		}
		return "busy"
	case "free_busy":
		return "busy"
	}
	return ""
}

func (w *World) organiser(e *Event) *Person {
	if o := w.Calendars[e.CalendarID].OwnerID; o != nil {
		return w.People[*o]
	}
	return nil
}

func (w *World) hasHours(zone string) Hours { return w.Hours[zone] }

func (h Hours) workingDay(d time.Time) bool {
	n := int(d.Weekday())
	if n == 0 {
		n = 7
	}
	for _, day := range h.Days {
		if day == n {
			return true
		}
	}
	return false
}

// insideHours applies the working-hours rule: a start is inside from opening until closing, an end after opening until closing.
func (h Hours) insideHours(w wall, isEnd bool) bool {
	if !h.workingDay(w) {
		return false
	}
	t := w.Format("15:04")
	if isEnd {
		return t > h.Open && t <= h.Close
	}
	return t >= h.Open && t < h.Close
}

func splitOccurrenceID(id string) (event, key string) {
	if i := strings.LastIndex(id, "@"); i >= 0 {
		return id[:i], id[i+1:]
	}
	return id, ""
}
