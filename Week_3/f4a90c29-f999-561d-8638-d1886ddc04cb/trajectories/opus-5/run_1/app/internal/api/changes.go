package api

import (
	"context"
	"encoding/json"
	"errors"

	"sundialwren/internal/domain"
	"sundialwren/internal/store"
)

// Change types.
const (
	changeEvent    = "event.changed"
	changeDeleted  = "event.deleted"
	changeReply    = "reply.changed"
	changeProposal = "proposal.changed"
	changeDecision = "decision"
	changeShare    = "share.changed"
	changeZoneRule = "zone_rule.recorded"
	changeReminder = "reminder.fired"
	changePrint    = "print.changed"
)

// changeSpec is what a change-log row keeps, so every open screen can be sent
// the change projected for its own person at send time.
type changeSpec struct {
	EventID      string           `json:"event_id,omitempty"`
	OccurrenceID string           `json:"occurrence_id,omitempty"`
	CalendarID   string           `json:"calendar_id,omitempty"`
	PersonID     string           `json:"person_id,omitempty"`
	DecisionID   string           `json:"decision_id,omitempty"`
	Text         string           `json:"text,omitempty"`
	Level        string           `json:"level,omitempty"`
	CalendarName string           `json:"calendar_name,omitempty"`
	Audience     []string         `json:"audience,omitempty"`
	Rule         *domain.ZoneRule `json:"rule,omitempty"`
	Reminder     *store.Reminder  `json:"reminder,omitempty"`
	Print        *store.Print     `json:"print,omitempty"`
}

// publish appends one change-log row and hands it to every open screen.
func (s *Server) publish(ctx context.Context, kind string, spec changeSpec) {
	payload, err := json.Marshal(spec)
	if err != nil {
		return
	}
	change := store.Change{
		Type:       kind,
		EventID:    spec.EventID,
		CalendarID: spec.CalendarID,
		PersonID:   spec.PersonID,
		DecisionID: spec.DecisionID,
		Payload:    payload,
	}
	seq, err := s.Store.AppendChange(ctx, change, s.Clock.Now())
	if err != nil {
		return
	}
	change.Seq = seq
	s.Hub.Publish(change)
}

// notify writes one in-app notice and, for a decision, carries its one
// decision id so a screen announces it exactly once.
func (s *Server) notify(ctx context.Context, personID, kind, text, eventID, decisionID string) {
	_ = s.Store.InsertNotice(ctx, newID("ntc"), personID, kind, text, eventID, decisionID, s.Clock.Now())
}

// decide writes one decision: a notice each for its audience and one
// change-log row carrying its decision id.
func (s *Server) decide(ctx context.Context, eventID, text string, audience []string) {
	decisionID := newID("dec")
	for _, personID := range audience {
		s.notify(ctx, personID, noticeDecision, text, eventID, decisionID)
	}
	s.publish(ctx, changeDecision, changeSpec{
		EventID:    eventID,
		DecisionID: decisionID,
		Text:       text,
		Audience:   audience,
	})
}

// decisionAudience lists who hears a decision: the organiser, the guest it
// concerns and everyone at full access, with the other guests added only for
// an accepted proposal.
func (s *Server) decisionAudience(ctx context.Context, e *domain.Event, affected string, allGuests bool) []string {
	seen := map[string]bool{}
	var out []string
	add := func(id string) {
		if id == "" || seen[id] {
			return
		}
		seen[id] = true
		out = append(out, id)
	}
	add(e.OrganiserID)
	add(affected)
	people, err := s.Store.People(ctx)
	if err != nil {
		return out
	}
	for _, p := range people {
		levels, err := s.Store.Levels(ctx, p.ID)
		if err != nil {
			continue
		}
		viewer := domain.Viewer{Person: p, Levels: levels}
		switch viewer.Access(e) {
		case domain.AccessFull:
			add(p.ID)
		case domain.AccessGuest:
			if allGuests {
				add(p.ID)
			}
		}
	}
	return out
}

// projectChange writes one change-log row for one person, by the same field
// rules as every other response, and reports whether they may see it.
func (s *Server) projectChange(ctx context.Context, change store.Change, c *Context) (map[string]any, bool) {
	var spec changeSpec
	if err := json.Unmarshal(change.Payload, &spec); err != nil {
		return nil, false
	}
	switch change.Type {
	case changeEvent, changeReply, changeProposal:
		e, err := s.Store.Event(ctx, spec.EventID)
		if errors.Is(err, store.ErrNotFound) || err != nil {
			return map[string]any{"event_id": spec.EventID, "removed": true}, true
		}
		if e.TrashedAt != nil || !c.Viewer.CanRead(e) {
			return map[string]any{"event_id": spec.EventID, "removed": true}, true
		}
		key := domain.OccurrenceKey(e.ID, spec.OccurrenceID)
		return map[string]any{
			"event_id":      e.ID,
			"occurrence_id": spec.OccurrenceID,
			"event":         c.Projector.Event(e, key),
		}, true
	case changeDeleted:
		return map[string]any{
			"event_id":      spec.EventID,
			"occurrence_id": spec.OccurrenceID,
			"removed":       true,
		}, true
	case changeDecision:
		for _, id := range spec.Audience {
			if id == c.Person.ID {
				return map[string]any{
					"decision_id": spec.DecisionID,
					"text":        spec.Text,
					"event_id":    spec.EventID,
				}, true
			}
		}
		return nil, false
	case changeShare:
		if spec.PersonID != c.Person.ID {
			return nil, false
		}
		return map[string]any{
			"calendar_id":   spec.CalendarID,
			"calendar_name": spec.CalendarName,
			"level":         spec.Level,
			"text":          spec.Text,
		}, true
	case changeZoneRule:
		if c.Person.Role == domain.RoleGuest {
			return nil, false
		}
		return map[string]any{"rule": spec.Rule}, true
	case changeReminder:
		if spec.PersonID != c.Person.ID {
			return nil, false
		}
		return map[string]any{"reminder": spec.Reminder, "text": spec.Text}, true
	case changePrint:
		if spec.PersonID != c.Person.ID {
			return nil, false
		}
		return map[string]any{"print": spec.Print, "text": spec.Text}, true
	}
	return nil, false
}
