package main

import (
	"time"
)

// project.go — the one place field projection lives. Each response carries
// exactly the published fields for the caller's access and no email address.

type ClockEntry struct {
	City        string `json:"city"`
	Time        string `json:"time"`
	Date        string `json:"date"`
	InsideHours bool   `json:"inside_hours"`
}

// ProjectEvent gives the event response for an access level.
func ProjectEvent(e *Event, occ *Occurrence, access string, viewer *Person, hours map[string]OfficeHours) map[string]any {
	m := map[string]any{}
	title := e.Title
	startLocal, endLocal := e.StartLocal(), e.EndLocal()
	startUTC, endUTC := eventInstants(e, occ)
	adjusted := false
	var clocks []ClockEntry
	if !e.AllDay {
		clocks = threeClocks(startUTC)
	}
	if occ != nil {
		title = occ.Title
		startLocal = occStartLocal(occ)
		endLocal = occEndLocal(occ)
		op := occInstants(occ)
		startUTC, endUTC = op.start, op.end
		_, gap := occStartInstant(occ, nil, nil)
		adjusted = gap
		if occ.AllDay {
			clocks = []ClockEntry{}
		} else {
			clocks = threeClocks(startUTC)
		}
	}
	switch access {
	case "full":
		shareLink := any(nil)
		if e.ShareLink != nil {
			shareLink = map[string]any{
				"token":      e.ShareLink.Token,
				"url":        "/share/" + e.ShareLink.Token,
				"expires_at": e.ShareLink.ExpiresAt.UTC().Format(time.RFC3339),
			}
		}
		m = map[string]any{
			"id": e.ID, "calendar_id": e.CalendarID,
			"organiser": map[string]any{"id": e.OrganiserID, "name": organiserName(e)},
			"title":     title,
			"kind":      e.Kind, "colour": e.Colour,
			"all_day":     e.AllDay,
			"start_local": startLocal, "end_local": endLocal,
			"zone":            e.Zone,
			"visibility":      e.Visibility,
			"reminders":       remindersList(e),
			"switches":        switchesMap(e.Switches),
			"version":         e.Version,
			"access":          "full",
			"adjusted":        adjusted,
			"clocks":          clocks,
			"start_utc":       utcString(startUTC, e.AllDay),
			"end_utc":         utcString(endUTC, e.AllDay),
			"rsvp":            rsvpMap(e, occ),
			"guests":          guestList(e, occ, false),
			"exceptions":      exceptionsList(e),
			"zone_warnings":   eventWarnings(e, occ),
			"share_link":      shareLink,
			"location":        e.Location,
			"notes":           e.Notes,
			"saved_at":        e.SavedAt.UTC().Format(time.RFC3339),
			"decline_message": strOrNil(e.DeclineMessage),
			"rrule":           strOrNil(e.RRule),
			"series_id":       strOrNil(e.SeriesID),
			"split_from":      strOrNil(e.SplitFrom),
			"my_reply":        nil, "my_proposals": nil, "proposals": nil,
		}
		if e.DeclineMode != nil {
			m["decline_mode"] = *e.DeclineMode
		} else {
			m["decline_mode"] = nil
		}
		m["proposals"] = proposalsList(e, occ, "")
	case "guest":
		m = map[string]any{
			"id": e.ID, "calendar_id": e.CalendarID,
			"organiser": map[string]any{"id": e.OrganiserID, "name": organiserName(e)},
			"title":     title, "location": e.Location, "notes": e.Notes,
			"kind": e.Kind, "colour": e.Colour,
			"all_day":     e.AllDay,
			"start_local": startLocal, "end_local": endLocal,
			"zone": e.Zone, "rrule": strOrNil(e.RRule),
			"reminders": remindersList(e),
			"switches":  switchesMap(e.Switches),
			"version":   e.Version, "access": "guest",
			"adjusted": adjusted, "clocks": clocks,
			"start_utc":     utcString(startUTC, e.AllDay),
			"end_utc":       utcString(endUTC, e.AllDay),
			"my_reply":      myReply(e, occ, viewer),
			"my_proposals":  myProposals(e, occ, viewer),
			"zone_warnings": occWarnings(occ),
		}
		if e.Switches.SeeGuestList || e.Switches.ModifyEvent {
			m["guests"] = guestList(e, occ, false)
			m["rsvp"] = rsvpMap(e, occ)
		}
	case "details":
		m = map[string]any{
			"id": e.ID, "calendar_id": e.CalendarID,
			"organiser": map[string]any{"id": e.OrganiserID, "name": organiserName(e)},
			"title":     title, "location": e.Location, "notes": e.Notes,
			"kind": e.Kind, "colour": e.Colour,
			"all_day":     e.AllDay,
			"start_local": startLocal, "end_local": endLocal,
			"zone": e.Zone, "rrule": strOrNil(e.RRule),
			"access": "details", "adjusted": adjusted,
			"clocks":    clocks,
			"start_utc": utcString(startUTC, e.AllDay),
			"end_utc":   utcString(endUTC, e.AllDay),
		}
		if e.Switches.SeeGuestList {
			m["guests"] = guestList(e, occ, true)
			m["rsvp"] = rsvpMap(e, occ)
		}
	case "busy":
		m = map[string]any{
			"id": e.ID, "calendar_id": e.CalendarID,
			"title":       "Busy",
			"all_day":     e.AllDay,
			"start_local": startLocal, "end_local": endLocal,
			"zone": e.Zone, "access": "busy",
			"clocks":    clocks,
			"start_utc": utcString(startUTC, e.AllDay),
			"end_utc":   utcString(endUTC, e.AllDay),
		}
	}
	return m
}

// ProjectOccurrence gives the occurrence response for an access level.
func ProjectOccurrence(e *Event, o *Occurrence, access string, viewer *Person, hours map[string]OfficeHours) map[string]any {
	m := ProjectEvent(e, o, access, viewer, hours)
	delete(m, "id")
	delete(m, "guests")
	delete(m, "rsvp")
	delete(m, "my_reply")
	delete(m, "my_proposals")
	delete(m, "proposals")
	delete(m, "exceptions")
	delete(m, "zone_warnings")
	delete(m, "share_link")
	delete(m, "saved_at")
	delete(m, "decline_message")
	delete(m, "decline_mode")
	delete(m, "visibility")
	m["occurrence_id"] = o.OccurrenceID
	m["event_id"] = o.EventID
	m["is_exception"] = o.IsException
	switch access {
	case "full":
		m["guests"] = guestList(e, o, false)
		m["rsvp"] = rsvpMap(e, o)
		m["zone_warnings"] = occWarnings(o)
		m["reminders"] = remindersList(e)
		m["switches"] = switchesMap(e.Switches)
		m["version"] = e.Version
		m["organiser"] = map[string]any{"id": e.OrganiserID, "name": organiserName(e)}
		m["location"] = o.Location
		m["notes"] = o.Notes
		m["adjusted"] = o.Adjusted
		m["clocks"] = occClocks(o)
		m["start_utc"] = utcString(occInstants(o).start, o.AllDay)
		m["end_utc"] = utcString(occInstants(o).end, o.AllDay)
		m["access"] = "full"
		m["rrule"] = strOrNil(e.RRule)
		m["series_id"] = strOrNil(e.SeriesID)
		m["split_from"] = strOrNil(e.SplitFrom)
		m["title"] = o.Title
		m["kind"] = o.Kind
		m["colour"] = o.Colour
		m["all_day"] = o.AllDay
		m["start_local"] = occStartLocal(o)
		m["end_local"] = occEndLocal(o)
		m["zone"] = o.Zone
	case "guest":
		m["reminders"] = remindersList(e)
		m["switches"] = switchesMap(e.Switches)
		m["version"] = e.Version
		m["organiser"] = map[string]any{"id": e.OrganiserID, "name": organiserName(e)}
		m["location"] = o.Location
		m["notes"] = o.Notes
		m["adjusted"] = o.Adjusted
		m["clocks"] = occClocks(o)
		m["start_utc"] = utcString(occInstants(o).start, o.AllDay)
		m["end_utc"] = utcString(occInstants(o).end, o.AllDay)
		m["access"] = "guest"
		m["rrule"] = strOrNil(e.RRule)
		m["series_id"] = strOrNil(e.SeriesID)
		m["title"] = o.Title
		m["kind"] = o.Kind
		m["colour"] = o.Colour
		m["all_day"] = o.AllDay
		m["start_local"] = occStartLocal(o)
		m["end_local"] = occEndLocal(o)
		m["zone"] = o.Zone
		m["my_reply"] = myReply(e, o, viewer)
		m["my_proposals"] = myProposals(e, o, viewer)
		m["zone_warnings"] = occWarnings(o)
		if e.Switches.SeeGuestList || e.Switches.ModifyEvent {
			m["guests"] = guestList(e, o, false)
			m["rsvp"] = rsvpMap(e, o)
		}
	case "details":
		m["organiser"] = map[string]any{"id": e.OrganiserID, "name": organiserName(e)}
		m["location"] = o.Location
		m["notes"] = o.Notes
		m["adjusted"] = o.Adjusted
		m["clocks"] = occClocks(o)
		m["start_utc"] = utcString(occInstants(o).start, o.AllDay)
		m["end_utc"] = utcString(occInstants(o).end, o.AllDay)
		m["access"] = "details"
		m["rrule"] = strOrNil(e.RRule)
		m["series_id"] = strOrNil(e.SeriesID)
		m["title"] = o.Title
		m["kind"] = o.Kind
		m["colour"] = o.Colour
		m["all_day"] = o.AllDay
		m["start_local"] = occStartLocal(o)
		m["end_local"] = occEndLocal(o)
		m["zone"] = o.Zone
		if e.Switches.SeeGuestList {
			m["guests"] = guestList(e, o, true)
			m["rsvp"] = rsvpMap(e, o)
		}
	case "busy":
		m["title"] = "Busy"
		m["all_day"] = o.AllDay
		m["start_local"] = occStartLocal(o)
		m["end_local"] = occEndLocal(o)
		m["zone"] = o.Zone
		m["access"] = "busy"
		m["clocks"] = occClocks(o)
		m["start_utc"] = utcString(occInstants(o).start, o.AllDay)
		m["end_utc"] = utcString(occInstants(o).end, o.AllDay)
	}
	return m
}

func occClocks(o *Occurrence) []ClockEntry {
	if o.AllDay {
		return []ClockEntry{}
	}
	start, _ := occInstants(o).start, occInstants(o).end
	return threeClocks(start)
}

func threeClocks(t time.Time) []ClockEntry {
	out := []ClockEntry{}
	for _, z := range zones {
		loc := InZone(t, z.Name)
		out = append(out, ClockEntry{
			City:        z.City,
			Time:        loc.Format("15:04"),
			Date:        loc.Format("Mon 2 Jan 2006"),
			InsideHours: insideWorkingHours(t, z.Name),
		})
	}
	return out
}

var officeHoursCache map[string]OfficeHours

func SetOfficeHours(h map[string]OfficeHours) { officeHoursCache = h }

func insideWorkingHours(t time.Time, zone string) bool {
	if officeHoursCache == nil {
		return false
	}
	h, ok := officeHoursCache[zone]
	if !ok {
		return false
	}
	loc := InZone(t, zone)
	wd := int(loc.Weekday())
	if wd == 0 {
		wd = 7
	}
	dayOK := false
	for _, d := range h.Days {
		if d == wd {
			dayOK = true
		}
	}
	if !dayOK {
		return false
	}
	minutes := loc.Hour()*60 + loc.Minute()
	open, _ := MinutesFromMidnight(h.Open)
	close_, _ := MinutesFromMidnight(h.Close)
	return minutes >= open && minutes < close_
}

type utcPair struct{ start, end time.Time }

func occInstants(o *Occurrence) utcPair {
	if o.AllDay {
		start, _, _ := InstantFromLocal(o.Zone, o.StartDate, 0)
		end, _, _ := InstantFromLocal(o.Zone, o.EndDate, 0)
		return utcPair{start, end.Add(24 * time.Hour)}
	}
	start := InstantFromLocalOr(o.Zone, o.StartDate, o.StartMinutes)
	if o.HasWarning {
		// the shown time is read as the saved wall time with the rule's shift
		// removed, so the instant stays as saved
		shifted := o.StartMinutes + o.ShiftMinutes
		start = InstantFromLocalOr(o.Zone, o.StartDate, shifted)
	}
	end := InstantFromLocalOr(o.Zone, o.EndDate, o.EndMinutes)
	if o.HasWarning && o.EndDate == o.StartDate {
		shiftedEnd := o.EndMinutes + o.ShiftMinutes
		end = InstantFromLocalOr(o.Zone, o.EndDate, shiftedEnd)
	}
	return utcPair{start, end}
}

func eventInstants(e *Event, occ *Occurrence) (time.Time, time.Time) {
	if occ != nil {
		pair := occInstants(occ)
		return pair.start, pair.end
	}
	if e.AllDay {
		start, _, _ := InstantFromLocal(e.Zone, e.StartDate, 0)
		end, _, _ := InstantFromLocal(e.Zone, e.EndDate, 0)
		return start, end.Add(24 * time.Hour)
	}
	return InstantFromLocalOr(e.Zone, e.StartDate, e.StartMinutes), InstantFromLocalOr(e.Zone, e.EndDate, e.EndMinutes)
}

func occStartLocal(o *Occurrence) string {
	if o.AllDay {
		return o.StartDate
	}
	return o.StartDate + "T" + minutesHM(o.StartMinutes)
}

func occEndLocal(o *Occurrence) string {
	if o.AllDay {
		return o.EndDate
	}
	return o.EndDate + "T" + minutesHM(o.EndMinutes)
}

func utcString(t time.Time, allDay bool) any {
	if allDay {
		return nil
	}
	return t.UTC().Format(time.RFC3339)
}

func strOrNil(s *string) any {
	if s == nil || *s == "" {
		return nil
	}
	return *s
}

func remindersList(e *Event) []int {
	if e.AllDay {
		return []int{}
	}
	out := []int{}
	return append(out, e.Reminders...)
}

func switchesMap(s EventSwitches) map[string]bool {
	return map[string]bool{
		"modify_event":   s.ModifyEvent,
		"invite_others":  s.InviteOthers,
		"see_guest_list": s.SeeGuestList,
	}
}

func organiserName(e *Event) string {
	if n, ok := organiserNames[e.OrganiserID]; ok {
		return n
	}
	return e.OrganiserID
}

// organiserNames is filled at boot from the people table.
var organiserNames = map[string]string{}

func guestList(e *Event, occ *Occurrence, namesOnly bool) []map[string]any {
	occID := ""
	if occ != nil {
		occID = occ.OccurrenceID
	}
	out := []map[string]any{}
	for _, g := range e.Guests {
		row := map[string]any{"person_id": g.PersonID, "name": g.Name, "answer": ReplyFor(e, g.PersonID, occID)}
		if !namesOnly {
			msg := ReplyMessageFor(e, g.PersonID, occID)
			row["message"] = msg
		}
		out = append(out, row)
	}
	return out
}

func rsvpMap(e *Event, occ *Occurrence) map[string]int {
	occID := ""
	if occ != nil {
		occID = occ.OccurrenceID
	}
	return RsvpCounts(e, occID)
}

func myReply(e *Event, occ *Occurrence, viewer *Person) map[string]any {
	if viewer == nil {
		return nil
	}
	occID := ""
	if occ != nil {
		occID = occ.OccurrenceID
	}
	return map[string]any{
		"answer":  ReplyFor(e, viewer.ID, occID),
		"message": ReplyMessageFor(e, viewer.ID, occID),
	}
}

type proposalRow struct {
	ID           string
	OccurrenceID string
	ProposerID   string
	ProposerName string
	StartLocal   string
	EndLocal     string
	Note         string
	Status       string
}

var eventProposals = map[string][]*proposalRow{}

func proposalsList(e *Event, occ *Occurrence, viewerID string) []map[string]any {
	out := []map[string]any{}
	for _, p := range eventProposals[e.ID] {
		out = append(out, proposalMap(p))
	}
	return out
}

func myProposals(e *Event, occ *Occurrence, viewer *Person) []map[string]any {
	if viewer == nil {
		return []map[string]any{}
	}
	out := []map[string]any{}
	for _, p := range eventProposals[e.ID] {
		if p.ProposerID == viewer.ID {
			out = append(out, proposalMap(p))
		}
	}
	return out
}

func proposalMap(p *proposalRow) map[string]any {
	return map[string]any{
		"id": p.ID, "occurrence_id": p.OccurrenceID,
		"proposer":    map[string]any{"id": p.ProposerID, "name": p.ProposerName},
		"start_local": p.StartLocal, "end_local": p.EndLocal,
		"note": p.Note, "status": p.Status,
	}
}

func exceptionsList(e *Event) []map[string]any {
	out := []map[string]any{}
	for _, ex := range e.Exceptions {
		row := map[string]any{
			"occurrence_id": ex.OccurrenceID,
			"deleted":       ex.Deleted,
		}
		if ex.StartDate != nil {
			row["start_local"] = *ex.StartDate + "T" + minutesHM(derefInt(ex.StartMinutes))
		}
		if ex.EndDate != nil {
			row["end_local"] = *ex.EndDate + "T" + minutesHM(derefInt(ex.EndMinutes))
		}
		if ex.Title != nil {
			row["title"] = *ex.Title
		}
		if ex.Location != nil {
			row["location"] = *ex.Location
		}
		if ex.Notes != nil {
			row["notes"] = *ex.Notes
		}
		out = append(out, row)
	}
	return out
}

func derefInt(p *int) int {
	if p == nil {
		return 0
	}
	return *p
}

func occWarnings(o *Occurrence) []map[string]any {
	out := []map[string]any{}
	if o == nil || !o.HasWarning {
		return out
	}
	return append(out, map[string]any{
		"rule_id": o.RuleID, "city": zoneByName[o.Zone].City,
		"effective_date": "", "new_offset": "",
		"shift_minutes": o.ShiftMinutes,
		"saved_time":    minutesHM(o.StartMinutes), "shown_time": minutesHM(o.StartMinutes + o.ShiftMinutes),
		"note": "",
	})
}

func eventWarnings(e *Event, occ *Occurrence) []map[string]any {
	return occWarnings(occ)
}
