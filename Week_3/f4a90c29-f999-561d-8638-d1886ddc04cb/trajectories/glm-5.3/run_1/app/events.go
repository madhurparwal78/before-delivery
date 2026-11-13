package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// events.go — loading events and deciding the caller's access to them.

func (s *Store) LoadEvent(ctx context.Context, id string) (*Event, error) {
	row := s.pool.QueryRow(ctx, `SELECT id, calendar_id, series_id, split_from, organiser_id,
	  title, location, notes, kind, colour, all_day, start_date, start_minutes,
	  end_date, end_minutes, zone, visibility, rrule, decline_mode, decline_message,
	  saved_at, saved_date, version, state, moved_rules FROM events WHERE id = $1`, id)
	e, err := scanEvent(row)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := s.loadEventChildren(ctx, s.pool.Query, e); err != nil {
		return nil, err
	}
	return e, nil
}

// LoadEventTx loads an event inside a transaction, for the version check.
func (s *Store) LoadEventTx(ctx context.Context, tx pgx.Tx, id string) (*Event, error) {
	row := tx.QueryRow(ctx, `SELECT id, calendar_id, series_id, split_from, organiser_id,
	  title, location, notes, kind, colour, all_day, start_date, start_minutes,
	  end_date, end_minutes, zone, visibility, rrule, decline_mode, decline_message,
	  saved_at, saved_date, version, state, moved_rules FROM events WHERE id = $1`, id)
	e, err := scanEvent(row)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := s.loadEventChildrenTx(ctx, tx, e); err != nil {
		return nil, err
	}
	return e, nil
}

type queryFn func(ctx context.Context, sql string, args ...any) (pgx.Rows, error)

func scanEvent(row pgx.Row) (*Event, error) {
	e := &Event{}
	var rrule, declineMode, declineMessage *string
	err := row.Scan(&e.ID, &e.CalendarID, &e.SeriesID, &e.SplitFrom, &e.OrganiserID,
		&e.Title, &e.Location, &e.Notes, &e.Kind, &e.Colour, &e.AllDay,
		&e.StartDate, &e.StartMinutes, &e.EndDate, &e.EndMinutes,
		&e.Zone, &e.Visibility, &rrule, &declineMode, &declineMessage,
		&e.SavedAt, &e.SavedDate, &e.Version, &e.State, &e.MovedRules)
	if err != nil {
		return nil, err
	}
	e.RRule = rrule
	e.DeclineMode = declineMode
	e.DeclineMessage = declineMessage
	return e, nil
}

func (s *Store) loadEventChildren(ctx context.Context, q queryFn, e *Event) error {
	rows, err := q(ctx, `SELECT minutes FROM event_reminders WHERE event_id = $1 ORDER BY minutes`, e.ID)
	if err != nil {
		return err
	}
	e.Reminders = []int{}
	for rows.Next() {
		var m int
		if err := rows.Scan(&m); err != nil {
			rows.Close()
			return err
		}
		e.Reminders = append(e.Reminders, m)
	}
	rows.Close()

	rows, err = q(ctx, `SELECT modify_event, invite_others, see_guest_list FROM switches WHERE event_id = $1`, e.ID)
	if err != nil {
		return err
	}
	e.Switches = EventSwitches{}
	for rows.Next() {
		if err := rows.Scan(&e.Switches.ModifyEvent, &e.Switches.InviteOthers, &e.Switches.SeeGuestList); err != nil {
			rows.Close()
			return err
		}
	}
	rows.Close()

	rows, err = q(ctx, `SELECT g.person_id, p.name, g.series_answer FROM guests g
	  JOIN people p ON p.id = g.person_id WHERE g.event_id = $1 ORDER BY p.name`, e.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		g := &GuestRow{}
		if err := rows.Scan(&g.PersonID, &g.Name, &g.Answer); err != nil {
			rows.Close()
			return err
		}
		e.Guests = append(e.Guests, g)
	}
	rows.Close()

	rows, err = q(ctx, `SELECT person_id, occurrence_id, answer, message FROM replies WHERE event_id = $1`, e.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		rp := &ReplyRow{}
		if err := rows.Scan(&rp.PersonID, &rp.OccurrenceID, &rp.Answer, &rp.Message); err != nil {
			rows.Close()
			return err
		}
		e.Replies = append(e.Replies, rp)
	}
	rows.Close()

	rows, err = q(ctx, `SELECT occurrence_id, deleted, start_date, start_minutes, end_date, end_minutes,
	  title, location, notes FROM exceptions WHERE event_id = $1`, e.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		ex := &ExceptionRow{}
		if err := rows.Scan(&ex.OccurrenceID, &ex.Deleted, &ex.StartDate, &ex.StartMinutes,
			&ex.EndDate, &ex.EndMinutes, &ex.Title, &ex.Location, &ex.Notes); err != nil {
			rows.Close()
			return err
		}
		e.Exceptions = append(e.Exceptions, ex)
	}
	rows.Close()

	var link *ShareLinkRow
	row := s.pool.QueryRow(ctx, `SELECT token, expires_at FROM share_links WHERE event_id = $1`, e.ID)
	l := &ShareLinkRow{}
	if err := row.Scan(&l.Token, &l.ExpiresAt); err == nil {
		link = l
	}
	e.ShareLink = link
	return nil
}

func (s *Store) loadEventChildrenTx(ctx context.Context, tx pgx.Tx, e *Event) error {
	if err := s.loadEventChildren(ctx, func(c context.Context, sql string, args ...any) (pgx.Rows, error) {
		return tx.Query(c, sql, args...)
	}, e); err != nil {
		return err
	}
	return nil
}

// Access gives the first access level that applies to the person.
func (s *Store) Access(ctx context.Context, person *Person, cal *Calendar, e *Event) string {
	if person == nil {
		return "none"
	}
	if cal.OwnerID != nil && *cal.OwnerID == person.ID {
		return "full"
	}
	level, _ := s.ShareLevel(ctx, cal.ID, person.ID)
	if level == "manage" || level == "edit" {
		return "full"
	}
	if e != nil {
		for _, g := range e.Guests {
			if g.PersonID == person.ID {
				return "guest"
			}
		}
	}
	if cal.ReadOnly {
		return "details"
	}
	switch level {
	case "details":
		if e == nil || e.Visibility != "private" {
			return "details"
		}
		return "busy"
	case "free_busy":
		return "busy"
	}
	return "none"
}

// CanRead reports whether the person reads the calendar at all.
func (s *Store) CanRead(ctx context.Context, person *Person, cal *Calendar) bool {
	if cal.ReadOnly {
		return true
	}
	if cal.OwnerID != nil && *cal.OwnerID == person.ID {
		return true
	}
	if _, err := s.ShareLevel(ctx, cal.ID, person.ID); err == nil {
		return true
	}
	// guests read their events through the occurrences listing
	return false
}

// LevelLabel maps an internal level to its published label.
func LevelLabel(level string) string {
	switch level {
	case "owner":
		return "Owner"
	case "manage":
		return "Manage sharing"
	case "edit":
		return "Make changes"
	case "details":
		return "See all details"
	case "free_busy":
		return "See only free/busy"
	case "read_only":
		return "See all details"
	}
	return level
}

// GuestListVisible reports whether the viewer may see the event's guest list
// and counts, by the one published rule.
func GuestListVisible(access string, e *Event) bool {
	switch access {
	case "full":
		return true
	case "guest":
		return e.Switches.SeeGuestList || e.Switches.ModifyEvent
	default:
		return access == "details" && e.Switches.SeeGuestList
	}
}

// ReadableTitle gives the title a viewer may read.
func ReadableTitle(e *Event, occ *Occurrence, access string) string {
	if access == "busy" {
		return "Busy"
	}
	if occ != nil {
		return occ.Title
	}
	return e.Title
}

// ReplyFor gives the reply of a person for an occurrence.
func ReplyFor(e *Event, personID, occurrenceID string) string {
	for _, r := range e.Replies {
		if r.PersonID == personID && r.OccurrenceID == occurrenceID {
			return r.Answer
		}
	}
	// a single event carries its per-occurrence reply under its own id
	if occurrenceID == "" && e.RRule == nil {
		for _, r := range e.Replies {
			if r.PersonID == personID && r.OccurrenceID == e.ID {
				return r.Answer
			}
		}
	}
	for _, g := range e.Guests {
		if g.PersonID == personID {
			return g.Answer
		}
	}
	return "invited"
}

// ReplyMessageFor gives the message of a person's reply for an occurrence.
func ReplyMessageFor(e *Event, personID, occurrenceID string) string {
	for _, r := range e.Replies {
		if r.PersonID == personID && r.OccurrenceID == occurrenceID {
			return r.Message
		}
	}
	if occurrenceID == "" && e.RRule == nil {
		for _, r := range e.Replies {
			if r.PersonID == personID && r.OccurrenceID == e.ID {
				return r.Message
			}
		}
	}
	return ""
}

// IsGuest reports whether the person is a guest of the event.
func IsGuest(e *Event, personID string) bool {
	for _, g := range e.Guests {
		if g.PersonID == personID {
			return true
		}
	}
	return false
}

// RsvpCounts gives the counts for an occurrence, or series defaults.
func RsvpCounts(e *Event, occurrenceID string) map[string]int {
	counts := map[string]int{"yes": 0, "no": 0, "maybe": 0, "invited": 0}
	for _, g := range e.Guests {
		if g.PersonID == e.OrganiserID {
			continue
		}
		counts[ReplyFor(e, g.PersonID, occurrenceID)]++
	}
	return counts
}

// OccurrenceByID finds an occurrence of an event by its id.
func FindOccurrence(e *Event, occurrenceID string, rules []*ZoneRule, moved map[string]bool) *Occurrence {
	if occurrenceID == "" {
		return nil
	}
	if e.Rule() == nil {
		// single event: the occurrence id is the event id
		if occurrenceID == e.ID {
			return buildOccurrence(e, e.StartDate)
		}
		return nil
	}
	// scan a generous window
	from, _ := ParseDate("1900-01-01")
	to := mustDate("9999-12-31")
	for _, o := range GenOccurrences(e, from, to, rules, moved) {
		if o.OccurrenceID == occurrenceID {
			return o
		}
	}
	return nil
}

// StoreClockNow is filled by main; it is the server clock.
var storeClock *ServerClock

func SetStoreClock(k *ServerClock) { storeClock = k }

func ClockNow() time.Time {
	if storeClock != nil {
		return storeClock.Now()
	}
	return time.Now().UTC()
}

// savedClockFormat renders minutes as HH:MM.
func savedClockFormat(minutes int) string {
	return fmt.Sprintf("%02d:%02d", minutes/60, minutes%60)
}

var _ = strings.TrimSpace
var _ = fmt.Sprintf
