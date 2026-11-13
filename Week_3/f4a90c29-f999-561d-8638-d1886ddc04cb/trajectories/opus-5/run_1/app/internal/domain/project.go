package domain

import (
	"sort"
	"time"
)

// RSVP counts guests' answers for one occurrence, or the series defaults.
type RSVP struct {
	Yes     int `json:"yes"`
	No      int `json:"no"`
	Maybe   int `json:"maybe"`
	Invited int `json:"invited"`
}

type replyRow struct {
	PersonID string `json:"person_id"`
	Name     string `json:"name"`
	Answer   string `json:"answer"`
	Message  string `json:"message"`
}

type proposalRow struct {
	ID         string         `json:"id"`
	Occurrence string         `json:"occurrence_id"`
	Proposer   map[string]any `json:"proposer"`
	StartLocal string         `json:"start_local"`
	EndLocal   string         `json:"end_local"`
	Note       string         `json:"note"`
	Status     string         `json:"status"`
}

// Projector writes the published fields of an event or occurrence for one
// caller's access level, and nothing else.
type Projector struct {
	Viewer   Viewer
	Expander Expander
	Settings Settings
}

// Event writes an event response, reading its times from one occurrence when
// the caller named one.
func (p Projector) Event(e *Event, key string) map[string]any {
	access := p.Viewer.Access(e)
	occ := p.occurrenceFor(e, key)
	forOccurrence := key != ""
	body := p.base(e, occ, access)
	switch access {
	case AccessBusy:
		return body
	case AccessDetails:
		if p.Viewer.SeesGuestList(e) {
			body["guests"] = p.guestRows(e, key)
			body["rsvp"] = p.rsvp(e, key)
		}
		return body
	case AccessGuest:
		body["reminders"] = ints(e.Reminders)
		body["switches"] = e.Switches
		body["version"] = e.Version
		body["zone_warnings"] = p.warnings(e, occ, forOccurrence)
		answer, message := e.ReplyFor(key, p.Viewer.Person.ID)
		body["my_reply"] = map[string]any{"answer": answer, "message": message}
		body["my_proposals"] = p.proposalRows(e, p.Viewer.Person.ID)
		if p.Viewer.SeesGuestList(e) {
			body["guests"] = p.guestRows(e, key)
			body["rsvp"] = p.rsvp(e, key)
		}
		return body
	}
	body["series_id"] = e.SeriesID
	body["split_from"] = e.SplitFrom
	body["reminders"] = ints(e.Reminders)
	body["visibility"] = e.Visibility
	body["decline_mode"] = declineMode(e)
	body["decline_message"] = e.DeclineMessage
	body["switches"] = e.Switches
	body["guests"] = p.guestRows(e, key)
	body["rsvp"] = p.rsvp(e, key)
	body["proposals"] = p.proposalRows(e, "")
	body["exceptions"] = exceptionRows(e)
	body["zone_warnings"] = p.warnings(e, occ, forOccurrence)
	body["share_link"] = e.Link
	body["version"] = e.Version
	body["saved_at"] = e.SavedAt.UTC().Format(time.RFC3339)
	return body
}

// Occurrence writes an occurrence response.
func (p Projector) Occurrence(o *Occurrence) map[string]any {
	body := p.Event(o.Event, o.Key)
	delete(body, "id")
	body["occurrence_id"] = o.ID()
	body["event_id"] = o.Event.ID
	if p.Viewer.Access(o.Event) != AccessBusy {
		body["is_exception"] = o.IsException
	}
	return body
}

func (p Projector) occurrenceFor(e *Event, key string) *Occurrence {
	if key != "" {
		if o := p.Expander.One(e, key); o != nil {
			return o
		}
	}
	start, err := ParseLocal(e.StartLocal, e.AllDay)
	if err != nil {
		return nil
	}
	return p.Expander.occurrence(e, start)
}

// base writes the fields every access level carries.
func (p Projector) base(e *Event, o *Occurrence, access string) map[string]any {
	title := e.Title
	if o != nil {
		title = o.Title
	}
	if access == AccessBusy {
		title = "Busy"
	}
	body := map[string]any{
		"id":          e.ID,
		"calendar_id": e.CalendarID,
		"title":       title,
		"all_day":     e.AllDay,
		"zone":        e.Zone,
		"access":      access,
	}
	if o == nil {
		body["start_local"] = e.StartLocal
		body["end_local"] = e.EndLocal
		body["clocks"] = []Clock{}
		body["start_utc"] = nil
		body["end_utc"] = nil
		return body
	}
	body["start_local"] = o.ShownStart.Local(e.AllDay)
	body["end_local"] = o.ShownEnd.Local(e.AllDay)
	body["clocks"] = OccurrenceClocks(o, p.Settings)
	body["start_utc"] = instantOrNil(o.StartUTC)
	body["end_utc"] = instantOrNil(o.EndUTC)
	if access != AccessBusy {
		body["adjusted"] = o.Adjusted
		body["organiser"] = map[string]any{"id": e.OrganiserID, "name": e.OrganiserName}
		body["kind"] = e.Kind
		body["colour"] = e.Colour
		body["rrule"] = rruleOrNil(e.RRule)
		body["series_id"] = e.SeriesID
		body["location"] = e.Location
		body["notes"] = e.Notes
		if o != nil {
			body["location"] = o.Location
			body["notes"] = o.Notes
		}
	}
	return body
}

// warnings gives an occurrence its own warning, or nothing, and gives an event
// every rule warning any of its occurrences.
func (p Projector) warnings(e *Event, o *Occurrence, forOccurrence bool) []ZoneWarning {
	if o != nil && o.Warning != nil {
		return []ZoneWarning{*o.Warning}
	}
	if forOccurrence {
		return []ZoneWarning{}
	}
	if w := p.Expander.Warnings(e); len(w) > 0 {
		return w
	}
	return []ZoneWarning{}
}

func (p Projector) guestRows(e *Event, key string) []replyRow {
	rows := make([]replyRow, 0, len(e.Guests))
	for _, g := range e.Guests {
		answer, message := e.ReplyFor(key, g.PersonID)
		rows = append(rows, replyRow{PersonID: g.PersonID, Name: g.Name, Answer: answer, Message: message})
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].Name < rows[j].Name })
	return rows
}

func (p Projector) rsvp(e *Event, key string) RSVP {
	var r RSVP
	for _, g := range e.Guests {
		answer, _ := e.ReplyFor(key, g.PersonID)
		switch answer {
		case AnswerYes:
			r.Yes++
		case AnswerNo:
			r.No++
		case AnswerMaybe:
			r.Maybe++
		default:
			r.Invited++
		}
	}
	return r
}

func (p Projector) proposalRows(e *Event, onlyProposer string) []proposalRow {
	rows := make([]proposalRow, 0, len(e.Proposals))
	for _, pr := range e.Proposals {
		if onlyProposer != "" && pr.ProposerID != onlyProposer {
			continue
		}
		occurrence := e.ID
		if pr.Key != "" {
			occurrence = e.ID + "@" + pr.Key
		}
		rows = append(rows, proposalRow{
			ID:         pr.ID,
			Occurrence: occurrence,
			Proposer:   map[string]any{"id": pr.ProposerID, "name": pr.ProposerName},
			StartLocal: pr.StartLocal,
			EndLocal:   pr.EndLocal,
			Note:       pr.Note,
			Status:     pr.Status,
		})
	}
	return rows
}

func exceptionRows(e *Event) []Exception {
	rows := make([]Exception, 0, len(e.Exceptions))
	rows = append(rows, e.Exceptions...)
	for i := range rows {
		rows[i].Key = e.ID + "@" + rows[i].Key
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].Key < rows[j].Key })
	return rows
}

func declineMode(e *Event) any {
	if e.Kind == KindFocusTime {
		return e.DeclineMode
	}
	return nil
}

func rruleOrNil(r string) any {
	if r == "" {
		return nil
	}
	return r
}

func instantOrNil(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.UTC().Format(time.RFC3339)
}

func ints(v []int) []int {
	if v == nil {
		return []int{}
	}
	return v
}
