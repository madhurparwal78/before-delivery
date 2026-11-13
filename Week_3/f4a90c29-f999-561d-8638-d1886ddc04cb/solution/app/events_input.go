package main

import (
	"encoding/json"
	"strings"
	"time"
)

// EventPatch is the set of event fields a request sent.
type EventPatch struct {
	Present                                                                         map[string]bool
	Title, Location, Notes, Kind, Colour, Visibility, Zone, Start, End, DeclineMode *string
	DeclineMessage, CalendarID, RRule                                               *string
	AllDay                                                                          *bool
	Reminders                                                                       *[]int
	Switches                                                                        map[string]bool
	GuestIDs                                                                        []string
	Scope, OccurrenceID                                                             string
}

var eventKinds = map[string]bool{"event": true, "focus": true, "out_of_office": true}
var eventColours = map[string]bool{"calendar": true, "rose": true, "amber": true, "teal": true, "indigo": true}

func parsePatch(fields map[string]json.RawMessage) (*EventPatch, map[string]string) {
	p := &EventPatch{Present: map[string]bool{}}
	errs := map[string]string{}
	str := func(name string, into **string) {
		raw, ok := fields[name]
		if !ok {
			return
		}
		p.Present[name] = true
		if string(raw) == "null" {
			return
		}
		var v string
		if json.Unmarshal(raw, &v) != nil {
			errs[name] = "Send text for " + name + "."
			return
		}
		*into = &v
	}
	str("title", &p.Title)
	str("location", &p.Location)
	str("notes", &p.Notes)
	str("kind", &p.Kind)
	str("colour", &p.Colour)
	str("visibility", &p.Visibility)
	str("zone", &p.Zone)
	str("start_local", &p.Start)
	str("end_local", &p.End)
	str("decline_mode", &p.DeclineMode)
	str("decline_message", &p.DeclineMessage)
	str("calendar_id", &p.CalendarID)
	str("rrule", &p.RRule)
	for name, into := range map[string]*string{"scope": &p.Scope, "occurrence_id": &p.OccurrenceID} {
		if raw, ok := fields[name]; ok && string(raw) != "null" {
			if json.Unmarshal(raw, into) != nil {
				errs[name] = "Send text for " + name + "."
			}
		}
	}
	if raw, ok := fields["all_day"]; ok {
		p.Present["all_day"] = true
		var v bool
		if json.Unmarshal(raw, &v) != nil {
			errs["all_day"] = "Send true or false."
		}
		p.AllDay = &v
	}
	if raw, ok := fields["reminders"]; ok {
		p.Present["reminders"] = true
		var v []int
		if json.Unmarshal(raw, &v) != nil || !validReminders(v) {
			errs["reminders"] = "Use up to 5 whole minutes from 0 to 10080."
		}
		p.Reminders = &v
	}
	if raw, ok := fields["switches"]; ok {
		p.Present["switches"] = true
		var v map[string]bool
		if json.Unmarshal(raw, &v) != nil {
			errs["switches"] = "Send modify_event, invite_others and see_guest_list as true or false."
		}
		p.Switches = v
	}
	if raw, ok := fields["guest_ids"]; ok {
		p.Present["guest_ids"] = true
		if json.Unmarshal(raw, &p.GuestIDs) != nil {
			errs["guest_ids"] = "Send a list of person ids."
		}
	}
	return p, errs
}

// applyEventWide copies the fields that belong to the event as a whole, whatever the scope.
func (p *EventPatch) applyEventWide(e *Event) {
	set := func(dst *string, src *string) {
		if src != nil {
			*dst = strings.TrimSpace(*src)
		}
	}
	set(&e.Colour, p.Colour)
	set(&e.Visibility, p.Visibility)
	if p.Reminders != nil {
		e.Reminders = *p.Reminders
	}
	if p.Present["decline_message"] {
		e.DeclineMessage = p.DeclineMessage
		if p.DeclineMessage != nil && strings.TrimSpace(*p.DeclineMessage) == "" {
			e.DeclineMessage = nil
		}
	}
	if p.Present["decline_mode"] {
		e.DeclineMode = p.DeclineMode
	}
	for name, v := range p.Switches {
		switch name {
		case "modify_event":
			e.Switches.ModifyEvent = v
		case "invite_others":
			e.Switches.InviteOthers = v
		case "see_guest_list":
			e.Switches.SeeGuestList = v
		}
	}
}

// applyContent copies the fields an exception may override.
func (p *EventPatch) applyContent(e *Event) {
	if p.Title != nil {
		e.Title = strings.TrimSpace(*p.Title)
	}
	if p.Location != nil {
		e.Location = strings.TrimSpace(*p.Location)
	}
	if p.Notes != nil {
		e.Notes = strings.TrimSpace(*p.Notes)
	}
}

// validateEvent checks a whole event against the published formats and limits.
func validateEvent(e *Event) map[string]string {
	errs := map[string]string{}
	if t := strings.TrimSpace(e.Title); t == "" || len([]rune(t)) > 200 {
		errs["title"] = "Enter a title."
	}
	if !eventKinds[e.Kind] {
		errs["kind"] = "Choose Event, Focus time or Out of office."
	}
	if !validZone(e.Zone) {
		errs["zone"] = "Choose New York, London or Auckland."
	}
	if !eventColours[e.Colour] {
		errs["colour"] = "Choose a colour from the list."
	}
	if e.Visibility != "default" && e.Visibility != "private" {
		errs["visibility"] = "Use default or private."
	}
	if len(e.Location) > 300 {
		errs["location"] = "Use at most 300 characters."
	}
	if len(e.Notes) > 5000 {
		errs["notes"] = "Use at most 5000 characters."
	}
	var start, end time.Time
	var serr, eerr error
	if e.AllDay {
		start, serr = parseDate(e.StartLocal)
		end, eerr = parseDate(e.EndLocal)
		if serr != nil {
			errs["start_local"] = "Use YYYY-MM-DD."
		}
		if eerr != nil {
			errs["end_local"] = "Use YYYY-MM-DD."
		} else if serr == nil && end.Before(start) {
			errs["end_local"] = "End must be after start."
		}
	} else {
		start, serr = parseWall(e.StartLocal)
		end, eerr = parseWall(e.EndLocal)
		if serr != nil {
			errs["start_local"] = "Use YYYY-MM-DDTHH:MM."
		}
		if eerr != nil {
			errs["end_local"] = "Use YYYY-MM-DDTHH:MM."
		} else if serr == nil && !end.After(start) {
			errs["end_local"] = "End must be after start."
		} else if serr == nil && end.Sub(start) < 15*time.Minute {
			errs["end_local"] = "Events are at least 15 minutes long."
		}
	}
	if e.recurring() && serr == nil {
		if _, ok := parseRule(*e.RRule, dateOnly(start)); !ok {
			errs["rrule"] = ruleCopy
		}
	}
	if e.DeclineMessage != nil {
		n := len([]rune(*e.DeclineMessage))
		if e.Kind != "out_of_office" || n < 1 || n > 200 {
			errs["decline_message"] = "Use 1 to 200 characters, for out of office only."
		}
	}
	if e.DeclineMode != nil && (e.Kind != "focus" || (*e.DeclineMode != "new_only" && *e.DeclineMode != "new_and_existing")) {
		errs["decline_mode"] = "Use new_only or new_and_existing, for focus time only."
	}
	return errs
}
