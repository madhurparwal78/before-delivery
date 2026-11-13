package main

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
)

// ical.go — the iCalendar round trip: export, import and their handlers.

// ExportICS gives the calendar's text, with one VEVENT per event and no
// guest information.
func (a *App) ExportICS(ctx context.Context, person *Person, calID string) (string, error) {
	events, err := a.store.EventsOfCalendar(ctx, calID)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	b.WriteString("BEGIN:VCALENDAR\r\n")
	b.WriteString("VERSION:2.0\r\n")
	b.WriteString("PRODID:-//Sundial & Wren//Wren Calendar//EN\r\n")
	b.WriteString("CALSCALE:GREGORIAN\r\n")
	for _, e := range events {
		b.WriteString("BEGIN:VEVENT\r\n")
		b.WriteString("UID:" + e.ID + "\r\n")
		if e.AllDay {
			b.WriteString("DTSTART;VALUE=DATE:" + strings.ReplaceAll(e.StartDate, "-", "") + "\r\n")
			end, _ := ParseDate(e.EndDate)
			b.WriteString("DTEND;VALUE=DATE:" + FormatDate(end.AddDate(0, 0, 1)) + "\r\n")
		} else {
			b.WriteString("DTSTART;TZID=" + e.Zone + ":" + e.StartLocal() + "\r\n")
			b.WriteString("DTEND;TZID=" + e.Zone + ":" + e.EndLocal() + "\r\n")
		}
		summary := e.Title
		if e.Visibility == "private" {
			summary = "Busy"
		}
		b.WriteString("SUMMARY:" + escapeICSLine(summary) + "\r\n")
		if e.Location != "" {
			b.WriteString("LOCATION:" + escapeICSLine(e.Location) + "\r\n")
		}
		if e.Notes != "" {
			b.WriteString("DESCRIPTION:" + escapeICSLine(e.Notes) + "\r\n")
		}
		if e.RRule != nil && *e.RRule != "" {
			b.WriteString("RRULE:" + *e.RRule + "\r\n")
		}
		if e.Kind == "focus" || e.Kind == "out_of_office" {
			b.WriteString("X-WREN-KIND:" + e.Kind + "\r\n")
		} else {
			b.WriteString("X-WREN-KIND:event\r\n")
		}
		if e.Visibility == "private" {
			b.WriteString("CLASS:PRIVATE\r\n")
		}
		for _, ex := range e.Exceptions {
			if !ex.Deleted {
				continue
			}
			// EXDATE carries the original rule-generated start
			occ, ok := exDateOf(ex.OccurrenceID)
			if !ok {
				continue
			}
			if e.AllDay {
				b.WriteString("EXDATE;VALUE=DATE:" + strings.ReplaceAll(occ, "-", "") + "\r\n")
			} else {
				b.WriteString("EXDATE;TZID=" + e.Zone + ":" + occ + "T" + minutesHM(e.StartMinutes) + "\r\n")
			}
		}
		for _, ex := range e.Exceptions {
			if ex.Deleted || ex.StartDate == nil {
				continue
			}
			b.WriteString("BEGIN:VEVENT\r\n")
			b.WriteString("UID:" + e.ID + "\r\n")
			orig, _ := exDateOf(ex.OccurrenceID)
			if e.AllDay {
				b.WriteString("RECURRENCE-ID;VALUE=DATE:" + strings.ReplaceAll(orig, "-", "") + "\r\n")
				b.WriteString("DTSTART;VALUE=DATE:" + strings.ReplaceAll(*ex.StartDate, "-", "") + "\r\n")
				end := *ex.StartDate
				if ex.EndDate != nil {
					end = *ex.EndDate
				}
				endD, _ := ParseDate(end)
				b.WriteString("DTEND;VALUE=DATE:" + FormatDate(endD.AddDate(0, 0, 1)) + "\r\n")
			} else {
				b.WriteString("RECURRENCE-ID;TZID=" + e.Zone + ":" + orig + "T" + minutesHM(e.StartMinutes) + "\r\n")
				sm := e.StartMinutes
				if ex.StartMinutes != nil {
					sm = *ex.StartMinutes
				}
				b.WriteString("DTSTART;TZID=" + e.Zone + ":" + *ex.StartDate + "T" + minutesHM(sm) + "\r\n")
				em := e.EndMinutes
				if ex.EndMinutes != nil {
					em = *ex.EndMinutes
				}
				endD := *ex.StartDate
				if ex.EndDate != nil {
					endD = *ex.EndDate
				}
				b.WriteString("DTEND;TZID=" + e.Zone + ":" + endD + "T" + minutesHM(em) + "\r\n")
			}
			title := e.Title
			if ex.Title != nil {
				title = *ex.Title
			}
			if e.Visibility == "private" {
				title = "Busy"
			}
			b.WriteString("SUMMARY:" + escapeICSLine(title) + "\r\n")
			b.WriteString("END:VEVENT\r\n")
		}
		b.WriteString("END:VEVENT\r\n")
	}
	b.WriteString("END:VCALENDAR\r\n")
	return b.String(), nil
}

func exDateOf(occurrenceID string) (string, bool) {
	at := strings.Index(occurrenceID, "@")
	if at < 0 {
		return "", false
	}
	stamp := occurrenceID[at+1:]
	if len(stamp) < 8 {
		return "", false
	}
	return stamp[0:4] + "-" + stamp[4:6] + "-" + stamp[6:8], true
}

func escapeICSLine(s string) string {
	r := strings.NewReplacer("\\", "\\\\", ";", "\\;", ",", "\\,", "\r\n", "\\n", "\n", "\\n")
	return r.Replace(s)
}

type icsEvent struct {
	uid        string
	start      string // local datetime or date
	end        string
	allDay     bool
	summary    string
	location   string
	desc       string
	rrule      string
	kind       string
	private    bool
	recurrence string // the original start of a modified occurrence
	exdate     string
	isExdate   bool
	isMod      bool
}

// ParseICS reads an uploaded calendar and returns its events.
func ParseICS(data string) ([]*icsEvent, error) {
	unfolded := strings.ReplaceAll(strings.ReplaceAll(data, "\r\n ", ""), "\r\n\t", "")
	lines := strings.Split(unfolded, "\n")
	var events []*icsEvent
	var cur *icsEvent
	depth := 0
	for _, raw := range lines {
		line := strings.TrimSpace(strings.TrimRight(raw, "\r"))
		switch {
		case strings.HasPrefix(line, "BEGIN:VEVENT"):
			cur = &icsEvent{kind: "event"}
		case strings.HasPrefix(line, "END:VEVENT"):
			if cur != nil {
				events = append(events, cur)
				cur = nil
			}
			depth++
		default:
			if cur == nil {
				continue
			}
			applyICSLine(cur, line)
		}
	}
	if len(events) == 0 {
		return nil, fmt.Errorf("no events")
	}
	return events, nil
}

func applyICSLine(e *icsEvent, line string) {
	colon := strings.Index(line, ":")
	if colon < 0 {
		return
	}
	name := line[:colon]
	value := line[colon+1:]
	switch {
	case name == "UID":
		e.uid = value
	case strings.HasPrefix(name, "DTSTART"):
		if strings.Contains(name, "VALUE=DATE") || len(value) == 8 && strings.Count(value, "T") == 0 && len(value) == 8 {
			e.allDay = true
			e.start = value
		} else {
			e.start = strings.ReplaceAll(value, " ", "")
			if len(value) == 8 {
				e.allDay = true
				e.start = value
			}
		}
	case strings.HasPrefix(name, "DTEND"):
		if strings.Contains(name, "VALUE=DATE") || len(value) == 8 {
			e.allDay = true
			e.end = value
		} else {
			e.end = strings.ReplaceAll(value, " ", "")
			if len(value) == 8 {
				e.allDay = true
				e.end = value
			}
		}
	case name == "SUMMARY":
		e.summary = unescapeICS(value)
	case name == "LOCATION":
		e.location = unescapeICS(value)
	case name == "DESCRIPTION":
		e.desc = unescapeICS(value)
	case name == "RRULE":
		e.rrule = value
	case name == "X-WREN-KIND":
		e.kind = value
	case name == "CLASS" && value == "PRIVATE":
		e.private = true
	case strings.HasPrefix(name, "RECURRENCE-ID"):
		e.recurrence = value
		e.isMod = true
	case strings.HasPrefix(name, "EXDATE"):
		e.exdate = value
		e.isExdate = true
	}
}

func unescapeICS(s string) string {
	r := strings.NewReplacer("\\,", ",", "\\;", ";", "\\n", "\n", "\\", "")
	return r.Replace(r.Replace(s))
}

// handleExport stores the export in MinIO before the action succeeds.
func (a *App) handleExport(ctx context.Context, resp *apiResponse, person *Person, calID string) error {
	cal, err := a.store.CalendarByID(ctx, calID)
	if err != nil {
		return err
	}
	if cal == nil {
		return apiErr(404, "not_found", "Nothing is scheduled at this address.")
	}
	level, _ := a.store.ShareLevel(ctx, calID, person.ID)
	owner := cal.OwnerID != nil && *cal.OwnerID == person.ID
	if !owner && level == "free_busy" && person.Role != "office_manager" {
		return apiErr(403, "forbidden", "You need more access to export this calendar.")
	}
	ics, err := a.ExportICS(ctx, person, calID)
	if err != nil {
		return err
	}
	id := newID("exp")
	objectKey := "exports/" + id + ".ics"
	size, err := a.minio.Put(ctx, objectKey, "text/calendar", []byte(ics))
	if err != nil {
		return apiErr(503, "file_storage_unavailable", "File storage is not answering. Nothing was changed. Try again shortly.")
	}
	_, _ = a.store.Pool().Exec(ctx, `INSERT INTO exports (id, calendar_id, person_id, object_key, size_bytes, kind)
	  VALUES ($1,$2,$3,$4,$5,'export')`, id, calID, person.ID, objectKey, size)
	writeJSON(resp.w, http.StatusCreated, map[string]any{
		"id": id, "object_key": objectKey, "size_bytes": size,
		"url": "/api/exports/" + id + "/file",
	})
	return nil
}

func (a *App) handleExportFile(ctx context.Context, resp *apiResponse, person *Person, id string) error {
	var objectKey string
	err := a.store.Pool().QueryRow(ctx, `SELECT object_key FROM exports WHERE id=$1`, id).Scan(&objectKey)
	if err != nil {
		return apiErr(404, "not_found", "That export is not available.")
	}
	data, err := a.minio.Get(ctx, objectKey)
	if err != nil {
		return apiErr(503, "file_storage_unavailable", "File storage is not answering. Nothing was changed. Try again shortly.")
	}
	resp.w.Header().Set("Content-Type", "text/calendar")
	resp.w.WriteHeader(http.StatusOK)
	resp.w.Write(data)
	return nil
}

// handleImport stores the uploaded file in MinIO first, then creates events.
func (a *App) handleImport(ctx context.Context, resp *apiResponse, person *Person, calID string, body []byte) error {
	cal, err := a.store.CalendarByID(ctx, calID)
	if err != nil {
		return err
	}
	if cal == nil {
		return apiErr(404, "not_found", "Nothing is scheduled at this address.")
	}
	if cal.ReadOnly {
		return apiErr(403, "forbidden", "Public holidays cannot be changed.")
	}
	if a.store.Access(ctx, person, cal, nil) != "full" {
		return apiErr(403, "forbidden", "You need edit access to import into that calendar.")
	}
	events, err := ParseICS(string(body))
	if err != nil {
		return apiErr(422, "invalid_icalendar", "That file is not a calendar we can read.")
	}
	id := newID("imp")
	objectKey := "imports/" + id + ".ics"
	if _, err := a.minio.Put(ctx, objectKey, "text/calendar", body); err != nil {
		return apiErr(503, "file_storage_unavailable", "File storage is not answering. Nothing was changed. Try again shortly.")
	}
	// the file is stored; create the events
	now := a.clock.Now()
	created, updated := 0, 0
	skipped := []map[string]any{}
	defaults, _ := a.store.GuestDefaults(ctx)
	// group by uid: the base event and its modified occurrences
	type baseEvent struct {
		ev      *icsEvent
		mods    []*icsEvent
		exdates []string
	}
	bases := map[string]*baseEvent{}
	var order []string
	for _, e := range events {
		if e.uid == "" {
			continue
		}
		if _, ok := bases[e.uid]; !ok {
			bases[e.uid] = &baseEvent{}
			order = append(order, e.uid)
		}
		if e.isExdate {
			bases[e.uid].exdates = append(bases[e.uid].exdates, e.exdate)
			continue
		}
		if e.isMod {
			bases[e.uid].mods = append(bases[e.uid].mods, e)
			continue
		}
		if bases[e.uid].ev == nil {
			bases[e.uid].ev = e
		}
	}
	for _, uid := range order {
		base := bases[uid]
		if base.ev == nil {
			continue
		}
		// does the calendar already hold that UID from an earlier round trip?
		existing, _ := a.store.LoadEvent(ctx, uid)
		zone := cal.OwnerZone(a, ctx)
		allDay := base.ev.allDay
		startLocal := base.ev.start
		endLocal := base.ev.end
		if !allDay {
			// formats: 20270310T090000 or 2027-03-10T09:00
			startLocal = normaliseICSDateTime(startLocal)
			endLocal = normaliseICSDateTime(endLocal)
		}
		title := base.ev.summary
		var rrule *string
		if base.ev.rrule != "" {
			if _, err := ParseRRule(base.ev.rrule); err != nil {
				skipped = append(skipped, map[string]any{"uid": uid, "reason": "unsupported rule"})
				continue
			}
			s := base.ev.rrule
			rrule = &s
		}
		kind := base.ev.kind
		if kind != "focus" && kind != "out_of_office" {
			kind = "event"
		}
		visibility := "default"
		if base.ev.private {
			visibility = "private"
		}
		lt := parseICSLocal(startLocal, endLocal, allDay)
		if lt == nil {
			skipped = append(skipped, map[string]any{"uid": uid, "reason": "unsupported times"})
			continue
		}
		var eventID string
		if existing != nil && existing.CalendarID == calID {
			eventID = existing.ID
			_, _ = a.store.Pool().Exec(ctx, `UPDATE events SET title=$2, location=$3, notes=$4, kind=$5,
			  all_day=$6, start_date=$7, start_minutes=$8, end_date=$9, end_minutes=$10, zone=$11,
			  visibility=$12, rrule=$13, saved_at=$14, saved_date=$15, version=version+1
			  WHERE id=$1`,
				eventID, title, base.ev.location, base.ev.desc, kind, allDay,
				lt.startDate, lt.startMinutes, lt.endDate, lt.endMinutes, zone,
				visibility, nilDeref(rrule), now, InZone(now, zone).Format("2006-01-02"))
			_, _ = a.store.Pool().Exec(ctx, `DELETE FROM exceptions WHERE event_id=$1`, eventID)
			updated++
		} else {
			eventID = uid
			_, _ = a.store.Pool().Exec(ctx, `INSERT INTO events (id, calendar_id, organiser_id, title, location, notes, kind,
			  all_day, start_date, start_minutes, end_date, end_minutes, zone, visibility, rrule,
			  saved_at, saved_date, version)
			  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,1)`,
				eventID, calID, person.ID, title, base.ev.location, base.ev.desc, kind,
				allDay, lt.startDate, lt.startMinutes, lt.endDate, lt.endMinutes, zone,
				visibility, nilDeref(rrule), now, InZone(now, zone).Format("2006-01-02"))
			created++
		}
		_, _ = a.store.Pool().Exec(ctx, `INSERT INTO switches (event_id, modify_event, invite_others, see_guest_list)
		  VALUES ($1,$2,$3,$4) ON CONFLICT (event_id) DO UPDATE SET modify_event=$2, invite_others=$3, see_guest_list=$4`,
			eventID, defaults.ModifyEvent, defaults.InviteOthers, defaults.SeeGuestList)
		// apply deleted occurrences and modified occurrences
		e, _ := a.store.LoadEvent(ctx, eventID)
		if e != nil {
			for _, exd := range base.exdates {
				occID := occurrenceIDOf(e, exd)
				_, _ = a.store.Pool().Exec(ctx, `INSERT INTO exceptions (event_id, occurrence_id, deleted)
				  VALUES ($1,$2,true) ON CONFLICT (event_id, occurrence_id) DO UPDATE SET deleted=true`, eventID, occID)
			}
			for _, mod := range base.mods {
				orig := normaliseICSDateOnly(mod.recurrence)
				occID := occurrenceIDOf(e, orig)
				sd, sm := parseICSStart(mod.start)
				ed, em := parseICSStart(mod.end)
				_, _ = a.store.Pool().Exec(ctx, `INSERT INTO exceptions (event_id, occurrence_id, deleted, start_date, start_minutes, end_date, end_minutes)
				  VALUES ($1,$2,false,$3,$4,$5,$6) ON CONFLICT (event_id, occurrence_id) DO UPDATE SET deleted=false,
				  start_date=$3, start_minutes=$4, end_date=$5, end_minutes=$6`, eventID, occID, sd, sm, ed, em)
			}
		}
	}
	_, _ = a.store.Pool().Exec(ctx, `INSERT INTO imports (id, calendar_id, person_id, object_key, size_bytes)
	  VALUES ($1,$2,$3,$4,$5)`, id, calID, person.ID, objectKey, len(body))
	writeJSON(resp.w, http.StatusCreated, map[string]any{
		"id": id, "object_key": objectKey, "created": created,
		"updated": updated, "skipped": skipped,
	})
	return nil
}

// normaliseICSDateTime converts 20270310T090000 into 2027-03-10T09:00.
func normaliseICSDateTime(s string) string {
	if len(s) >= 15 && s[8] == 'T' {
		return s[0:4] + "-" + s[4:6] + "-" + s[6:8] + "T" + s[9:11] + ":" + s[11:13]
	}
	if len(s) == 16 && s[10] == 'T' {
		return s
	}
	return s
}

func normaliseICSDateOnly(s string) string {
	s = normaliseICSDateTime(s)
	if len(s) >= 10 {
		return s[0:10]
	}
	return s
}

func parseICSStart(s string) (string, int) {
	s = normaliseICSDateTime(s)
	if len(s) == 10 {
		return s, 0
	}
	if len(s) == 16 {
		d := s[0:10]
		m, _ := MinutesFromMidnight(s[11:16])
		return d, m
	}
	if len(s) == 15 {
		d := s[0:8]
		return d, 0
	}
	return s, 0
}

type icsLocalTimes struct {
	startDate, endDate       string
	startMinutes, endMinutes int
}

func parseICSLocal(start, end string, allDay bool) *icsLocalTimes {
	if allDay {
		sd := normaliseICSDateOnly(start)
		ed := normaliseICSDateOnly(end)
		if ed > sd {
			edD, _ := ParseDate(ed)
			ed = FormatDate(edD.AddDate(0, 0, -1))
		}
		if _, ok := ParseDate(sd); !ok {
			return nil
		}
		if _, ok := ParseDate(ed); !ok {
			return nil
		}
		return &icsLocalTimes{startDate: sd, endDate: ed}
	}
	sd, sm := parseICSStart(start)
	ed, em := parseICSStart(end)
	if _, ok := ParseDate(sd); !ok {
		return nil
	}
	if _, ok := ParseDate(ed); !ok {
		return nil
	}
	return &icsLocalTimes{startDate: sd, endDate: ed, startMinutes: sm, endMinutes: em}
}

func (c *Calendar) OwnerZone(a *App, ctx context.Context) string {
	if c.OwnerID != nil {
		if p, _ := a.store.PersonByID(ctx, *c.OwnerID); p != nil {
			return p.Zone
		}
	}
	return "Europe/London"
}

var _ = sort.Strings
var _ = time.RFC3339
