package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// api_mutate.go — creating and editing events, with scope, split and the
// first-save-wins rule.

type eventPatch struct {
	CalendarID     string         `json:"calendar_id"`
	Title          *string        `json:"title"`
	Location       *string        `json:"location"`
	Notes          *string        `json:"notes"`
	Kind           *string        `json:"kind"`
	Colour         *string        `json:"colour"`
	AllDay         *bool          `json:"all_day"`
	StartLocal     *string        `json:"start_local"`
	EndLocal       *string        `json:"end_local"`
	Zone           *string        `json:"zone"`
	Visibility     *string        `json:"visibility"`
	RRule          *string        `json:"rrule"`
	Reminders      []int          `json:"reminders"`
	DeclineMode    *string        `json:"decline_mode"`
	DeclineMessage *string        `json:"decline_message"`
	Switches       *EventSwitches `json:"switches"`
	Scope          string         `json:"scope"`
	OccurrenceID   string         `json:"occurrence_id"`
	GuestIDs       []string       `json:"guest_ids"`
}

type localTimes struct {
	startDate    string
	startMinutes int
	endDate      string
	endMinutes   int
	allDay       bool
	adjusted     bool
}

// parseLocalTimes reads the published field formats.
func parseLocalTimes(startLocal, endLocal *string, allDay bool, zone string) (*localTimes, map[string]string) {
	fields := map[string]string{}
	lt := &localTimes{allDay: allDay}
	if startLocal == nil {
		fields["start_local"] = "Use YYYY-MM-DD HH:MM."
		return nil, fields
	}
	if allDay {
		d, ok := ParseDate(*startLocal)
		if !ok {
			fields["start_local"] = "Use YYYY-MM-DD."
			return nil, fields
		}
		lt.startDate = FormatDate(d)
		if endLocal != nil {
			e, ok := ParseDate(*endLocal)
			if !ok {
				fields["end_local"] = "Use YYYY-MM-DD."
				return nil, fields
			}
			lt.endDate = FormatDate(e)
		} else {
			lt.endDate = lt.startDate
		}
		if lt.endDate < lt.startDate {
			fields["end_local"] = "End must be after start."
		}
		return lt, fields
	}
	sl := strings.TrimSpace(*startLocal)
	// the published form is YYYY-MM-DDTHH:MM; a space is accepted too
	parts := strings.Fields(sl)
	if len(parts) == 1 {
		if strings.Contains(parts[0], "T") {
			parts = strings.SplitN(parts[0], "T", 2)
		} else {
			fields["start_local"] = "Use YYYY-MM-DD HH:MM."
			return nil, fields
		}
	}
	if len(parts) != 2 {
		fields["start_local"] = "Use YYYY-MM-DD HH:MM."
		return nil, fields
	}
	d, ok := ParseDate(parts[0])
	if !ok {
		fields["start_local"] = "Use YYYY-MM-DD HH:MM."
		return nil, fields
	}
	sm, ok := MinutesFromMidnight(parts[1])
	if !ok {
		fields["start_local"] = "Use YYYY-MM-DD HH:MM."
		return nil, fields
	}
	lt.startDate, lt.startMinutes = FormatDate(d), sm
	el := ""
	if endLocal != nil {
		el = strings.TrimSpace(*endLocal)
	} else {
		fields["end_local"] = "Use YYYY-MM-DD HH:MM."
		return nil, fields
	}
	eparts := strings.Fields(el)
	if len(eparts) == 1 {
		if strings.Contains(eparts[0], "T") {
			eparts = strings.SplitN(eparts[0], "T", 2)
		} else {
			fields["end_local"] = "Use YYYY-MM-DD HH:MM."
			return nil, fields
		}
	}
	if len(eparts) != 2 {
		fields["end_local"] = "Use YYYY-MM-DD HH:MM."
		return nil, fields
	}
	ed, ok := ParseDate(eparts[0])
	if !ok {
		fields["end_local"] = "Use YYYY-MM-DD HH:MM."
		return nil, fields
	}
	em, ok := MinutesFromMidnight(eparts[1])
	if !ok {
		fields["end_local"] = "Use YYYY-MM-DD HH:MM."
		return nil, fields
	}
	lt.endDate, lt.endMinutes = FormatDate(ed), em
	if lt.endDate == lt.startDate {
		if lt.endMinutes <= lt.startMinutes {
			fields["end_local"] = "End must be after start."
		}
	} else if lt.endDate < lt.startDate {
		fields["end_local"] = "End must be after start."
	}
	return lt, fields
}

// validateEventFields gives the published field errors for a save.
func validateEventFields(p *eventPatch, lt *localTimes, zone string) map[string]string {
	fields := map[string]string{}
	if p.Title != nil && strings.TrimSpace(*p.Title) == "" {
		fields["title"] = "Enter a title."
	}
	if lt != nil {
		if lt.allDay {
			if lt.endDate < lt.startDate {
				fields["end_local"] = "End must be after start."
			}
		} else {
			start := lt.startDate + "T" + minutesHM(lt.startMinutes)
			end := lt.endDate + "T" + minutesHM(lt.endMinutes)
			if end <= start {
				fields["end_local"] = "End must be after start."
			}
		}
	}
	if p.RRule != nil && *p.RRule != "" {
		if _, err := ParseRRule(*p.RRule); err != nil {
			fields["rrule"] = "Use a daily, weekly, monthly or yearly repeat with INTERVAL, BYDAY, COUNT or UNTIL."
		}
	}
	if p.Zone != nil {
		if _, ok := ZoneFor(*p.Zone); !ok {
			fields["zone"] = "Choose New York, London or Auckland."
		}
	}
	if p.Visibility != nil && *p.Visibility != "default" && *p.Visibility != "private" {
		fields["visibility"] = "Visibility is default or private."
	}
	if p.DeclineMessage != nil && *p.DeclineMessage != "" {
		if len(*p.DeclineMessage) < 1 || len(*p.DeclineMessage) > 200 {
			fields["decline_message"] = "A decline message is 1 to 200 characters."
		}
	}
	if p.Colour != nil && *p.Colour != "" {
		switch *p.Colour {
		case "calendar", "rose", "amber", "teal", "indigo":
		default:
			fields["colour"] = "Choose Calendar colour, Rose, Amber, Teal or Indigo."
		}
	}
	return fields
}

// handleCreateEvent is POST /api/events.
func (a *App) handleCreateEvent(ctx context.Context, resp *apiResponse, person *Person, body []byte) error {
	var p eventPatch
	if err := jsonUnmarshal(body, &p); err != nil {
		return apiErr(422, "invalid", "That is not valid JSON.")
	}
	fields := map[string]string{}
	if p.Title == nil || strings.TrimSpace(*p.Title) == "" {
		fields["title"] = "Enter a title."
	}
	zone := person.Zone
	if p.Zone != nil && *p.Zone != "" {
		zone = *p.Zone
	}
	allDay := p.AllDay != nil && *p.AllDay
	if p.StartLocal == nil {
		fields["start_local"] = "Use YYYY-MM-DD HH:MM."
	}
	var lt *localTimes
	if p.StartLocal != nil {
		var lf map[string]string
		lt, lf = parseLocalTimes(p.StartLocal, p.EndLocal, allDay, zone)
		for k, v := range lf {
			fields[k] = v
		}
	}
	if p.RRule != nil && *p.RRule != "" {
		if _, err := ParseRRule(*p.RRule); err != nil {
			fields["rrule"] = "Use a daily, weekly, monthly or yearly repeat with INTERVAL, BYDAY, COUNT or UNTIL."
		}
	}
	if len(fields) > 0 {
		return apiFieldErr("Check the fields and try again.", fields)
	}
	// access: edit on that calendar
	cal, err := a.store.CalendarByID(ctx, p.CalendarID)
	if err != nil {
		return err
	}
	if cal == nil {
		return apiErr(404, "not_found", "Nothing is scheduled at this address.")
	}
	access := a.store.Access(ctx, person, cal, nil)
	if access != "full" {
		return apiErr(403, "forbidden", "You need edit access on that calendar.")
	}
	// validate rule start
	if p.RRule != nil && *p.RRule != "" {
		r, _ := ParseRRule(*p.RRule)
		if r != nil && lt != nil && !r.MatchesStartDate(lt.startDate) {
			return apiFieldErr("Check the fields and try again.", map[string]string{"rrule": "The start date must match the repeat rule."})
		}
	}
	kind := "event"
	if p.Kind != nil && *p.Kind != "" {
		kind = *p.Kind
	}
	defaults, _ := a.store.GuestDefaults(ctx)
	switches := EventSwitches{ModifyEvent: defaults.ModifyEvent, InviteOthers: defaults.InviteOthers, SeeGuestList: defaults.SeeGuestList}
	if p.Switches != nil {
		switches = *p.Switches
	}
	reminders := p.Reminders
	if reminders == nil {
		if !allDay && kind == "event" {
			reminders, _ = a.store.CalendarDefaultReminders(ctx, cal.ID)
		}
	}
	if reminders == nil {
		reminders = []int{}
	}
	id := newID("evt")
	now := a.clock.Now()
	adjusted := false
	if !allDay {
		_, _, gap := InstantFromLocal(zone, lt.startDate, lt.startMinutes)
		adjusted = gap
	}
	_ = adjusted
	savedDate := InZone(now, zone).Format("2006-01-02")
	err = a.store.Tx(ctx, func(tx pgx.Tx) error {
		var rrule *string
		if p.RRule != nil && *p.RRule != "" {
			s := *p.RRule
			rrule = &s
		}
		if _, err := tx.Exec(ctx, `INSERT INTO events (id, calendar_id, organiser_id, title, location, notes, kind, colour,
		  all_day, start_date, start_minutes, end_date, end_minutes, zone, visibility, rrule,
		  decline_mode, decline_message, saved_at, saved_date, version)
		  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,1)`,
			id, cal.ID, person.ID, strings.TrimSpace(*p.Title), strOr(p.Location, ""), strOr(p.Notes, ""),
			kind, strOr(p.Colour, "calendar"), allDay, lt.startDate, lt.startMinutes, lt.endDate, lt.endMinutes,
			zone, strOr(p.Visibility, "default"), rrule, strOrNil(p.DeclineMode), strOrNil(p.DeclineMessage),
			now, savedDate); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO switches (event_id, modify_event, invite_others, see_guest_list)
		  VALUES ($1,$2,$3,$4)`, id, switches.ModifyEvent, switches.InviteOthers, switches.SeeGuestList); err != nil {
			return err
		}
		for _, m := range reminders {
			if _, err := tx.Exec(ctx, `INSERT INTO event_reminders (event_id, minutes) VALUES ($1,$2)`, id, m); err != nil {
				return err
			}
		}
		for _, g := range p.GuestIDs {
			if _, err := tx.Exec(ctx, `INSERT INTO guests (event_id, person_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, id, g); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	e, _ := a.store.LoadEvent(ctx, id)
	// automatic declines for the new event's own window happen when guests are
	// invited; an out-of-office or focus event itself declines others below
	if kind == "focus" || kind == "out_of_office" {
		a.declineForWindow(ctx, e, kind, p.GuestIDs)
	} else if len(p.GuestIDs) > 0 {
		a.autoDeclineForGuests(ctx, e, p.GuestIDs)
	}
	a.notifyInvited(ctx, e, p.GuestIDs)
	a.broadcaster.BroadcastEvent(ctx, e)
	hours, _ := a.store.OfficeHoursAll(ctx)
	a.refreshRemindersForEvent(ctx, e)
	writeJSON(resp.w, http.StatusCreated, ProjectEvent(e, nil, "full", person, hours))
	return nil
}

func strOr(p *string, def string) string {
	if p == nil {
		return def
	}
	return *p
}

// versionFromETag reads the If-Match header value.
func versionFromETag(h string) (int, bool) {
	s := strings.TrimSpace(h)
	s = strings.Trim(s, `"`)
	if s == "" {
		return 0, false
	}
	var n int
	if _, err := fmt.Sscanf(s, "%d", &n); err != nil {
		return 0, false
	}
	return n, true
}

// checkVersion gives the published 428 or 412.
func checkVersion(e *Event, header string) error {
	if header == "" {
		return apiErr(428, "version_required", "Send the version you are editing.")
	}
	v, ok := versionFromETag(header)
	if !ok {
		return apiErr(428, "version_required", "Send the version you are editing.")
	}
	if v != e.Version {
		return &versionConflict{event: e}
	}
	return nil
}

type versionConflict struct{ event *Event }

func (v *versionConflict) Error() string { return "version conflict" }

// handlePatchEvent applies a save with scope and split.
func (a *App) handlePatchEvent(ctx context.Context, resp *apiResponse, person *Person, id string, body []byte) error {
	var p eventPatch
	if err := jsonUnmarshal(body, &p); err != nil {
		return apiErr(422, "invalid", "That is not valid JSON.")
	}
	var err error
	var e *Event
	var split *map[string]any
	_ = split
	err = a.store.Tx(ctx, func(tx pgx.Tx) error {
		var txErr error
		e, txErr = a.store.LoadEventTx(ctx, tx, id)
		if txErr != nil {
			return txErr
		}
		if e == nil {
			return apiErr(404, "not_found", "That event is not available.")
		}
		cal, txErr := a.store.CalendarByID(ctx, e.CalendarID)
		if txErr != nil {
			return txErr
		}
		access := a.store.Access(ctx, person, cal, e)
		if access != "full" {
			if !(access == "guest" && e.Switches.ModifyEvent) {
				return apiErr(403, "forbidden", "You need edit access on that event.")
			}
		}
		if txErr := checkVersion(e, resp.r.Header.Get("If-Match")); txErr != nil {
			return txErr
		}
		isGuestEdit := access == "guest"
		if isGuestEdit {
			// a guest may not change switches, guests, visibility, calendar
			p.Switches = nil
			p.GuestIDs = nil
			p.Visibility = nil
		}
		rules, _ := a.store.ZoneRules(ctx)
		moved := map[string]bool{}
		for _, mr := range e.MovedRules {
			moved[mr] = true
		}
		isSeries := e.RRule != nil && *e.RRule != ""
		scope := p.Scope
		if isSeries {
			if scope == "" {
				return apiFieldErr("Check the fields and try again.", map[string]string{"scope": "Choose This event, This and following events or All events."})
			}
			if p.OccurrenceID == "" && scope != "all" {
				return apiFieldErr("Check the fields and try again.", map[string]string{"occurrence_id": "Choose the occurrence to edit."})
			}
		} else {
			scope = "all"
		}
		// field-level application
		applyPatch := func(target *Event) map[string]string {
			fields := map[string]string{}
			changed := false
			if p.Title != nil && *p.Title != target.Title {
				target.Title = strings.TrimSpace(*p.Title)
				changed = true
			}
			if p.Location != nil && *p.Location != target.Location {
				target.Location = *p.Location
				changed = true
			}
			if p.Notes != nil && *p.Notes != target.Notes {
				target.Notes = *p.Notes
				changed = true
			}
			if p.Colour != nil && *p.Colour != target.Colour {
				target.Colour = *p.Colour
				changed = true
			}
			if p.Kind != nil && *p.Kind != target.Kind {
				target.Kind = *p.Kind
				changed = true
			}
			if p.Visibility != nil && *p.Visibility != target.Visibility {
				target.Visibility = *p.Visibility
				changed = true
			}
			if p.DeclineMode != nil {
				dm := *p.DeclineMode
				target.DeclineMode = &dm
				changed = true
			}
			if p.DeclineMessage != nil {
				dm := *p.DeclineMessage
				target.DeclineMessage = &dm
				changed = true
			}
			if p.Switches != nil {
				wasVisible := target.Switches.SeeGuestList
				target.Switches = *p.Switches
				if wasVisible && !target.Switches.SeeGuestList {
					// turning See guest list off kills the event's shared link
					if _, err := tx.Exec(ctx, `DELETE FROM share_links WHERE event_id=$1`, target.ID); err != nil {
						fields["switches"] = "The guest switches could not be saved."
					}
				}
				changed = true
			}
			if p.Reminders != nil {
				target.Reminders = p.Reminders
				changed = true
			}
			if p.Zone != nil && *p.Zone != target.Zone {
				target.Zone = *p.Zone
				changed = true
			}
			if p.AllDay != nil && *p.AllDay != target.AllDay {
				target.AllDay = *p.AllDay
				changed = true
			}
			if p.StartLocal != nil || p.EndLocal != nil {
				sl := p.StartLocal
				if sl == nil {
					s := target.StartLocal()
					sl = &s
				}
				el := p.EndLocal
				if el == nil {
					ev := target.EndLocal()
					el = &ev
				}
				lt, lf := parseLocalTimes(sl, el, target.AllDay, target.Zone)
				for k, v := range lf {
					fields[k] = v
				}
				if lt != nil {
					target.StartDate = lt.startDate
					target.StartMinutes = lt.startMinutes
					target.EndDate = lt.endDate
					target.EndMinutes = lt.endMinutes
					changed = true
				}
			}
			if p.RRule != nil {
				newRule := *p.RRule
				if newRule != "" {
					r, err := ParseRRule(newRule)
					if err != nil {
						fields["rrule"] = "Use a daily, weekly, monthly or yearly repeat with INTERVAL, BYDAY, COUNT or UNTIL."
					} else if r != nil && !r.MatchesStartDate(target.StartDate) {
						fields["rrule"] = "The start date must match the repeat rule."
					}
				}
				if newRule != strDeref(target.RRule) {
					target.RRule = &newRule
					changed = true
				}
			}
			_ = changed
			return fields
		}
		switch scope {
		case "all":
			fields := applyPatch(e)
			// exceptions whose overridden field is being edited take the new value
			for _, ex := range e.Exceptions {
				if ex.Deleted {
					continue
				}
				if p.Title != nil && ex.Title != nil {
					t := *p.Title
					ex.Title = &t
				}
				if p.Location != nil && ex.Location != nil {
					t := *p.Location
					ex.Location = &t
				}
				if p.Notes != nil && ex.Notes != nil {
					t := *p.Notes
					ex.Notes = &t
				}
				if p.StartLocal != nil || p.EndLocal != nil {
					if ex.StartDate != nil || ex.StartMinutes != nil {
						// the exception keeps its own time unless time itself is edited
						lt := parseTimesFromException(ex, e)
						if p.StartLocal != nil {
							if d, m, ok := parseStart(*p.StartLocal); ok {
								ex.StartDate = &d
								ex.StartMinutes = &m
							}
						}
						if p.EndLocal != nil {
							if d, m, ok := parseStart(*p.EndLocal); ok {
								ex.EndDate = &d
								ex.EndMinutes = &m
							}
						}
						_ = lt
					}
				}
			}
			if len(fields) > 0 {
				return apiFieldErr("Check the fields and try again.", fields)
			}
			if p.RRule != nil {
				// exceptions whose date no longer fit become standalone
				dropMisfitExceptions(ctx, tx, e, &p)
			}
			return a.saveEventTx(ctx, tx, e, person)
		case "this":
			// find the occurrence
			occ := FindOccurrence(e, p.OccurrenceID, rules, moved)
			if occ == nil || occ.IsDeleted {
				return apiErr(404, "not_found", "That event is not available.")
			}
			// apply the patch to a copy of the occurrence's values
			fields := applyPatchToException(ctx, tx, e, occ, &p)
			if len(fields) > 0 {
				return apiFieldErr("Check the fields and try again.", fields)
			}
			return a.saveEventTx(ctx, tx, e, person)
		case "following":
			occ := FindOccurrence(e, p.OccurrenceID, rules, moved)
			if occ == nil || occ.IsDeleted {
				return apiErr(404, "not_found", "That event is not available.")
			}
			if occ.OccurrenceID == firstOccurrenceID(e, rules) {
				// behaves as all
				fields := applyPatch(e)
				if len(fields) > 0 {
					return apiFieldErr("Check the fields and try again.", fields)
				}
				return a.saveEventTx(ctx, tx, e, person)
			}
			// split at the occurrence
			newID, txErr := splitSeriesAt(ctx, a, tx, e, occ, rules, moved)
			if txErr != nil {
				return txErr
			}
			later, txErr := a.store.LoadEventTx(ctx, tx, newID)
			if txErr != nil {
				return txErr
			}
			fields := applyPatch(later)
			if len(fields) > 0 {
				return apiFieldErr("Check the fields and try again.", fields)
			}
			if txErr := a.saveEventTx(ctx, tx, later, person); txErr != nil {
				return txErr
			}
			e = later
			return nil
		}
		return nil
	})
	if err != nil {
		var vc *versionConflict
		if errors.As(err, &vc) {
			winner := a.winnerName(ctx, vc.event)
			current, _ := a.store.LoadEvent(ctx, vc.event.ID)
			cal, _ := a.store.CalendarByID(ctx, current.CalendarID)
			access := a.store.Access(ctx, person, cal, current)
			hours, _ := a.store.OfficeHoursAll(ctx)
			writeJSONStatus(resp.w, 412, map[string]any{
				"error":   "version_conflict",
				"message": fmt.Sprintf("%s saved this first.", winner),
				"current": ProjectEvent(current, nil, access, person, hours),
			})
			return nil
		}
		return err
	}
	// reload for broadcast and response
	e, _ = a.store.LoadEvent(ctx, id)
	if e == nil {
		e, _ = a.store.LoadEvent(ctx, e0ID)
	}
	_ = e
	return nil
}

var e0ID string

func strDeref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func parseStart(s string) (string, int, bool) {
	parts := strings.SplitN(strings.TrimSpace(s), " ", 2)
	if len(parts) == 1 {
		d, ok := ParseDate(parts[0])
		if !ok {
			return "", 0, false
		}
		return FormatDate(d), 0, true
	}
	d, ok := ParseDate(parts[0])
	if !ok {
		return "", 0, false
	}
	m, ok := MinutesFromMidnight(parts[1])
	if !ok {
		return "", 0, false
	}
	return FormatDate(d), m, true
}

func parseTimesFromException(ex *ExceptionRow, e *Event) localTimes {
	lt := localTimes{}
	if ex.StartDate != nil {
		lt.startDate = *ex.StartDate
	} else {
		lt.startDate = e.StartDate
	}
	if ex.StartMinutes != nil {
		lt.startMinutes = *ex.StartMinutes
	} else {
		lt.startMinutes = e.StartMinutes
	}
	if ex.EndDate != nil {
		lt.endDate = *ex.EndDate
	} else {
		lt.endDate = e.EndDate
	}
	if ex.EndMinutes != nil {
		lt.endMinutes = *ex.EndMinutes
	} else {
		lt.endMinutes = e.EndMinutes
	}
	return lt
}

func firstOccurrenceID(e *Event, rules []*ZoneRule) string {
	rr := e.Rule()
	if rr == nil {
		return e.ID
	}
	dates := rr.Expand(e.StartDate, 1, time.Time{})
	if len(dates) == 0 {
		return e.ID
	}
	return occurrenceIDOf(e, dates[0])
}

func occurrenceIDOf(e *Event, date string) string {
	if e.AllDay {
		return e.ID + "@" + strings.ReplaceAll(date, "-", "")
	}
	return e.ID + "@" + strings.ReplaceAll(date, "-", "") + "T" + strings.ReplaceAll(minutesHM(e.StartMinutes), ":", "")
}

// applyPatchToException writes a this-scope edit as an exception.
func applyPatchToException(ctx context.Context, tx pgx.Tx, e *Event, occ *Occurrence, p *eventPatch) map[string]string {
	fields := map[string]string{}
	ex := occ.Exception
	if ex == nil {
		ex = &ExceptionRow{OccurrenceID: occ.OccurrenceID}
	}
	startDate, startMinutes := occ.StartDate, occ.StartMinutes
	endDate, endMinutes := occ.EndDate, occ.EndMinutes
	title, location, notes := occ.Title, occ.Location, occ.Notes
	if p.Title != nil {
		if strings.TrimSpace(*p.Title) == "" {
			fields["title"] = "Enter a title."
		}
		title = strings.TrimSpace(*p.Title)
	}
	if p.Location != nil {
		location = *p.Location
	}
	if p.Notes != nil {
		notes = *p.Notes
	}
	if p.StartLocal != nil || p.EndLocal != nil {
		sl := p.StartLocal
		if sl == nil {
			s := startDate + "T" + minutesHM(startMinutes)
			sl = &s
		}
		el := p.EndLocal
		if el == nil {
			ev := endDate + "T" + minutesHM(endMinutes)
			el = &ev
		}
		lt, lf := parseLocalTimes(sl, el, occ.AllDay, e.Zone)
		for k, v := range lf {
			fields[k] = v
		}
		if lt != nil {
			startDate, startMinutes = lt.startDate, lt.startMinutes
			endDate, endMinutes = lt.endDate, lt.endMinutes
		}
	}
	if len(fields) > 0 {
		return fields
	}
	sd, sm, en, em := startDate, startMinutes, endDate, endMinutes
	ex.StartDate, ex.StartMinutes = &sd, &sm
	ex.EndDate, ex.EndMinutes = &en, &em
	ex.Title, ex.Location, ex.Notes = &title, &location, &notes
	if _, err := tx.Exec(ctx, `INSERT INTO exceptions (event_id, occurrence_id, deleted, start_date, start_minutes, end_date, end_minutes, title, location, notes)
	  VALUES ($1,$2,false,$3,$4,$5,$6,$7,$8,$9)
	  ON CONFLICT (event_id, occurrence_id) DO UPDATE SET start_date = $3, start_minutes = $4,
	  end_date = $5, end_minutes = $6, title = $7, location = $8, notes = $9`,
		e.ID, ex.OccurrenceID, sd, sm, en, em, title, location, notes); err != nil {
		fields["occurrence_id"] = "That occurrence could not be saved."
	}
	return fields
}

// splitSeriesAt ends the series the day before the occurrence and starts a
// new one there, moving dated exceptions, answers and proposals.
func splitSeriesAt(ctx context.Context, a *App, tx pgx.Tx, e *Event, occ *Occurrence, rules []*ZoneRule, moved map[string]bool) (string, error) {
	newID := newID("evt")
	splitFrom := e.ID
	rr := e.Rule()
	// the earlier series ends the day before that occurrence's original date
	origDate := originalDateOf(occ)
	if rr == nil {
		return "", apiErr(422, "invalid", "A single event cannot be split.")
	}
	prevDate := addDays(origDate, -1)
	countRemaining := 0
	allDates := rr.Expand(e.StartDate, 0, time.Time{})
	before, after := 0, 0
	for _, d := range allDates {
		if d < origDate {
			before++
		} else if d >= origDate {
			after++
		}
	}
	_ = countRemaining
	prevDateStr := prevDate
	untilPart := "UNTIL=" + strings.ReplaceAll(prevDateStr, "-", "")
	earlierRule := rewriteUntil(*e.RRule, untilPart)
	laterRule := rewriteUntilLater(*e.RRule, origDate, after)
	_, err := tx.Exec(ctx, `UPDATE events SET rrule = $2 WHERE id = $1`, e.ID, earlierRule)
	if err != nil {
		return "", err
	}
	_, err = tx.Exec(ctx, `INSERT INTO events (id, calendar_id, series_id, split_from, organiser_id, title, location, notes,
	  kind, colour, all_day, start_date, start_minutes, end_date, end_minutes, zone, visibility, rrule,
	  decline_mode, decline_message, saved_at, saved_date, version, moved_rules)
	  SELECT $1, calendar_id, $2, $3, organiser_id, title, location, notes, kind, colour, all_day,
	  $4, start_minutes, $5, end_minutes, zone, visibility, $6, decline_mode, decline_message, now(), $7, 1, moved_rules
	  FROM events WHERE id = $8`,
		newID, e.SeriesID, splitFrom, origDate, addDays(origDate, daysBetween(occ.StartDate, occ.EndDate)-0), laterRule,
		InZone(a.clock.Now(), e.Zone).Format("2006-01-02"), e.ID)
	if err != nil {
		return "", err
	}
	// fix the new event's end date for the moved occurrence
	_, _ = tx.Exec(ctx, `UPDATE events SET end_date = $2 WHERE id = $1`, newID, occ.EndDate)
	// copy switches
	_, err = tx.Exec(ctx, `INSERT INTO switches (event_id, modify_event, invite_others, see_guest_list)
	  SELECT $1, modify_event, invite_others, see_guest_list FROM switches WHERE event_id = $2`, newID, e.ID)
	if err != nil {
		return "", err
	}
	// copy reminders
	_, err = tx.Exec(ctx, `INSERT INTO event_reminders (event_id, minutes)
	  SELECT $1, minutes FROM event_reminders WHERE event_id = $2`, newID, e.ID)
	if err != nil {
		return "", err
	}
	// move guests with series answers, and move dated replies, exceptions and proposals
	_, err = tx.Exec(ctx, `INSERT INTO guests (event_id, person_id, series_answer)
	  SELECT $1, person_id, series_answer FROM guests WHERE event_id = $2 ON CONFLICT DO NOTHING`, newID, e.ID)
	if err != nil {
		return "", err
	}
	// exceptions on or after the split date move to the new series
	_, err = tx.Exec(ctx, `UPDATE exceptions SET event_id = $1 WHERE event_id = $2 AND occurrence_id >= $3`,
		newID, e.ID, occurrenceIDOf(e, origDate))
	if err != nil {
		return "", err
	}
	_, err = tx.Exec(ctx, `UPDATE replies SET event_id = $1 WHERE event_id = $2 AND occurrence_id >= $3`,
		newID, e.ID, occurrenceIDOf(e, origDate))
	if err != nil {
		return "", err
	}
	_, err = tx.Exec(ctx, `UPDATE proposals SET event_id = $1 WHERE event_id = $2 AND status = 'proposed' AND occurrence_id >= $3`,
		newID, e.ID, occurrenceIDOf(e, origDate))
	if err != nil {
		return "", err
	}
	// raise both versions
	_, _ = tx.Exec(ctx, `UPDATE events SET version = version + 1, saved_at = now(), saved_date = $2 WHERE id = $1`, e.ID, InZone(a.clock.Now(), e.Zone).Format("2006-01-02"))
	_, _ = tx.Exec(ctx, `UPDATE events SET version = version + 1, saved_at = now() WHERE id = $1`, newID)
	return newID, nil
}

func originalDateOf(occ *Occurrence) string {
	// the occurrence id holds the original rule-generated date
	id := occ.OccurrenceID
	at := strings.Index(id, "@")
	if at < 0 {
		return occ.StartDate
	}
	stamp := id[at+1:]
	if len(stamp) < 8 {
		return occ.StartDate
	}
	return stamp[0:4] + "-" + stamp[4:6] + "-" + stamp[6:8]
}

func rewriteUntil(rule, until string) string {
	parts := strings.Split(rule, ";")
	out := []string{}
	for _, p := range parts {
		if strings.HasPrefix(p, "COUNT=") {
			continue
		}
		if strings.HasPrefix(p, "UNTIL=") {
			continue
		}
		out = append(out, p)
	}
	return strings.Join(out, ";") + ";" + until
}

func rewriteUntilLater(rule, fromDate string, remaining int) string {
	parts := strings.Split(rule, ";")
	out := []string{}
	for _, p := range parts {
		if strings.HasPrefix(p, "COUNT=") || strings.HasPrefix(p, "UNTIL=") {
			continue
		}
		out = append(out, p)
	}
	// if the original had a COUNT, the later series takes the remainder
	for _, p := range parts {
		if strings.HasPrefix(p, "COUNT=") {
			return strings.Join(out, ";") + ";COUNT=" + fmt.Sprint(remaining)
		}
	}
	return strings.Join(out, ";")
}

// saveEventTx bumps the version and writes the changed columns.
func (a *App) saveEventTx(ctx context.Context, tx pgx.Tx, e *Event, person *Person) error {
	_, err := tx.Exec(ctx, `UPDATE events SET title=$2, location=$3, notes=$4, kind=$5, colour=$6,
	  all_day=$7, start_date=$8, start_minutes=$9, end_date=$10, end_minutes=$11, zone=$12,
	  visibility=$13, rrule=$14, decline_mode=$15, decline_message=$16,
	  saved_at=now(), saved_date=$17, version=version+1, last_save_person=$18
	  WHERE id=$1`,
		e.ID, e.Title, e.Location, e.Notes, e.Kind, e.Colour, e.AllDay,
		e.StartDate, e.StartMinutes, e.EndDate, e.EndMinutes, e.Zone,
		e.Visibility, nilDeref(e.RRule), nilDerefP(e.DeclineMode), nilDerefP(e.DeclineMessage),
		InZone(a.clock.Now(), e.Zone).Format("2006-01-02"), person.ID)
	if err != nil {
		return err
	}
	// switches and reminders follow the patch
	if _, err := tx.Exec(ctx, `INSERT INTO switches (event_id, modify_event, invite_others, see_guest_list)
	  VALUES ($1,$2,$3,$4) ON CONFLICT (event_id) DO UPDATE SET modify_event=$2, invite_others=$3, see_guest_list=$4`,
		e.ID, e.Switches.ModifyEvent, e.Switches.InviteOthers, e.Switches.SeeGuestList); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM event_reminders WHERE event_id=$1`, e.ID); err != nil {
		return err
	}
	if e.AllDay {
		e.Reminders = nil
	}
	for _, m := range e.Reminders {
		if _, err := tx.Exec(ctx, `INSERT INTO event_reminders (event_id, minutes) VALUES ($1,$2)`, e.ID, m); err != nil {
			return err
		}
	}
	if e.Visibility == "private" {
		// a private event carries no live link
		if _, err := tx.Exec(ctx, `DELETE FROM share_links WHERE event_id=$1`, e.ID); err != nil {
			return err
		}
	}
	// exceptions may have been edited in place
	for _, ex := range e.Exceptions {
		if ex.StartDate == nil {
			continue
		}
		if _, err := tx.Exec(ctx, `UPDATE exceptions SET start_date=$3, start_minutes=$4, end_date=$5, end_minutes=$6,
		  title=$7, location=$8, notes=$9 WHERE event_id=$1 AND occurrence_id=$2`,
			e.ID, ex.OccurrenceID, strPtrOrNil(ex.StartDate), intPtrOrNil(ex.StartMinutes),
			strPtrOrNil(ex.EndDate), intPtrOrNil(ex.EndMinutes),
			strPtrOrNil(ex.Title), strPtrOrNil(ex.Location), strPtrOrNil(ex.Notes)); err != nil {
			return err
		}
	}
	return nil
}

func nilDeref(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}

func nilDerefP(s *string) any { return nilDeref(s) }

func strPtrOrNil(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}

func intPtrOrNil(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}

// winnerName gives the person who saved first.
func (a *App) winnerName(ctx context.Context, e *Event) string {
	if e.LastSavePerson != nil && *e.LastSavePerson != "" {
		if p, _ := a.store.PersonByID(ctx, *e.LastSavePerson); p != nil {
			return p.Name
		}
	}
	if p, _ := a.store.PersonByID(ctx, e.OrganiserID); p != nil {
		return p.Name
	}
	return "Someone"
}

// dropMisfitExceptions removes deleted exceptions whose date no longer fits
// and keeps modified ones as standalone occurrences.
func dropMisfitExceptions(ctx context.Context, tx pgx.Tx, e *Event, p *eventPatch) {
	if p.RRule == nil {
		return
	}
	r, err := ParseRRule(*p.RRule)
	if err != nil || r == nil {
		return
	}
	for _, ex := range e.Exceptions {
		if ex.StartDate == nil {
			continue
		}
		if !r.MatchesStartDate(*ex.StartDate) {
			if ex.Deleted {
				_, _ = tx.Exec(ctx, `DELETE FROM exceptions WHERE event_id=$1 AND occurrence_id=$2`, e.ID, ex.OccurrenceID)
			}
			// a modified misfit stays as a standalone occurrence by keeping its row
		}
	}
}

// notifyInvited writes one notice per invited person.
func (a *App) notifyInvited(ctx context.Context, e *Event, guestIDs []string) {
	for _, g := range guestIDs {
		if g == e.OrganiserID {
			continue
		}
		text := fmt.Sprintf("You are invited to %s.", e.Title)
		_ = a.store.InsertNoticePool(ctx, g, "invitation", text, nil)
		a.broadcaster.PushPersonal(nil, g, "invitation", map[string]any{
			"event_id": e.ID, "text": fmt.Sprintf("%s invited you to %s.", a.personName(ctx, e.OrganiserID), e.Title),
		})
	}
}

func (a *App) personName(ctx context.Context, id string) string {
	p, _ := a.store.PersonByID(ctx, id)
	if p == nil {
		return "Someone"
	}
	return p.Name
}

// autoDeclineForGuests declines overlapping occurrences for a person's
// windows when they are invited.
func (a *App) autoDeclineForGuests(ctx context.Context, e *Event, guestIDs []string) {
	for _, g := range guestIDs {
		if g == e.OrganiserID {
			continue
		}
		a.recheckDeclinesForPerson(ctx, e, g)
	}
}

// recheckDeclinesForPerson answers no for occurrences overlapping the
// person's out-of-office or focus windows.
func (a *App) recheckDeclinesForPerson(ctx context.Context, e *Event, personID string) {
	windows, err := a.store.declineWindowsOf(ctx, personID, e.ID)
	if err != nil {
		return
	}
	if len(windows) == 0 {
		return
	}
	guest, err := a.store.PersonByID(ctx, personID)
	if err != nil || guest == nil {
		return
	}
	rules, _ := a.store.ZoneRules(ctx)
	moved := map[string]bool{}
	if e.MovedRules != nil {
		for _, r := range e.MovedRules {
			moved[r] = true
		}
	}
	// occurrences in a wide window around now
	occs := GenOccurrences(e, mustDate("1900-01-01"), mustDate("9999-12-31"), rules, moved)
	for _, o := range occs {
		op := occInstants(o)
		for _, w := range windows {
			if overlap(op.start, op.end, w.start, w.end) {
				if e.CalendarID == guestOwnCalendar(ctx, a, personID) {
					continue
				}
				msg := w.message
				if msg == "" {
					msg = w.publishedCopy
				}
				a.setReplyNo(ctx, e, o, personID, msg)
				break
			}
		}
	}
}

func guestOwnCalendar(ctx context.Context, a *App, personID string) string {
	return "cal-" + strings.TrimPrefix(personID, "p-")
}

func (a *App) setReplyNo(ctx context.Context, e *Event, o *Occurrence, personID, msg string) {
	isSeries := e.RRule != nil && *e.RRule != ""
	occID := o.OccurrenceID
	if !isSeries {
		// a single event carries its answer at the event level, with its message
		occID = e.ID
		if _, err := a.store.Pool().Exec(ctx, `UPDATE guests SET series_answer='no' WHERE event_id=$1 AND person_id=$2`,
			e.ID, personID); err != nil {
			return
		}
	}
	_, err := a.store.Pool().Exec(ctx, `INSERT INTO replies (event_id, person_id, occurrence_id, answer, message)
	  VALUES ($1,$2,$3,'no',$4)
	  ON CONFLICT (event_id, person_id, occurrence_id) DO UPDATE SET answer='no', message=$4`,
		e.ID, personID, occID, msg)
	if err != nil {
		return
	}
	a.decideNotice(ctx, e, personID, msg, "decline")
}

func overlap(a1, a2, b1, b2 time.Time) bool {
	return a1.Before(b2) && a2.After(b1)
}

func (a *App) declineForWindow(ctx context.Context, e *Event, kind string, guestIDs []string) {
	// focus new_and_existing: every overlapping occurrence where the person
	// is a guest becomes no. out of office: list conflicts, keep answers.
	if kind != "focus" {
		return
	}
	mode := "new_and_existing"
	if e.DeclineMode != nil && *e.DeclineMode == "new_only" {
		mode = "new_only"
	}
	if mode != "new_and_existing" {
		return
	}
	a.declineExistingForWindow(ctx, e)
}

// declineExistingForWindow declines every overlapping occurrence where the
// owner of the window is a guest.
func (a *App) declineExistingForWindow(ctx context.Context, window *Event) {
	owner, _ := a.store.PersonByID(ctx, window.OrganiserID)
	if owner == nil {
		return
	}
	guestEvents, err := a.store.EventsOfGuest(ctx, window.OrganiserID)
	if err != nil {
		return
	}
	rules, _ := a.store.ZoneRules(ctx)
	movedW := map[string]bool{}
	for _, r := range window.MovedRules {
		movedW[r] = true
	}
	wOccs := GenOccurrences(window, mustDate("1900-01-01"), mustDate("9999-12-31"), rules, movedW)
	for _, e := range guestEvents {
		if e.ID == window.ID {
			continue
		}
		if e.CalendarID == guestOwnCalendar(ctx, a, window.OrganiserID) {
			continue
		}
		movedE := map[string]bool{}
		for _, r := range e.MovedRules {
			movedE[r] = true
		}
		occs := GenOccurrences(e, mustDate("1900-01-01"), mustDate("9999-12-31"), rules, movedE)
		for _, o := range occs {
			op := occInstants(o)
			for _, w := range wOccs {
				wp := occInstants(w)
				if overlap(op.start, op.end, wp.start, wp.end) {
					msg := window.DeclineMessage
					if msg == nil || *msg == "" {
						msg = strp(fmt.Sprintf("%s is in focus time until %s, so %s was declined automatically.",
							a.personName(ctx, window.OrganiserID), focusEndTime(window, w), e.Title))
					}
					a.setReplyNo(ctx, e, o, window.OrganiserID, *msg)
					break
				}
			}
		}
	}
}

func focusEndTime(window *Event, w *Occurrence) string {
	return occEndLocal(w)[len(w.StartDate)+1:]
}

func strp(s string) *string { return &s }

func (a *App) decideNotice(ctx context.Context, e *Event, personID, text, kind string) {
	decisionID := uuid.NewString()
	_ = decisionID
	// organiser and full-access people, plus the affected guest
	people := map[string]bool{e.OrganiserID: true, personID: true}
	a.broadcaster.PushDecision(ctx, e, personID, kind, text)
	_ = people
}
