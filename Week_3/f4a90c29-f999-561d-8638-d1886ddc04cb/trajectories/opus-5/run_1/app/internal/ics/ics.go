// Package ics writes and reads the iCalendar files MinIO holds.
package ics

import (
	"fmt"
	"strings"

	"sundialwren/internal/domain"
)

// Write renders one VEVENT per event, with a further VEVENT for each modified
// occurrence and one EXDATE for each deleted one. It never names a guest.
func Write(calendarName string, events []*domain.Event) string {
	var out strings.Builder
	out.WriteString("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Sundial & Wren//Wren Calendar//EN\r\n")
	out.WriteString("X-WR-CALNAME:" + escape(calendarName) + "\r\n")
	for _, e := range events {
		writeEvent(&out, e)
	}
	out.WriteString("END:VCALENDAR\r\n")
	return out.String()
}

func writeEvent(out *strings.Builder, e *domain.Event) {
	start, err := domain.ParseLocal(e.StartLocal, e.AllDay)
	if err != nil {
		return
	}
	end, err := domain.ParseLocal(e.EndLocal, e.AllDay)
	if err != nil {
		return
	}
	out.WriteString("BEGIN:VEVENT\r\n")
	out.WriteString("UID:" + e.ID + "\r\n")
	writeTimes(out, e.Zone, start, end, e.AllDay)
	summary := e.Title
	if e.Visibility == domain.VisibilityPrivate {
		summary = "Busy"
	}
	out.WriteString("SUMMARY:" + escape(summary) + "\r\n")
	if e.Visibility == domain.VisibilityPrivate {
		out.WriteString("CLASS:PRIVATE\r\n")
	} else {
		if e.Location != "" {
			out.WriteString("LOCATION:" + escape(e.Location) + "\r\n")
		}
		if e.Notes != "" {
			out.WriteString("DESCRIPTION:" + escape(e.Notes) + "\r\n")
		}
	}
	if e.RRule != "" {
		out.WriteString("RRULE:" + e.RRule + "\r\n")
	}
	out.WriteString("X-WREN-KIND:" + e.Kind + "\r\n")
	for _, x := range e.Exceptions {
		if !x.Deleted {
			continue
		}
		if w, err := keyWall(x.Key); err == nil {
			out.WriteString("EXDATE;TZID=" + e.Zone + ":" + stamp(w, e.AllDay) + "\r\n")
		}
	}
	out.WriteString("END:VEVENT\r\n")
	for _, x := range e.Exceptions {
		if x.Deleted {
			continue
		}
		writeException(out, e, x, start, end)
	}
}

func writeException(out *strings.Builder, e *domain.Event, x domain.Exception, seriesStart, seriesEnd domain.Wall) {
	original, err := keyWall(x.Key)
	if err != nil {
		return
	}
	duration := seriesStart.MinutesUntil(seriesEnd)
	start := original
	if x.StartLocal != nil {
		if w, err := domain.ParseLocal(*x.StartLocal, e.AllDay); err == nil {
			start = w
		}
	}
	end := start.AddMinutes(duration)
	if x.EndLocal != nil {
		if w, err := domain.ParseLocal(*x.EndLocal, e.AllDay); err == nil {
			end = w
		}
	}
	out.WriteString("BEGIN:VEVENT\r\n")
	out.WriteString("UID:" + e.ID + "\r\n")
	out.WriteString("RECURRENCE-ID;TZID=" + e.Zone + ":" + stamp(original, e.AllDay) + "\r\n")
	writeTimes(out, e.Zone, start, end, e.AllDay)
	title := e.Title
	if x.Title != nil {
		title = *x.Title
	}
	if e.Visibility == domain.VisibilityPrivate {
		title = "Busy"
		out.WriteString("SUMMARY:" + escape(title) + "\r\nCLASS:PRIVATE\r\n")
	} else {
		out.WriteString("SUMMARY:" + escape(title) + "\r\n")
		location := e.Location
		if x.Location != nil {
			location = *x.Location
		}
		notes := e.Notes
		if x.Notes != nil {
			notes = *x.Notes
		}
		if location != "" {
			out.WriteString("LOCATION:" + escape(location) + "\r\n")
		}
		if notes != "" {
			out.WriteString("DESCRIPTION:" + escape(notes) + "\r\n")
		}
	}
	out.WriteString("X-WREN-KIND:" + e.Kind + "\r\n")
	out.WriteString("END:VEVENT\r\n")
}

func writeTimes(out *strings.Builder, zone string, start, end domain.Wall, allDay bool) {
	if allDay {
		out.WriteString("DTSTART;VALUE=DATE:" + stamp(start, true) + "\r\n")
		out.WriteString("DTEND;VALUE=DATE:" + stamp(end.AddDays(1), true) + "\r\n")
		return
	}
	out.WriteString("DTSTART;TZID=" + zone + ":" + stamp(start, false) + "\r\n")
	out.WriteString("DTEND;TZID=" + zone + ":" + stamp(end, false) + "\r\n")
}

func stamp(w domain.Wall, allDay bool) string {
	if allDay {
		return fmt.Sprintf("%04d%02d%02d", w.Y, w.M, w.D)
	}
	return fmt.Sprintf("%04d%02d%02dT%02d%02d00", w.Y, w.M, w.D, w.H, w.Min)
}

func keyWall(key string) (domain.Wall, error) {
	if len(key) != 13 {
		return domain.Wall{}, fmt.Errorf("bad occurrence key")
	}
	return domain.ParseWall(key[:4] + "-" + key[4:6] + "-" + key[6:8] + "T" + key[9:11] + ":" + key[11:13])
}

func escape(v string) string {
	v = strings.ReplaceAll(v, `\`, `\\`)
	v = strings.ReplaceAll(v, ";", `\;`)
	v = strings.ReplaceAll(v, ",", `\,`)
	v = strings.ReplaceAll(v, "\n", `\n`)
	return v
}

func unescape(v string) string {
	v = strings.ReplaceAll(v, `\n`, "\n")
	v = strings.ReplaceAll(v, `\,`, ",")
	v = strings.ReplaceAll(v, `\;`, ";")
	v = strings.ReplaceAll(v, `\\`, `\`)
	return v
}

// Component is one parsed VEVENT.
type Component struct {
	UID          string
	Summary      string
	Location     string
	Description  string
	RRule        string
	Kind         string
	Zone         string
	AllDay       bool
	Start        domain.Wall
	End          domain.Wall
	RecurrenceID string
	ExDates      []string
	Private      bool
}

// Parse reads an iCalendar file into its components.
func Parse(text string) ([]Component, error) {
	lines := unfold(text)
	var out []Component
	var current *Component
	for _, line := range lines {
		name, params, value := splitLine(line)
		switch {
		case name == "BEGIN" && value == "VEVENT":
			current = &Component{Kind: domain.KindEvent}
		case name == "END" && value == "VEVENT":
			if current != nil {
				out = append(out, *current)
				current = nil
			}
		case current == nil:
			continue
		case name == "UID":
			current.UID = value
		case name == "SUMMARY":
			current.Summary = unescape(value)
		case name == "LOCATION":
			current.Location = unescape(value)
		case name == "DESCRIPTION":
			current.Description = unescape(value)
		case name == "RRULE":
			current.RRule = value
		case name == "CLASS":
			current.Private = value == "PRIVATE"
		case name == "X-WREN-KIND":
			current.Kind = value
		case name == "DTSTART":
			current.AllDay = params["VALUE"] == "DATE"
			current.Zone = params["TZID"]
			if w, err := parseStamp(value); err == nil {
				current.Start = w
			}
		case name == "DTEND":
			if w, err := parseStamp(value); err == nil {
				current.End = w
			}
		case name == "RECURRENCE-ID":
			if w, err := parseStamp(value); err == nil {
				current.RecurrenceID = w.Key()
			}
		case name == "EXDATE":
			for _, part := range strings.Split(value, ",") {
				if w, err := parseStamp(part); err == nil {
					current.ExDates = append(current.ExDates, w.Key())
				}
			}
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no events in that file")
	}
	return out, nil
}

func parseStamp(value string) (domain.Wall, error) {
	value = strings.TrimSuffix(value, "Z")
	switch len(value) {
	case 8:
		return domain.ParseDate(value[:4] + "-" + value[4:6] + "-" + value[6:8])
	case 15:
		return domain.ParseWall(value[:4] + "-" + value[4:6] + "-" + value[6:8] + "T" + value[9:11] + ":" + value[11:13])
	}
	return domain.Wall{}, fmt.Errorf("want a date or date and time")
}

func unfold(text string) []string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	var out []string
	for _, line := range strings.Split(text, "\n") {
		if line == "" {
			continue
		}
		if (line[0] == ' ' || line[0] == '\t') && len(out) > 0 {
			out[len(out)-1] += line[1:]
			continue
		}
		out = append(out, line)
	}
	return out
}

func splitLine(line string) (string, map[string]string, string) {
	head, value, _ := strings.Cut(line, ":")
	parts := strings.Split(head, ";")
	params := map[string]string{}
	for _, part := range parts[1:] {
		key, v, ok := strings.Cut(part, "=")
		if ok {
			params[strings.ToUpper(key)] = v
		}
	}
	return strings.ToUpper(parts[0]), params, value
}
