package main

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// api_events.go — events, occurrences and their guests.

func (a *App) handleCalendars(ctx context.Context, resp *apiResponse, person *Person) error {
	cals, err := a.store.AllCalendars(ctx)
	if err != nil {
		return err
	}
	out := []map[string]any{}
	for _, c := range cals {
		reminders, err := a.store.CalendarDefaultReminders(ctx, c.ID)
		if err != nil {
			return err
		}
		if reminders == nil {
			reminders = []int{}
		}
		level := "none"
		switch {
		case c.OwnerID != nil && *c.OwnerID == person.ID:
			level = "owner"
		default:
			if l, _ := a.store.ShareLevel(ctx, c.ID, person.ID); l != "" {
				level = l
			} else if c.ReadOnly {
				level = "read_only"
			}
		}
		out = append(out, map[string]any{
			"id": c.ID, "name": c.Name, "owner_id": c.OwnerID,
			"colour": c.Colour, "level": level, "default_reminders": reminders,
		})
	}
	return writeOkBody(resp, map[string]any{"calendars": out})
}

func (a *App) handlePatchCalendar(ctx context.Context, resp *apiResponse, person *Person, calID string, body []byte) error {
	cal, err := a.store.CalendarByID(ctx, calID)
	if err != nil {
		return err
	}
	if cal == nil {
		return apiErr(404, "not_found", "Nothing is scheduled at this address.")
	}
	level, _ := a.store.ShareLevel(ctx, calID, person.ID)
	owner := cal.OwnerID != nil && *cal.OwnerID == person.ID
	if !owner && level != "manage" && person.Role != "office_manager" {
		return apiErr(403, "forbidden", "You need Manage sharing to change this calendar.")
	}
	var req struct {
		DefaultReminders []int `json:"default_reminders"`
	}
	if err := jsonUnmarshal(body, &req); err != nil {
		return apiErr(422, "invalid", "That is not valid JSON.")
	}
	fields := map[string]string{}
	if len(req.DefaultReminders) > 5 {
		fields["default_reminders"] = "A calendar keeps at most 5 default reminders."
	}
	for _, m := range req.DefaultReminders {
		if m < 0 || m > 10080 {
			fields["default_reminders"] = "Reminder minutes must be from 0 to 10080."
		}
	}
	if len(fields) > 0 {
		return apiFieldErr("Check the fields and try again.", fields)
	}
	err = a.store.Tx(ctx, func(tx pgx.Tx) error {
		return a.store.SetCalendarDefaultReminders(ctx, tx, calID, req.DefaultReminders)
	})
	if err != nil {
		return err
	}
	reminders, _ := a.store.CalendarDefaultReminders(ctx, calID)
	return writeOkBody(resp, map[string]any{
		"id": cal.ID, "name": cal.Name, "owner_id": cal.OwnerID,
		"colour": cal.Colour, "default_reminders": reminders,
	})
}

// handleOccurrences lists every occurrence the person can read.
func (a *App) handleOccurrences(ctx context.Context, resp *apiResponse, person *Person, q map[string][]string) error {
	get := func(k string) string {
		if v, ok := q[k]; ok && len(v) > 0 {
			return v[0]
		}
		return ""
	}
	fromStr, toStr := get("from"), get("(")
	_ = fromStr
	fromStr = get("from")
	toStr = get("to")
	if fromStr == "" || toStr == "" {
		return apiFieldErr("Check the fields and try again.", map[string]string{"from": "Use YYYY-MM-DD.", "to": "Use YYYY-MM-DD."})
	}
	from, ok1 := ParseDate(fromStr)
	to, ok2 := ParseDate(toStr)
	if !ok1 || !ok2 {
		return apiFieldErr("Check the fields and try again.", map[string]string{"from": "Use YYYY-MM-DD.", "to": "Use YYYY-MM-DD."})
	}
	if to.Sub(from).Hours()/24 > 366 {
		return apiFieldErr("Check the fields and try again.", map[string]string{"to": "That range is too long."})
	}
	// from/to are dates in the viewer's zone
	fromInst := midnightInZone(person.Zone, fromStr)
	toInst := midnightInZone(person.Zone, toStr)

	calFilter := map[string]bool{}
	for _, id := range strings.Split(get("calendars"), ",") {
		id = strings.TrimSpace(id)
		if id != "" {
			calFilter[id] = true
		}
	}
	rules, _ := a.store.ZoneRules(ctx)
	occ, err := a.store.OccurrencesForPerson(ctx, person, fromInst, toInst, calFilter, rules)
	if err != nil {
		return err
	}
	sort.Slice(occ, func(i, j int) bool {
		si, _ := occStartInstant(occ[i].Occurrence, rules, nil)
		sj, _ := occStartInstant(occ[j].Occurrence, rules, nil)
		if !si.Equal(sj) {
			return si.Before(sj)
		}
		return occ[i].OccurrenceID < occ[j].OccurrenceID
	})
	hours, _ := a.store.OfficeHoursAll(ctx)
	out := []map[string]any{}
	for _, lo := range occ {
		out = append(out, ProjectOccurrence(lo.event, lo.Occurrence, lo.access, person, hours))
	}
	return writeOkBody(resp, map[string]any{"occurrences": out})
}

func midnightInZone(zone, date string) time.Time {
	t, _, _ := InstantFromLocal(zone, date, 0)
	return t
}

// loadedOccurrence pairs an occurrence with its event and the viewer's access.
type loadedOccurrence struct {
	*Occurrence
	event  *Event
	access string
}

// OccurrencesForPerson lists occurrences the person can read in the range.
func (s *Store) OccurrencesForPerson(ctx context.Context, p *Person, from, to time.Time, calFilter map[string]bool, rules []*ZoneRule) ([]*loadedOccurrence, error) {
	cals, err := s.AllCalendars(ctx)
	if err != nil {
		return nil, err
	}
	people, err := s.AllPeople(ctx)
	if err != nil {
		return nil, err
	}
	personName := map[string]string{}
	for _, pp := range people {
		personName[pp.ID] = pp.Name
	}
	var out []*loadedOccurrence
	for _, cal := range cals {
		if len(calFilter) > 0 && !calFilter[cal.ID] {
			continue
		}
		events, err := s.EventsOfCalendar(ctx, cal.ID)
		if err != nil {
			return nil, err
		}
		for _, e := range events {
			access := s.Access(ctx, p, cal, e)
			if access == "none" {
				continue
			}
			moved := map[string]bool{}
			for _, r := range e.MovedRules {
				moved[r] = true
			}
			occs := GenOccurrences(e, from, to, rules, moved)
			for _, o := range occs {
				out = append(out, &loadedOccurrence{o, e, access})
			}
		}
	}
	// events the person is a guest of, on calendars they cannot read
	guestEvents, err := s.EventsOfGuest(ctx, p.ID)
	if err != nil {
		return nil, err
	}
	for _, e := range guestEvents {
		if len(calFilter) > 0 && !calFilter[e.CalendarID] {
			continue
		}
		dup := false
		for _, o := range out {
			if o.EventID == e.ID {
				dup = true
				break
			}
		}
		if dup {
			continue
		}
		moved := map[string]bool{}
		for _, r := range e.MovedRules {
			moved[r] = true
		}
		occs := GenOccurrences(e, from, to, rules, moved)
		for _, o := range occs {
			out = append(out, &loadedOccurrence{o, e, "guest"})
		}
	}
	return out, nil
}

func (s *Store) EventsOfCalendar(ctx context.Context, calID string) ([]*Event, error) {
	rows, err := s.Pool().Query(ctx, `SELECT id FROM events WHERE calendar_id = $1 AND state IN ('live','restored') ORDER BY id`, calID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	var out []*Event
	for _, id := range ids {
		e, err := s.LoadEvent(ctx, id)
		if err != nil {
			return nil, err
		}
		if e != nil {
			out = append(out, e)
		}
	}
	return out, nil
}

func (s *Store) EventsOfGuest(ctx context.Context, personID string) ([]*Event, error) {
	rows, err := s.Pool().Query(ctx, `SELECT event_id FROM guests WHERE person_id = $1`, personID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	var out []*Event
	for _, id := range ids {
		e, err := s.LoadEvent(ctx, id)
		if err != nil {
			return nil, err
		}
		if e != nil && (e.State == "live" || e.State == "restored") {
			out = append(out, e)
		}
	}
	return out, nil
}

// handleGetEvent gives one event or occurrence.
func (a *App) handleGetEvent(ctx context.Context, resp *apiResponse, person *Person, id, occurrenceID string) error {
	e, err := a.store.LoadEvent(ctx, id)
	if err != nil {
		return err
	}
	if e == nil {
		return apiErr(404, "not_found", "That event is not available.")
	}
	cal, _ := a.store.CalendarByID(ctx, e.CalendarID)
	access := a.store.Access(ctx, person, cal, e)
	if access == "none" {
		return apiErr(404, "not_found", "That event is not available.")
	}
	hours, _ := a.store.OfficeHoursAll(ctx)
	rules, _ := a.store.ZoneRules(ctx)
	moved := map[string]bool{}
	for _, r := range e.MovedRules {
		moved[r] = true
	}
	var occ *Occurrence
	if occurrenceID != "" {
		occ = FindOccurrence(e, occurrenceID, rules, moved)
		if occ == nil {
			return apiErr(404, "not_found", "That event is not available.")
		}
		if occ.IsDeleted {
			return apiErr(404, "not_found", "That event is not available.")
		}
		applyWarning(occ, e, rules, moved)
	} else {
		// without one, the event's first warned occurrence carries the warning
		occs := GenOccurrences(e, mustDate("1900-01-01"), mustDate("9999-12-31"), rules, moved)
		for _, o := range occs {
			if o.HasWarning {
				occ = o
				break
			}
		}
	}
	body := ProjectEvent(e, occ, access, person, hours)
	body["version"] = e.Version
	resp.w.Header().Set("ETag", fmt.Sprintf("%q", fmt.Sprint(e.Version)))
	return writeOkBody(resp, body)
}

func personNameByID(ctx context.Context, s *Store, id string) string {
	p, _ := s.PersonByID(ctx, id)
	if p == nil {
		return id
	}
	return p.Name
}
