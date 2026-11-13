package api

import (
	"encoding/json"
	"strings"

	"sundialwren/internal/domain"
)

// EventColours are the published colour choices.
var EventColours = []string{"Calendar colour", "Rose", "Amber", "Teal", "Indigo"}

// fields holds a request body's changed fields, so a save touches only what
// was sent.
type fields struct {
	raw map[string]json.RawMessage
}

func (f fields) has(name string) bool {
	_, ok := f.raw[name]
	return ok
}

func (f fields) str(name string) string {
	var v *string
	if err := json.Unmarshal(f.raw[name], &v); err != nil || v == nil {
		return ""
	}
	return *v
}

func (f fields) boolean(name string, fallback bool) bool {
	var v bool
	if err := json.Unmarshal(f.raw[name], &v); err != nil {
		return fallback
	}
	return v
}

func (f fields) minutes(name string) []int {
	var v []int
	if err := json.Unmarshal(f.raw[name], &v); err != nil || v == nil {
		return []int{}
	}
	return v
}

func (f fields) strings(name string) []string {
	var v []string
	if err := json.Unmarshal(f.raw[name], &v); err != nil {
		return nil
	}
	return v
}

func (f fields) switches(fallback domain.Switches) domain.Switches {
	out := fallback
	if err := json.Unmarshal(f.raw["switches"], &out); err != nil {
		return fallback
	}
	return out
}

// timeFields lists the fields a change of which moves an occurrence.
var timeFields = []string{"start_local", "end_local", "all_day", "zone"}

func (f fields) touchesTime() bool {
	for _, name := range timeFields {
		if f.has(name) {
			return true
		}
	}
	return false
}

// apply writes the sent fields onto an event and reports every field error.
func (f fields) apply(e *domain.Event, settings domain.Settings) map[string]string {
	errs := map[string]string{}
	if f.has("title") {
		e.Title = strings.TrimSpace(f.str("title"))
	}
	if f.has("location") {
		e.Location = f.str("location")
	}
	if f.has("notes") {
		e.Notes = f.str("notes")
	}
	if f.has("kind") {
		switch f.str("kind") {
		case domain.KindEvent, domain.KindFocusTime, domain.KindOutOfOffice:
			e.Kind = f.str("kind")
		default:
			errs["kind"] = "Choose Event, Focus time or Out of office."
		}
	}
	if f.has("colour") {
		colour := f.str("colour")
		if !contains(EventColours, colour) {
			errs["colour"] = "Choose a published colour."
		} else {
			e.Colour = colour
		}
	}
	if f.has("visibility") {
		switch f.str("visibility") {
		case domain.VisibilityDefault, domain.VisibilityPrivate:
			e.Visibility = f.str("visibility")
		default:
			errs["visibility"] = "Choose default or private."
		}
	}
	if f.has("zone") {
		if !domain.ValidZone(f.str("zone")) {
			errs["zone"] = "Choose New York, London or Auckland."
		} else {
			e.Zone = f.str("zone")
		}
	}
	if f.has("all_day") {
		e.AllDay = f.boolean("all_day", e.AllDay)
	}
	if f.has("reminders") {
		minutes := f.minutes("reminders")
		if msg := checkReminderMinutes(minutes); msg != "" {
			errs["reminders"] = msg
		} else {
			e.Reminders = minutes
		}
	}
	if f.has("switches") {
		e.Switches = f.switches(e.Switches)
	}
	if f.has("decline_mode") {
		switch f.str("decline_mode") {
		case domain.DeclineNewOnly, domain.DeclineNewAndExisting:
			e.DeclineMode = f.str("decline_mode")
		case "":
			e.DeclineMode = domain.DeclineNewAndExisting
		default:
			errs["decline_mode"] = "Choose only new invitations or new and existing meetings."
		}
	}
	if f.has("decline_message") {
		message := strings.TrimSpace(f.str("decline_message"))
		if message != "" && len(message) > 200 {
			errs["decline_message"] = "Write a message of 1 to 200 characters."
		} else {
			e.DeclineMessage = message
		}
	}
	if f.has("start_local") {
		e.StartLocal = f.str("start_local")
	}
	if f.has("end_local") {
		e.EndLocal = f.str("end_local")
	}

	if e.Title == "" {
		errs["title"] = titleRequired
	}
	if e.Kind == domain.KindFocusTime && e.DeclineMode == "" {
		e.DeclineMode = domain.DeclineNewAndExisting
	}
	if e.Kind != domain.KindFocusTime {
		e.DeclineMode = ""
	}
	if e.Kind != domain.KindOutOfOffice {
		e.DeclineMessage = ""
	}

	start, startErr := domain.ParseLocal(e.StartLocal, e.AllDay)
	end, endErr := domain.ParseLocal(e.EndLocal, e.AllDay)
	format := dateTimeFormat
	if e.AllDay {
		format = dateFormat
	}
	if startErr != nil {
		errs["start_local"] = format
	}
	if endErr != nil {
		errs["end_local"] = format
	}
	if startErr == nil && endErr == nil {
		if e.AllDay {
			if end.Before(start) {
				errs["end_local"] = endAfterStart
			}
		} else if !end.After(start) {
			errs["end_local"] = endAfterStart
		}
	}
	if f.has("rrule") {
		e.RRule = f.str("rrule")
	}
	if e.RRule != "" && startErr == nil {
		if _, err := domain.ParseRRule(e.RRule, start); err != nil {
			errs["rrule"] = domain.RRuleError
		}
	}
	_ = settings
	if len(errs) == 0 {
		return nil
	}
	return errs
}

func contains(list []string, want string) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}
