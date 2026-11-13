package main

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

func icsEscape(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `;`, `\;`, `,`, `\,`, "\r\n", `\n`, "\n", `\n`)
	return r.Replace(s)
}

func icsUnescape(s string) string {
	r := strings.NewReplacer(`\n`, "\n", `\N`, "\n", `\,`, ",", `\;`, ";", `\\`, `\`)
	return r.Replace(s)
}

// fold wraps a content line at 75 octets with a leading space on continuation lines.
func fold(line string) string {
	var out strings.Builder
	for len(line) > 75 {
		cut := 75
		for cut > 0 && line[cut]&0xC0 == 0x80 {
			cut--
		}
		out.WriteString(line[:cut] + "\r\n ")
		line = line[cut:]
	}
	out.WriteString(line + "\r\n")
	return out.String()
}

func icsStamp(w wall) string { return w.Format("20060102T150405") }

func icsWhen(name string, e *Event, w wall) string {
	if e.AllDay {
		return name + ";VALUE=DATE:" + w.Format("20060102")
	}
	return name + ";TZID=" + e.Zone + ":" + icsStamp(w)
}

// buildICS writes one VEVENT per event plus one per modified occurrence, shaped by the caller's access.
func (w *World) buildICS(viewer *Person, events []*Event) string {
	var out strings.Builder
	line := func(s string) { out.WriteString(fold(s)) }
	line("BEGIN:VCALENDAR")
	line("VERSION:2.0")
	line("PRODID:-//Sundial & Wren//Wren Calendar//EN")
	stamp := w.Now.Format("20060102T150405Z")
	for _, e := range events {
		access := w.access(e, viewer)
		if access == "" {
			continue
		}
		write := func(o *Occurrence, recurrence string) {
			line("BEGIN:VEVENT")
			line("UID:" + e.ID)
			line("DTSTAMP:" + stamp)
			if recurrence != "" {
				line(icsWhen("RECURRENCE-ID", e, wallFromKey(recurrence)))
			}
			start, end := o.SavedStart, o.SavedEnd
			if e.AllDay {
				end = end.AddDate(0, 0, 1)
			}
			line(icsWhen("DTSTART", e, start))
			line(icsWhen("DTEND", e, end))
			fields := w.project(View{Viewer: viewer, E: e, O: o, Access: access, ForOccurrence: true, Key: o.ReplyKey()})
			text := func(name string) string { s, _ := fields[name].(string); return s }
			line("SUMMARY:" + icsEscape(text("title")))
			if v := text("location"); v != "" {
				line("LOCATION:" + icsEscape(v))
			}
			if v := text("notes"); v != "" {
				line("DESCRIPTION:" + icsEscape(v))
			}
			if v := text("kind"); v != "" {
				line("X-WREN-KIND:" + v)
			}
			if text("visibility") == "private" {
				line("CLASS:PRIVATE")
			}
			if recurrence == "" && e.recurring() {
				line("RRULE:" + *e.RRule)
				for _, key := range sortedKeys(e.Exceptions) {
					if e.Exceptions[key].Deleted {
						line(icsWhen("EXDATE", e, wallFromKey(key)))
					}
				}
			}
			line("END:VEVENT")
		}
		write(w.buildWith(e, e.baseStart(), nil), "")
		for _, key := range sortedKeys(e.Exceptions) {
			if x := e.Exceptions[key]; !x.Deleted {
				write(w.buildWith(e, wallFromKey(key), x), key)
			}
		}
	}
	line("END:VCALENDAR")
	return out.String()
}

type icsProp struct {
	name   string
	params map[string]string
	value  string
}

type icsComponent []icsProp

func (c icsComponent) get(name string) (icsProp, bool) {
	for _, p := range c {
		if p.name == name {
			return p, true
		}
	}
	return icsProp{}, false
}

func parseICS(text string) ([]icsComponent, bool) {
	text = strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\n ", "")
	var comps []icsComponent
	var cur icsComponent
	inEvent, sawCalendar := false, false
	for _, raw := range strings.Split(text, "\n") {
		raw = strings.TrimRight(raw, "\r")
		switch strings.ToUpper(raw) {
		case "BEGIN:VCALENDAR":
			sawCalendar = true
			continue
		case "BEGIN:VEVENT":
			inEvent, cur = true, nil
			continue
		case "END:VEVENT":
			if inEvent {
				comps = append(comps, cur)
			}
			inEvent = false
			continue
		}
		if !inEvent {
			continue
		}
		head, value, ok := strings.Cut(raw, ":")
		if !ok {
			continue
		}
		parts := strings.Split(head, ";")
		prop := icsProp{name: strings.ToUpper(parts[0]), params: map[string]string{}, value: value}
		for _, p := range parts[1:] {
			if k, v, ok := strings.Cut(p, "="); ok {
				prop.params[strings.ToUpper(k)] = v
			}
		}
		cur = append(cur, prop)
	}
	return comps, sawCalendar && len(comps) > 0
}

type importedEvent struct {
	master     icsComponent
	exceptions []icsComponent
}

// icsTime reads a DTSTART-like property into a wall clock in the event's zone.
func icsTime(p icsProp, fallbackZone string) (w wall, zone string, allDay bool, err error) {
	zone = fallbackZone
	if p.params["VALUE"] == "DATE" || len(p.value) == 8 {
		w, err = time.Parse("20060102", p.value)
		return w, zone, true, err
	}
	if tz := p.params["TZID"]; tz != "" {
		if !validZone(tz) {
			return w, tz, false, fmt.Errorf("The time zone %s is not supported.", tz)
		}
		zone = tz
	}
	if strings.HasSuffix(p.value, "Z") {
		instant, perr := time.Parse("20060102T150405Z", p.value)
		return wallOf(instant, zoneLocations[zone]), zone, false, perr
	}
	w, err = time.Parse("20060102T150405", p.value)
	return w, zone, false, err
}

func (s *Server) handleExport(rq *Req) error {
	w, err := rq.World()
	if err != nil {
		return err
	}
	c := w.Calendars[rq.R.PathValue("id")]
	if c == nil || !w.canRead(c, rq.Me) {
		return errNotFound
	}
	if w.shareLevel(c, rq.Me) == "free_busy" {
		return errForbidden
	}
	events, err := loadEvents(rq.ctx(), s.db, `NOT trashed AND calendar_id = $1 ORDER BY id`, c.ID)
	if err != nil {
		return err
	}
	text := w.buildICS(rq.Me, events)
	id := newID("exp-")
	key := "exports/" + id + ".ics"
	if err := s.files.Put(rq.ctx(), key, "text/calendar", []byte(text)); err != nil {
		return storageFailure(err)
	}
	if _, err := s.db.ExecContext(rq.ctx(), `INSERT INTO ical_files VALUES ($1,'export',$2,$3,$4,$5,$6)`, id, c.ID, rq.Me.ID, key, len(text), w.Now); err != nil {
		return err
	}
	return rq.json(201, map[string]any{"id": id, "object_key": key, "size_bytes": len(text), "url": "/api/exports/" + id + "/file"})
}

func (s *Server) handleExportFile(rq *Req) error {
	var key string
	err := s.db.QueryRowContext(rq.ctx(), `SELECT object_key FROM ical_files WHERE id=$1 AND kind='export' AND person_id=$2`, rq.R.PathValue("id"), rq.Me.ID).Scan(&key)
	if err == sql.ErrNoRows {
		return errNotFound
	}
	if err != nil {
		return err
	}
	data, err := s.files.Get(rq.ctx(), key)
	if err != nil {
		return storageFailure(err)
	}
	rq.W.Header().Set("Content-Type", "text/calendar; charset=utf-8")
	rq.W.Header().Set("Content-Disposition", `attachment; filename="`+rq.R.PathValue("id")+`.ics"`)
	_, err = rq.W.Write(data)
	return err
}

func (s *Server) handleImport(rq *Req) error {
	w, err := rq.World()
	if err != nil {
		return err
	}
	c := w.Calendars[rq.R.PathValue("id")]
	if c == nil || !w.canRead(c, rq.Me) {
		return errNotFound
	}
	if !w.canWrite(c, rq.Me) {
		return errForbidden
	}
	comps, ok := parseICS(string(rq.raw))
	if !ok {
		return apiErr(422, "invalid_icalendar", "That file is not a valid iCalendar file.")
	}
	id := newID("imp-")
	key := "imports/" + id + ".ics"
	if err := s.files.Put(rq.ctx(), key, "text/calendar", rq.raw); err != nil {
		return storageFailure(err)
	}
	groups := map[string]*importedEvent{}
	var order []string
	for _, comp := range comps {
		uid, _ := comp.get("UID")
		if uid.value == "" {
			continue
		}
		g := groups[uid.value]
		if g == nil {
			g = &importedEvent{}
			groups[uid.value] = g
			order = append(order, uid.value)
		}
		if _, isException := comp.get("RECURRENCE-ID"); isException {
			g.exceptions = append(g.exceptions, comp)
		} else {
			g.master = comp
		}
	}
	created, updated := 0, 0
	skipped := []map[string]string{}
	err = s.edit(rq.ctx(), rq.Me, func(ed *Edit) error {
		if _, err := ed.Tx.ExecContext(ed.Ctx, `INSERT INTO ical_files VALUES ($1,'import',$2,$3,$4,$5,$6)`, id, c.ID, rq.Me.ID, key, len(rq.raw), ed.Now); err != nil {
			return err
		}
		for _, uid := range order {
			g := groups[uid]
			if g.master == nil {
				skipped = append(skipped, map[string]string{"uid": uid, "reason": "The event has no base entry."})
				continue
			}
			e, reason, err := ed.importEvent(c, uid, g)
			if err != nil {
				return err
			}
			if reason != "" {
				skipped = append(skipped, map[string]string{"uid": uid, "reason": reason})
				continue
			}
			if e.Version > 1 {
				updated++
			} else {
				created++
			}
			if err := ed.changed(e, "event.changed"); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	return rq.json(201, map[string]any{"id": id, "object_key": key, "created": created, "updated": updated, "skipped": skipped})
}

// importEvent makes or replaces one event from an iCalendar UID group; a reason means it was skipped.
func (ed *Edit) importEvent(c *Calendar, uid string, g *importedEvent) (*Event, string, error) {
	prop := func(name string) string { p, _ := g.master.get(name); return icsUnescape(p.value) }
	startProp, ok := g.master.get("DTSTART")
	if !ok {
		return nil, "The event has no start.", nil
	}
	start, zone, allDay, err := icsTime(startProp, ed.Actor.Zone)
	if err != nil {
		return nil, err.Error(), nil
	}
	e := &Event{CalendarID: c.ID, Title: strings.TrimSpace(prop("SUMMARY")), Location: prop("LOCATION"), Notes: prop("DESCRIPTION"),
		Kind: "event", Colour: "calendar", Visibility: "default", AllDay: allDay, Zone: zone, Switches: ed.W.Defaults,
		Reminders: []int{}, Exceptions: map[string]*Exception{}, SavedAt: ed.Now, CreatedAt: ed.Now, SavedBy: ed.Actor.ID, Version: 1}
	if k := prop("X-WREN-KIND"); eventKinds[k] {
		e.Kind = k
		if k == "focus" {
			e.DeclineMode = ptr("new_and_existing")
		}
	}
	if strings.EqualFold(prop("CLASS"), "PRIVATE") {
		e.Visibility = "private"
	}
	end := start.Add(time.Hour)
	if allDay {
		end = start.AddDate(0, 0, 1)
	}
	if endProp, ok := g.master.get("DTEND"); ok {
		if end, _, _, err = icsTime(endProp, zone); err != nil {
			return nil, err.Error(), nil
		}
	}
	if allDay {
		end = end.AddDate(0, 0, -1)
		if end.Before(start) {
			end = start
		}
	}
	e.StartLocal, e.EndLocal = formatWall(e, start), formatWall(e, end)
	if r, ok := g.master.get("RRULE"); ok {
		e.RRule = ptr(r.value)
	}
	if errs := validateEvent(e); len(errs) > 0 {
		for _, f := range []string{"rrule", "title", "end_local", "start_local"} {
			if msg, bad := errs[f]; bad {
				if f == "rrule" {
					msg = "The repeat rule is not supported."
				}
				return nil, msg, nil
			}
		}
		return nil, "The event could not be read.", nil
	}
	for _, p := range g.master {
		if p.name != "EXDATE" {
			continue
		}
		for _, v := range strings.Split(p.value, ",") {
			when, _, _, err := icsTime(icsProp{name: p.name, params: p.params, value: v}, zone)
			if err == nil {
				e.Exceptions[keyOf(when)] = &Exception{Key: keyOf(when), Deleted: true, Over: map[string]string{}}
			}
		}
	}
	for _, o := range g.exceptions {
		rid, _ := o.get("RECURRENCE-ID")
		when, _, _, err := icsTime(rid, zone)
		if err != nil {
			continue
		}
		x := &Exception{Key: keyOf(when), Over: map[string]string{}}
		get := func(name string) string { p, _ := o.get(name); return icsUnescape(p.value) }
		if s, ok := o.get("DTSTART"); ok {
			if ns, _, _, err := icsTime(s, zone); err == nil {
				ne := ns.Add(e.baseDuration())
				if en, ok := o.get("DTEND"); ok {
					if v, _, _, err := icsTime(en, zone); err == nil {
						ne = v
						if allDay {
							ne = ne.AddDate(0, 0, -1)
						}
					}
				}
				x.Over["start_local"], x.Over["end_local"] = formatWall(e, ns), formatWall(e, ne)
			}
		}
		x.Over["title"], x.Over["location"], x.Over["notes"] = strings.TrimSpace(get("SUMMARY")), get("LOCATION"), get("DESCRIPTION")
		e.Exceptions[x.Key] = x
	}
	existing, err := loadEvents(ed.Ctx, ed.Tx, `calendar_id = $1 AND NOT trashed AND (id = $2 OR ical_uid = $2)`, c.ID, uid)
	if err != nil {
		return nil, "", err
	}
	if len(existing) > 0 {
		old := existing[0]
		e.ID, e.SeriesID, e.Version, e.GuestIDs = old.ID, old.SeriesID, old.Version, old.GuestIDs
		e.ICalUID, e.CreatedAt, e.Switches = old.ICalUID, old.CreatedAt, old.Switches
		if _, err := ed.Tx.ExecContext(ed.Ctx, `DELETE FROM exceptions WHERE event_id = $1`, old.ID); err != nil {
			return nil, "", err
		}
		exceptions := e.Exceptions
		e.Exceptions = map[string]*Exception{}
		for _, key := range sortedKeys(exceptions) {
			if err := ed.writeException(e, exceptions[key]); err != nil {
				return nil, "", err
			}
		}
		if err := ed.normalizeExceptions(e); err != nil {
			return nil, "", err
		}
		return e, "", ed.touch(e)
	}
	e.ID = newID("evt-")
	e.SeriesID, e.ICalUID = e.ID, ptr(uid)
	exceptions := e.Exceptions
	e.Exceptions = map[string]*Exception{}
	if err := insertEvent(ed.Ctx, ed.Tx, e); err != nil {
		return nil, "", err
	}
	for _, key := range sortedKeys(exceptions) {
		if err := ed.writeException(e, exceptions[key]); err != nil {
			return nil, "", err
		}
	}
	return e, "", ed.normalizeExceptions(e)
}
