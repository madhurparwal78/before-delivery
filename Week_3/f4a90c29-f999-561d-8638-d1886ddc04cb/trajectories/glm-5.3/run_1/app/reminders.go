package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// reminders.go — the reminder engine: each reminder fires once on the
// server clock, within a real second of due.

type Reminder struct {
	ID           int64      `json:"id"`
	EventID      string     `json:"-"`
	OccurrenceID string     `json:"occurrence_id"`
	PersonID     string     `json:"-"`
	Title        string     `json:"title"`
	Minutes      int        `json:"minutes"`
	DueAt        time.Time  `json:"due_utc"`
	Status       string     `json:"status"`
	FiredAt      *time.Time `json:"fired_at"`
	AllDay       bool       `json:"-"`
}

type ReminderEngine struct {
	app  *App
	stop chan struct{}
	once sync.Once
}

func NewReminderEngine(a *App) *ReminderEngine {
	e := &ReminderEngine{app: a, stop: make(chan struct{})}
	go e.run()
	go a.purgeSweep()
	return e
}

func (e *ReminderEngine) run() {
	// The tick is far finer than a second so a due reminder fires within one
	// real second even under CLOCK_RATE.
	for {
		select {
		case <-e.stop:
			return
		case <-time.After(200 * time.Millisecond):
			e.app.fireDueReminders()
		}
	}
}

// fireDueReminders fires every due reminder once and writes its notice and
// live message, also when no page is open.
func (a *App) fireDueReminders() {
	if !a.dbReady {
		return
	}
	ctx := context.Background()
	now := a.clock.Now()
	rows, err := a.store.Pool().Query(ctx, `SELECT id, event_id, occurrence_id, person_id, title, minutes, due_at, status, all_day, fired_at
	  FROM reminders WHERE status IN ('scheduled','snoozed') AND due_at <= $1 LIMIT 50`, now)
	if err != nil {
		log.Printf("reminder query: %v", err)
		return
	}
	var due []*Reminder
	for rows.Next() {
		r := &Reminder{}
		var firedAt *time.Time
		if err := rows.Scan(&r.ID, &r.EventID, &r.OccurrenceID, &r.PersonID, &r.Title,
			&r.Minutes, &r.DueAt, &r.Status, &r.AllDay, &firedAt); err != nil {
			rows.Close()
			log.Printf("reminder scan: %v", err)
			return
		}
		due = append(due, r)
	}
	rows.Close()
	for _, r := range due {
		// claim it: exactly one fire per reminder
		tag := uuid.NewString()
		res, err := a.store.Pool().Exec(ctx, `UPDATE reminders SET status='fired', fired_at=$2, fire_token=$3
		  WHERE id=$1 AND status IN ('scheduled','snoozed')`, r.ID, now, tag)
		if err != nil {
			log.Printf("reminder claim: %v", err)
			continue
		}
		if res.RowsAffected() == 0 {
			continue
		}
		e, _ := a.store.LoadEvent(ctx, r.EventID)
		if e == nil {
			continue
		}
		person, _ := a.store.PersonByID(ctx, r.PersonID)
		if person == nil {
			continue
		}
		text := fmt.Sprintf("Reminder: %s is tomorrow.", r.Title)
		if !r.AllDay {
			// the occurrence's start, not the reminder's due moment
			start := r.DueAt.Add(time.Duration(r.Minutes) * time.Minute)
			text = fmt.Sprintf("Reminder: %s starts at %s %s.", r.Title,
				InZone(start, e.Zone).Format("15:04"), zoneCity(e.Zone))
		}
		_ = a.store.InsertNoticePool(ctx, r.PersonID, "reminder", text, nil)
		a.broadcaster.PushPersonal(nil, r.PersonID, "reminder.fired", map[string]any{
			"reminder_id": r.ID, "occurrence_id": r.OccurrenceID,
			"title": r.Title, "text": text, "event_id": r.EventID,
		})
	}
}

// EnsureSeedReminders writes each event's reminders once the schema and
// seed exist, so seeded events announce like created ones.
func (a *App) EnsureSeedReminders(ctx context.Context) error {
	cals, err := a.store.AllCalendars(ctx)
	if err != nil {
		return err
	}
	for _, cal := range cals {
		events, err := a.store.EventsOfCalendar(ctx, cal.ID)
		if err != nil {
			return err
		}
		for _, e := range events {
			a.refreshRemindersForEvent(ctx, e)
			a.ensureAllDayReminders(ctx, e)
		}
	}
	return nil
}

// refreshRemindersForEvent rebuilds an event's reminders from its rule.
func (a *App) refreshRemindersForEvent(ctx context.Context, e *Event) {
	if e == nil {
		return
	}
	// keep fired ones; rebuild the rest
	_, _ = a.store.Pool().Exec(ctx, `DELETE FROM reminders WHERE event_id=$1 AND status IN ('scheduled','snoozed')`, e.ID)
	a.createRemindersForEvent(ctx, e)
}

// createRemindersForEvent writes a reminder per entry per person.
func (a *App) createRemindersForEvent(ctx context.Context, e *Event) {
	if e == nil || e.AllDay {
		return
	}
	rules, _ := a.store.ZoneRules(ctx)
	moved := map[string]bool{}
	for _, r := range e.MovedRules {
		moved[r] = true
	}
	occs := GenOccurrences(e, a.clock.Now().Add(-24*time.Hour), a.clock.Now().AddDate(1, 0, 0), rules, moved)
	people := map[string]bool{}
	if cal, _ := a.store.CalendarByID(ctx, e.CalendarID); cal != nil && cal.OwnerID != nil {
		people[*cal.OwnerID] = true
	}
	for _, g := range e.Guests {
		people[g.PersonID] = true
	}
	for pid := range people {
		// a person who answers no loses their reminder
		for _, o := range occs {
			answer := ReplyFor(e, pid, o.OccurrenceID)
			if answer == "no" {
				continue
			}
			pair := occInstants(o)
			for _, m := range e.Reminders {
				d := pair.start.Add(-time.Duration(m) * time.Minute)
				_, _ = a.store.Pool().Exec(ctx, `INSERT INTO reminders (event_id, occurrence_id, person_id, title, minutes, due_at, status, all_day)
				  VALUES ($1,$2,$3,$4,$5,$6,'scheduled',false)
				  ON CONFLICT DO NOTHING`, e.ID, o.OccurrenceID, pid, o.Title, m, d)
			}
			// a reminder already past due with the occurrence not yet started fires at once
			for _, m := range e.Reminders {
				d := pair.start.Add(-time.Duration(m) * time.Minute)
				if !d.After(a.clock.Now()) && pair.start.After(a.clock.Now()) {
					_, _ = a.store.Pool().Exec(ctx, `UPDATE reminders SET due_at=$2 WHERE event_id=$1 AND occurrence_id=$3 AND person_id=$4 AND minutes=$5 AND status='scheduled'`,
						e.ID, a.clock.Now().Add(-time.Second), o.OccurrenceID, pid, m)
				}
			}
		}
	}
}

// handleRemindersList is GET /api/reminders.
func (a *App) handleRemindersList(ctx context.Context, resp *apiResponse, person *Person, q map[string][]string) error {
	get := func(k string) string {
		if v, ok := q[k]; ok && len(v) > 0 {
			return v[0]
		}
		return ""
	}
	fromStr, toStr := get("from"), get("to")
	if fromStr == "" || toStr == "" {
		return apiFieldErr("Use YYYY-MM-DD.", map[string]string{"from": "Use YYYY-MM-DD.", "to": "Use YYYY-MM-DD."})
	}
	fromD, ok1 := ParseDate(fromStr)
	toD, ok2 := ParseDate(toStr)
	if !ok1 || !ok2 {
		return apiFieldErr("Use YYYY-MM-DD.", map[string]string{"from": "Use YYYY-MM-DD.", "to": "Use YYYY-MM-DD."})
	}
	if toD.Sub(fromD).Hours()/24 > 366 {
		return apiFieldErr("That range is too long.", map[string]string{"to": "That range is too long."})
	}
	rows, err := a.store.Pool().Query(ctx, `SELECT id, event_id, occurrence_id, title, minutes, due_at, status, fired_at
	  FROM reminders WHERE person_id=$1 AND due_at >= $2 AND due_at < $3 ORDER BY due_at`,
		person.ID, fromD, toD.AddDate(0, 0, 1))
	if err != nil {
		return err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id int64
		var eventID, occID, title, status string
		var minutes int
		var dueAt time.Time
		var firedAt *time.Time
		if err := rows.Scan(&id, &eventID, &occID, &title, &minutes, &dueAt, &status, &firedAt); err != nil {
			return err
		}
		row := map[string]any{
			"id": id, "occurrence_id": occID, "title": title, "minutes": minutes,
			"due_utc": dueAt.UTC().Format(time.RFC3339), "status": status,
		}
		if firedAt != nil {
			row["fired_at"] = firedAt.UTC().Format(time.RFC3339)
		} else {
			row["fired_at"] = nil
		}
		out = append(out, row)
	}
	return writeOkBody(resp, map[string]any{"reminders": out})
}

// handleSnooze is POST /api/reminders/:id/snooze.
func (a *App) handleSnooze(ctx context.Context, resp *apiResponse, person *Person, idStr string, body []byte) error {
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		return apiErr(404, "not_found", "That reminder is not available.")
	}
	var req struct {
		Minutes int `json:"minutes"`
	}
	if err := jsonUnmarshal(body, &req); err != nil {
		return apiErr(422, "invalid", "That is not valid JSON.")
	}
	switch req.Minutes {
	case 5, 10, 30:
	default:
		return apiFieldErr("Choose 5, 10 or 30 minutes.", map[string]string{"minutes": "Choose 5, 10 or 30 minutes."})
	}
	var status, title string
	if err := a.store.Pool().QueryRow(ctx, `SELECT status, title FROM reminders WHERE id=$1 AND person_id=$2`, id, person.ID).Scan(&status, &title); err != nil {
		return apiErr(404, "not_found", "That reminder is not available.")
	}
	if status != "fired" {
		return apiErr(409, "not_fired", "Only a fired reminder can be snoozed.")
	}
	due := a.clock.Now().Add(time.Duration(req.Minutes) * time.Minute)
	if _, err := a.store.Pool().Exec(ctx, `UPDATE reminders SET status='snoozed', due_at=$2, fire_token=NULL WHERE id=$1`, id, due); err != nil {
		return err
	}
	return writeOkBody(resp, map[string]any{
		"id": id, "title": title, "minutes": req.Minutes,
		"due_utc": due.UTC().Format(time.RFC3339), "status": "snoozed",
	})
}

// allDayReminderDue gives 17:00 the day before in the person's zone.
func allDayReminderDue(date string, person *Person) time.Time {
	d, _ := ParseDate(date)
	prev := d.AddDate(0, 0, -1)
	inst, _, _ := InstantFromLocal(person.Zone, FormatDate(prev), 17*60)
	return inst
}

// ensureAllDayReminders writes one all-day reminder per person per occurrence.
func (a *App) ensureAllDayReminders(ctx context.Context, e *Event) {
	if e == nil || !e.AllDay {
		return
	}
	rules, _ := a.store.ZoneRules(ctx)
	moved := map[string]bool{}
	for _, r := range e.MovedRules {
		moved[r] = true
	}
	occs := GenOccurrences(e, a.clock.Now().AddDate(-1, 0, 0), a.clock.Now().AddDate(1, 0, 0), rules, moved)
	people := map[string]bool{}
	if cal, _ := a.store.CalendarByID(ctx, e.CalendarID); cal != nil && cal.OwnerID != nil {
		people[*cal.OwnerID] = true
	}
	for _, g := range e.Guests {
		people[g.PersonID] = true
	}
	for pid := range people {
		p, _ := a.store.PersonByID(ctx, pid)
		if p == nil {
			continue
		}
		for _, o := range occs {
			if ReplyFor(e, pid, o.OccurrenceID) == "no" {
				continue
			}
			due := allDayReminderDue(o.StartDate, p)
			_, _ = a.store.Pool().Exec(ctx, `INSERT INTO reminders (event_id, occurrence_id, person_id, title, minutes, due_at, status, all_day)
			  VALUES ($1,$2,$3,$4,0,$5,'scheduled',true) ON CONFLICT DO NOTHING`,
				e.ID, o.OccurrenceID, pid, o.Title, due)
			// one already past due, with the day not over, fires at once
			if !due.After(a.clock.Now()) {
				endOfDay := midnightUTC(mustDate(o.EndDate)).Add(24 * time.Hour)
				if endOfDay.After(a.clock.Now()) {
					_, _ = a.store.Pool().Exec(ctx, `UPDATE reminders SET due_at=$2 WHERE event_id=$1 AND occurrence_id=$3 AND person_id=$4 AND status='scheduled'`,
						e.ID, a.clock.Now().Add(-time.Second), o.OccurrenceID, pid)
				}
			}
		}
	}
}

var _ = strings.TrimSpace
var _ = http.MethodGet
var _ = fmt.Sprintf
