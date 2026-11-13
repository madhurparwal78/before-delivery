package main

import "time"

// View is one event or occurrence as seen by one person.
type View struct {
	W      *World
	Viewer *Person
	E      *Event
	O      *Occurrence
	Access string
	// ForOccurrence selects the occurrence-shaped response; Key is the reply key the replies are read for.
	ForOccurrence bool
	Key           string
	EventLevel    bool
}

func nilIfEmpty(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}

func utcOrNil(t time.Time, allDay bool) any {
	if allDay {
		return nil
	}
	return t.UTC().Format(time.RFC3339)
}

func clockList(cs []CityTime) []map[string]any {
	out := make([]map[string]any, 0, len(cs))
	for _, c := range cs {
		out = append(out, map[string]any{"city": c.City, "time": c.Time, "date": c.Date, "inside_hours": c.Inside})
	}
	return out
}

func warningMap(wn *Warning) map[string]any {
	return map[string]any{"rule_id": wn.RuleID, "city": wn.City, "effective_date": wn.EffectiveDate, "new_offset": wn.NewOffset,
		"shift_minutes": wn.ShiftMinutes, "saved_time": wn.SavedTime, "shown_time": wn.ShownTime, "note": wn.Note}
}

func (v View) startLocal() string {
	if v.O.AllDay {
		return v.O.ShownStart.Format(layoutDate)
	}
	return wallString(v.O.ShownStart)
}

func (v View) endLocal() string {
	if v.O.AllDay {
		return v.O.ShownEnd.Format(layoutDate)
	}
	return wallString(v.O.ShownEnd)
}

func (v View) canSeeGuests() bool {
	switch v.Access {
	case "full":
		return true
	case "guest":
		return v.E.Switches.SeeGuestList || v.E.Switches.ModifyEvent
	case "details":
		return v.E.Switches.SeeGuestList
	}
	return false
}

func (v View) guestRows() []map[string]any {
	rows := make([]map[string]any, 0, len(v.E.GuestIDs))
	for _, id := range v.E.GuestIDs {
		status, message := v.E.replyFor(id, v.Key)
		rows = append(rows, map[string]any{"person_id": id, "name": v.W.People[id].Name, "answer": status, "message": nilIfEmpty(message)})
	}
	return rows
}

func (v View) replyCounts() map[string]int {
	counts := map[string]int{"yes": 0, "no": 0, "maybe": 0, "invited": 0}
	for _, id := range v.E.GuestIDs {
		status, _ := v.E.replyFor(id, v.Key)
		counts[status]++
	}
	return counts
}

func (v View) proposalRows(onlyMine bool) []map[string]any {
	rows := []map[string]any{}
	for _, p := range v.E.Proposals {
		if onlyMine && p.ProposerID != v.Viewer.ID {
			continue
		}
		if !v.EventLevel && p.Key != v.O.ReplyKey() {
			continue
		}
		rows = append(rows, proposalJSON(v.W, p))
	}
	return rows
}

func (v View) exceptionRows() []map[string]any {
	rows := []map[string]any{}
	for _, key := range sortedKeys(v.E.Exceptions) {
		x := v.E.Exceptions[key]
		var o *Occurrence
		if x.Deleted {
			o = v.W.buildWith(v.E, wallFromKey(key), x)
		} else {
			o = v.W.build(v.E, wallFromKey(key))
		}
		start, end := wallString(o.SavedStart), wallString(o.SavedEnd)
		if o.AllDay {
			start, end = o.SavedStart.Format(layoutDate), o.SavedEnd.Format(layoutDate)
		}
		rows = append(rows, map[string]any{"occurrence_id": v.E.ID + "@" + key, "deleted": x.Deleted, "start_local": start,
			"end_local": end, "title": o.Title, "location": o.Location, "notes": o.Notes})
	}
	return rows
}

func (v View) warningRows() []map[string]any {
	rows := []map[string]any{}
	if v.EventLevel {
		for _, wn := range v.W.warnings(v.E) {
			rows = append(rows, warningMap(wn))
		}
	} else if v.O.Warning != nil {
		rows = append(rows, warningMap(v.O.Warning))
	}
	return rows
}

func (v View) organiserMap() any {
	o := v.W.organiser(v.E)
	if o == nil {
		return nil
	}
	return map[string]any{"id": o.ID, "name": o.Name}
}

func (v View) reminders() []int {
	if v.E.AllDay || v.E.Reminders == nil {
		return []int{}
	}
	return v.E.Reminders
}

// project is the one place that builds the published field list for an access level.
func (w *World) project(v View) map[string]any {
	v.W = w
	e, o := v.E, v.O
	out := map[string]any{}
	if v.ForOccurrence {
		out["occurrence_id"], out["event_id"] = o.ID, e.ID
	} else {
		out["id"] = e.ID
	}
	out["calendar_id"] = e.CalendarID
	out["all_day"] = o.AllDay
	out["start_local"], out["end_local"], out["zone"] = v.startLocal(), v.endLocal(), e.Zone
	out["access"] = v.Access
	out["clocks"] = clockList(w.clocks(o))
	out["start_utc"], out["end_utc"] = utcOrNil(o.Begin, o.AllDay), utcOrNil(o.Finish, o.AllDay)
	if v.Access == "busy" {
		out["title"] = "Busy"
		return out
	}
	out["title"], out["location"], out["notes"] = o.Title, o.Location, o.Notes
	out["kind"], out["colour"] = e.Kind, e.Colour
	out["series_id"], out["organiser"], out["rrule"] = e.SeriesID, v.organiserMap(), nilIfEmpty(e.RRule)
	out["adjusted"] = o.Adjusted
	if v.ForOccurrence {
		out["is_exception"] = o.IsException
	}
	if v.Access != "details" {
		out["reminders"] = v.reminders()
		out["switches"] = e.Switches
		out["zone_warnings"] = v.warningRows()
	}
	if v.canSeeGuests() {
		out["guests"], out["rsvp"] = v.guestRows(), v.replyCounts()
	}
	switch v.Access {
	case "guest":
		status, message := e.replyFor(v.Viewer.ID, v.Key)
		out["my_reply"] = map[string]any{"answer": status, "message": nilIfEmpty(message)}
		out["my_proposals"] = v.proposalRows(true)
		out["version"] = e.Version
	case "full":
		out["split_from"], out["visibility"] = nilIfEmpty(e.SplitFrom), e.Visibility
		out["decline_mode"], out["decline_message"] = nilIfEmpty(e.DeclineMode), nilIfEmpty(e.DeclineMessage)
		out["proposals"], out["exceptions"] = v.proposalRows(false), v.exceptionRows()
		out["version"], out["saved_at"] = e.Version, e.SavedAt.UTC().Format(time.RFC3339)
		out["share_link"] = nil
		if e.Link != nil {
			out["share_link"] = linkJSON(e.Link.Token, e.Link.ExpiresAt)
		}
	}
	return out
}

// pick narrows a projection to a published sub-shape, so a sub-shape never decides a field's value itself.
func pick(fields map[string]any, names ...string) map[string]any {
	out := make(map[string]any, len(names))
	for _, name := range names {
		out[name] = fields[name]
	}
	return out
}

// sharedView is the public read-only shape of an event behind a shared link, taken from the details projection.
func (w *World) sharedView(e *Event) map[string]any {
	fields := w.project(View{E: e, O: w.firstOccurrence(e), Access: "details", EventLevel: true})
	guests := []map[string]any{}
	if rows, ok := fields["guests"].([]map[string]any); ok {
		for _, g := range rows {
			guests = append(guests, map[string]any{"name": g["name"], "answer": g["answer"]})
		}
	}
	organiser := ""
	if o, ok := fields["organiser"].(map[string]any); ok {
		organiser = o["name"].(string)
	}
	out := pick(fields, "title", "location", "all_day", "start_local", "end_local", "zone", "clocks")
	out["organiser_name"], out["guests"] = organiser, guests
	return out
}

// proposalJSON is the published shape of one proposal.
func proposalJSON(w *World, p Proposal) map[string]any {
	occurrence := p.EventID
	if p.Key != "" {
		occurrence = p.EventID + "@" + p.Key
	}
	who := w.People[p.ProposerID]
	return map[string]any{"id": p.ID, "occurrence_id": occurrence, "proposer": map[string]any{"id": who.ID, "name": who.Name},
		"start_local": p.StartLocal, "end_local": p.EndLocal, "note": p.Note, "status": p.Status}
}

// linkJSON is the published shape of a shared link.
func linkJSON(token string, expires time.Time) map[string]any {
	return map[string]any{"token": token, "url": "/share/" + token, "expires_at": expires.UTC().Format(time.RFC3339)}
}
