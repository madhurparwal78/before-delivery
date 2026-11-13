package main

import (
	"context"
	"database/sql"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/lib/pq"
)

const allDayReminder = -1

// Reminder is one reminder of one person for one occurrence.
type Reminder struct {
	Event      *Event
	Occurrence *Occurrence
	Person     *Person
	Minutes    int
	Due        time.Time
	Status     string
	FiredAt    *time.Time
}

func reminderID(eventID, key, person string, minutes int) string {
	return base64.RawURLEncoding.EncodeToString([]byte(strings.Join([]string{eventID, key, person, strconv.Itoa(minutes)}, "|")))
}

func parseReminderID(id string) (eventID, key, person string, minutes int, ok bool) {
	raw, err := base64.RawURLEncoding.DecodeString(id)
	parts := strings.Split(string(raw), "|")
	if err != nil || len(parts) != 4 {
		return
	}
	minutes, err = strconv.Atoi(parts[3])
	return parts[0], parts[1], parts[2], minutes, err == nil
}

func (r *Reminder) ID() string {
	return reminderID(r.Event.ID, r.Occurrence.Key, r.Person.ID, r.Minutes)
}

// dueFor is when a reminder falls due: minutes before a timed start, or 17:00 the day before an all-day date in the person's zone.
func dueFor(o *Occurrence, p *Person, minutes int) time.Time {
	if minutes != allDayReminder {
		return o.Begin.Add(-time.Duration(minutes) * time.Minute)
	}
	day := dateOnly(o.ShownStart).AddDate(0, 0, -1).Add(17 * time.Hour)
	due, _, _ := resolveLocal(zoneLocations[p.Zone], day, nil)
	return due
}

// started reports whether the occurrence has already started, or for all-day, its day is over for the person.
func (w *World) started(o *Occurrence, p *Person) bool {
	if o.AllDay {
		return !wallOf(w.Now, zoneLocations[p.Zone]).Before(dateOnly(o.ShownEnd).AddDate(0, 0, 1))
	}
	return !o.Begin.After(w.Now)
}

// recipients are the owner and the guests not answering no.
func (w *World) recipients(e *Event, o *Occurrence) []*Person {
	var out []*Person
	if owner := w.organiser(e); owner != nil {
		out = append(out, owner)
	}
	for _, g := range e.GuestIDs {
		if status, _ := e.replyFor(g, o.ReplyKey()); status != "no" {
			out = append(out, w.People[g])
		}
	}
	return out
}

func (w *World) reminderMinutes(e *Event) []int {
	if e.AllDay {
		return []int{allDayReminder}
	}
	return e.Reminders
}

type stateKey struct {
	event, occ, person string
	minutes            int
}

type reminderState struct {
	status string
	due    *time.Time
	fired  *time.Time
}

func loadReminderStates(ctx context.Context, q queryer, events []*Event) (map[stateKey]reminderState, error) {
	ids := pq.StringArray{}
	for _, e := range events {
		ids = append(ids, e.ID)
	}
	rows, err := q.QueryContext(ctx, `SELECT event_id, occurrence_key, person_id, minutes, status, due, fired_at FROM reminder_states WHERE event_id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[stateKey]reminderState{}
	for rows.Next() {
		var k stateKey
		var st reminderState
		if err := rows.Scan(&k.event, &k.occ, &k.person, &k.minutes, &st.status, &st.due, &st.fired); err != nil {
			return nil, err
		}
		out[k] = st
	}
	return out, rows.Err()
}

// remindersIn derives every reminder of the given occurrences with its state.
func (w *World) remindersIn(events []*Event, win Window, states map[stateKey]reminderState, only *Person) []*Reminder {
	var out []*Reminder
	for _, e := range events {
		for _, o := range w.occurrences(e, win) {
			for _, p := range w.recipients(e, o) {
				if only != nil && p.ID != only.ID {
					continue
				}
				for _, m := range w.reminderMinutes(e) {
					r := &Reminder{Event: e, Occurrence: o, Person: p, Minutes: m, Due: dueFor(o, p, m), Status: "scheduled"}
					if st, ok := states[stateKey{e.ID, o.Key, p.ID, m}]; ok {
						r.Status, r.FiredAt = st.status, st.fired
						if st.status == "snoozed" && st.due != nil {
							r.Due = *st.due
						}
					}
					out = append(out, r)
				}
			}
		}
	}
	return out
}

func reminderJSON(r *Reminder) map[string]any {
	var minutes, fired any
	if r.Minutes != allDayReminder {
		minutes = r.Minutes
	}
	if r.FiredAt != nil {
		fired = r.FiredAt.UTC().Format(time.RFC3339)
	}
	return map[string]any{"id": r.ID(), "occurrence_id": r.Occurrence.ID, "title": r.Occurrence.Title, "minutes": minutes,
		"due_utc": r.Due.UTC().Format(time.RFC3339), "status": r.Status, "fired_at": fired}
}

func (s *Server) handleReminders(rq *Req) error {
	q := rq.R.URL.Query()
	from, ferr := parseDate(q.Get("from"))
	to, terr := parseDate(q.Get("to"))
	errs := map[string]string{}
	if ferr != nil {
		errs["from"] = "Use YYYY-MM-DD."
	}
	if terr != nil {
		errs["to"] = "Use YYYY-MM-DD."
	} else if ferr == nil && (!to.After(from) || to.Sub(from) > 366*24*time.Hour) {
		errs["to"] = "Use a date after from, at most 366 days later."
	}
	if len(errs) > 0 {
		return fieldErrors(errs)
	}
	w, err := rq.World()
	if err != nil {
		return err
	}
	events, err := loadEvents(rq.ctx(), s.db, `NOT trashed AND (cardinality(reminders) > 0 OR all_day) AND (calendar_id IN (SELECT id FROM calendars WHERE owner_id = $1)
		OR id IN (SELECT event_id FROM guests WHERE person_id = $1)) AND start_local < $2 AND (rrule IS NOT NULL OR end_local >= $3)`,
		rq.Me.ID, to.AddDate(0, 0, 3).Format(layoutDate), from.AddDate(0, 0, -3).Format(layoutDate))
	if err != nil {
		return err
	}
	if err := attachReplies(rq.ctx(), s.db, events); err != nil {
		return err
	}
	states, err := loadReminderStates(rq.ctx(), s.db, events)
	if err != nil {
		return err
	}
	win := Window{From: from.AddDate(0, 0, -2), To: to.AddDate(0, 0, 2)}
	rows := []map[string]any{}
	for _, r := range w.remindersIn(events, win, states, rq.Me) {
		date := r.Occurrence.SavedStart
		if date.Before(from) && dateOnly(date).Before(from) || !dateOnly(date).Before(to) {
			continue
		}
		if r.Status == "scheduled" && w.started(r.Occurrence, rq.Me) {
			continue
		}
		rows = append(rows, reminderJSON(r))
	}
	return rq.json(200, map[string]any{"reminders": rows})
}

func (s *Server) handleSnooze(rq *Req) error {
	eventID, key, person, minutes, ok := parseReminderID(rq.R.PathValue("id"))
	if !ok || person != rq.Me.ID {
		return errNotFound
	}
	var body struct {
		Minutes int `json:"minutes"`
	}
	var out map[string]any
	err := s.edit(rq.ctx(), rq.Me, func(ed *Edit) error {
		e, err := ed.loadLocked(eventID)
		if err != nil || e == nil || e.Trashed {
			return errNotFound
		}
		occ := ed.W.occurrenceAt(e, key)
		if occ == nil {
			return errNotFound
		}
		var status string
		err = ed.Tx.QueryRowContext(ed.Ctx, `SELECT status FROM reminder_states WHERE event_id=$1 AND occurrence_key=$2 AND person_id=$3 AND minutes=$4`,
			eventID, key, person, minutes).Scan(&status)
		if err == sql.ErrNoRows || (err == nil && status != "fired") {
			return apiErr(409, "not_fired", "Only a reminder that has fired can be snoozed.")
		}
		if err != nil {
			return err
		}
		if err := rq.decode(&body); err != nil {
			return err
		}
		if body.Minutes != 5 && body.Minutes != 10 && body.Minutes != 30 {
			return fieldErr("minutes", "Choose 5, 10 or 30 minutes.")
		}
		due := ed.Now.Add(time.Duration(body.Minutes) * time.Minute)
		var fired *time.Time
		if err := ed.Tx.QueryRowContext(ed.Ctx, `UPDATE reminder_states SET status='snoozed', due=$5 WHERE event_id=$1 AND occurrence_key=$2 AND person_id=$3 AND minutes=$4 RETURNING fired_at`,
			eventID, key, person, minutes, due).Scan(&fired); err != nil {
			return err
		}
		r := &Reminder{Event: e, Occurrence: occ, Person: ed.Actor, Minutes: minutes, Due: due, Status: "snoozed", FiredAt: fired}
		out = reminderJSON(r)
		return nil
	})
	if err != nil {
		return err
	}
	return rq.json(200, out)
}

// reminderLoop fires due reminders on the server clock, once each.
func (s *Server) reminderLoop(ctx context.Context) {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		if err := s.fireDue(ctx); err != nil && ctx.Err() == nil {
			fmt.Printf("reminders: %v\n", err)
		}
	}
}

func (s *Server) fireDue(ctx context.Context) error {
	now := s.clock.Now()
	events, err := loadEvents(ctx, s.db, `NOT trashed AND (cardinality(reminders) > 0 OR all_day) AND start_local < $1 AND (rrule IS NOT NULL OR end_local >= $2)`,
		now.AddDate(0, 0, 10).Format(layoutDate), now.AddDate(0, 0, -3).Format(layoutDate))
	if err != nil {
		return err
	}
	snoozed, err := s.db.QueryContext(ctx, `SELECT event_id FROM reminder_states WHERE status = 'snoozed' AND due <= $1`, now)
	if err != nil {
		return err
	}
	var extra pq.StringArray
	for snoozed.Next() {
		var id string
		snoozed.Scan(&id)
		extra = append(extra, id)
	}
	snoozed.Close()
	if len(extra) > 0 {
		more, err := loadEvents(ctx, s.db, `NOT trashed AND id = ANY($1)`, extra)
		if err != nil {
			return err
		}
		have := map[string]bool{}
		for _, e := range events {
			have[e.ID] = true
		}
		for _, e := range more {
			if !have[e.ID] {
				events = append(events, e)
			}
		}
	}
	if len(events) == 0 {
		return nil
	}
	w, err := loadWorld(ctx, s.db, now)
	if err != nil {
		return err
	}
	if err := attachReplies(ctx, s.db, events); err != nil {
		return err
	}
	states, err := loadReminderStates(ctx, s.db, events)
	if err != nil {
		return err
	}
	win := Window{From: now.AddDate(0, 0, -2), To: now.AddDate(0, 0, 9)}
	var due []*Reminder
	for _, r := range w.remindersIn(events, win, states, nil) {
		if r.Status == "fired" || r.Due.After(now) || (r.Status == "scheduled" && w.started(r.Occurrence, r.Person)) {
			continue
		}
		due = append(due, r)
	}
	if len(due) == 0 {
		return nil
	}
	return s.tx(ctx, func(tx *sql.Tx) error {
		ed := &Edit{S: s, Ctx: ctx, Tx: tx, W: w, Now: s.clock.Now()}
		for _, r := range due {
			res, err := tx.ExecContext(ctx, `INSERT INTO reminder_states (event_id, occurrence_key, person_id, minutes, status, fired_at) VALUES ($1,$2,$3,$4,'fired',$5)
				ON CONFLICT (event_id, occurrence_key, person_id, minutes) DO UPDATE SET status='fired', fired_at=$5, due=NULL
				WHERE reminder_states.status = 'snoozed' AND reminder_states.due <= $5`, r.Event.ID, r.Occurrence.Key, r.Person.ID, r.Minutes, ed.Now)
			if err != nil {
				return err
			}
			if n, _ := res.RowsAffected(); n == 0 {
				continue
			}
			if err := ed.announceReminder(r); err != nil {
				return err
			}
		}
		return nil
	})
}

func (ed *Edit) announceReminder(r *Reminder) error {
	text := "Reminder: " + r.Occurrence.Title + " is tomorrow."
	if r.Minutes != allDayReminder {
		text = fmt.Sprintf("Reminder: %s starts at %s %s.", r.Occurrence.Title, wallOf(r.Occurrence.Begin, zoneLocations[r.Person.Zone]).Format("15:04"), r.Person.City())
	}
	nid, err := ed.notice(r.Person.ID, "reminder", text, r.Event.ID)
	if err != nil {
		return err
	}
	var minutes any
	if r.Minutes != allDayReminder {
		minutes = r.Minutes
	}
	return ed.log(ChangeRow{Type: "reminder.fired", EventID: r.Event.ID, CalendarID: r.Event.CalendarID, PersonID: r.Person.ID,
		Data: map[string]any{"reminder": map[string]any{"id": r.ID(), "occurrence_id": r.Occurrence.ID, "title": r.Occurrence.Title, "minutes": minutes},
			"notice": map[string]any{"id": itoa(nid), "text": text}}})
}
