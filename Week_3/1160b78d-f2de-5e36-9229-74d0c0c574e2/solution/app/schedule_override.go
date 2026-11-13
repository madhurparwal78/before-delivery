package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const (
	cutStep           = 15 * time.Minute
	cutLongest        = 14 * 24 * time.Hour
	nobodyName        = "Nobody"
	cutStepSentence   = "Overrides start and end on a 15-minute step."
	cutOrderSentence  = "An override must end after it starts."
	cutLengthSentence = "An override lasts at most 14 days."
	cutPastSentence   = "Overrides cannot change the past."
	cutPersonSentence = "Choose a person."
)

// overrideBody is what an override or a preview is requested with; person_id is a person's id or null for a gap.
type overrideBody struct {
	PersonID json.RawMessage `json:"person_id"`
	Start    string          `json:"start"`
	End      string          `json:"end"`
}

// cut is an override as requested, a nil person being a deliberate gap.
type cut struct {
	person     *string
	start, end time.Time
}

// parseCut reads a request body into a cut, or answers the 422 for what cannot be read.
func (a *App) parseCut(rq *Req, q dbq, body overrideBody) (cut, error) {
	var c cut
	problems := map[string]string{}
	switch {
	case len(body.PersonID) == 0:
		problems["person_id"] = cutPersonSentence
	case string(body.PersonID) != "null":
		var id string
		if json.Unmarshal(body.PersonID, &id) != nil {
			problems["person_id"] = cutPersonSentence
			break
		}
		known, err := knownStaff(rq.Ctx(), q, []string{id})
		if err != nil {
			return c, fmt.Errorf("check override person: %w", err)
		}
		if !known {
			problems["person_id"] = cutPersonSentence
		}
		c.person = &id
	}
	var errStart, errEnd error
	c.start, errStart = parseInstant(body.Start)
	c.end, errEnd = parseInstant(body.End)
	if errStart != nil {
		problems["start"] = instantSentence
	}
	if errEnd != nil {
		problems["end"] = instantSentence
	}
	if len(problems) > 0 {
		return c, errFields(problems)
	}
	return c, nil
}

// clipped checks a cut against the rules and clips a start inside the current 15-minute step to the present second.
func (c cut) clipped(now time.Time) (cut, error) {
	onStep := func(t time.Time) bool { return t.Unix()%int64(cutStep/time.Second) == 0 }
	switch {
	case !onStep(c.start):
		return c, errField("start", cutStepSentence)
	case !onStep(c.end):
		return c, errField("end", cutStepSentence)
	case instantReached(c.start, c.end):
		return c, errField("end", cutOrderSentence)
	case c.end.Sub(c.start) > cutLongest:
		return c, errField("end", cutLengthSentence)
	}
	currentStep := now.Add(-time.Duration(now.Unix()%int64(cutStep/time.Second)) * time.Second)
	if !instantReached(c.start, currentStep) {
		return c, errField("start", cutPastSentence)
	}
	if !instantReached(c.start, now) {
		c.start = now
	}
	return c, nil
}

// overlapping is the saved override a cut would overlap, if any; touching ends do not overlap.
func (m *scheduleModel) overlapping(c cut) *overrideRow {
	for i := range m.overrides {
		if o := &m.overrides[i]; !instantReached(o.Start, c.end) && !instantReached(c.start, o.End) {
			return o
		}
	}
	return nil
}

func (m *scheduleModel) holderName(personID *string) string {
	if personID == nil {
		return nobodyName
	}
	return m.names[*personID]
}

// refusal is the 409 for a cut that overlaps a saved override.
func (m *scheduleModel) refusal(o *overrideRow) error {
	message := fmt.Sprintf("Cut refused: %s already has an override from %s to %s.", m.holderName(o.PersonID),
		localLabel(o.Start, m.loc), localLabel(o.End, m.loc))
	return errConflict("override_overlap", "message", message, "overlaps", m.overlapView(o))
}

func (m *scheduleModel) overlapView(o *overrideRow) map[string]string {
	return map[string]string{"person": m.holderName(o.PersonID), "start": formatInstant(o.Start), "end": formatInstant(o.End)}
}

// lossView is the minutes a cut takes from one person.
type lossView struct {
	Person  string `json:"person"`
	Minutes int    `json:"minutes"`
	From    string `json:"from"`
	To      string `json:"to"`
}

// lostTime is what a cut takes from one person, from the first lost minute to the last.
type lostTime struct {
	minutes  time.Duration
	from, to time.Time
}

// losses lists each person whose final minutes a cut takes, in the order of their first lost minute. The cut's own
// person loses nothing.
func (m *scheduleModel) losses(c cut) []lossView {
	var order []string
	taken := map[string]*lostTime{}
	for _, r := range m.finalRuns(c.start, c.end) {
		if r.person == "" || (c.person != nil && r.person == *c.person) {
			continue
		}
		if taken[r.person] == nil {
			order = append(order, r.person)
			taken[r.person] = &lostTime{from: r.Start}
		}
		taken[r.person].minutes += r.End.Sub(r.Start)
		taken[r.person].to = r.End
	}
	losses := make([]lossView, 0, len(order))
	for _, id := range order {
		t := taken[id]
		losses = append(losses, lossView{Person: m.names[id], Minutes: int(t.minutes / time.Minute),
			From: formatInstant(t.from), To: formatInstant(t.to)})
	}
	return losses
}

// preview is the running result of a cut: who loses minutes, the gap it leaves, and any overlap.
func (m *scheduleModel) preview(c cut) map[string]any {
	losses := m.losses(c)
	phrases := make([]string, 0, len(losses))
	for _, loss := range losses {
		phrases = append(phrases, fmt.Sprintf("%s loses %d minutes", loss.Person, loss.Minutes))
	}
	lossText := "Nobody loses time"
	if len(phrases) > 0 {
		lossText = strings.Join(phrases, ", ")
	}
	gapMinutes, gapText := 0, "no gap"
	if c.person == nil {
		gapMinutes = int(c.end.Sub(c.start) / time.Minute)
		gapText = fmt.Sprintf("gap of %d minutes", gapMinutes)
	}
	overlap, overlapText := any(nil), "no overlap"
	if o := m.overlapping(c); o != nil {
		overlap, overlapText = m.overlapView(o), fmt.Sprintf("overlaps %s's override", m.holderName(o.PersonID))
	}
	return map[string]any{"losses": losses, "gap_minutes": gapMinutes, "overlap": overlap,
		"summary": strings.Join([]string{lossText, gapText, overlapText}, "; ") + "."}
}

// overrideView is the published override.
type overrideView struct {
	ID     string     `json:"id"`
	Person *personRef `json:"person"`
	Start  string     `json:"start"`
	End    string     `json:"end"`
}

func (a *App) hOverridePreview(rq *Req) error {
	var body overrideBody
	if err := rq.Decode(&body); err != nil {
		return fmt.Errorf("read override: %w", err)
	}
	m, err := a.loadScheduleModel(rq.Ctx(), a.db, rq.Param("id"))
	if err != nil {
		return fmt.Errorf("read schedule: %w", err)
	}
	requested, err := a.parseCut(rq, a.db, body)
	if err != nil {
		return fmt.Errorf("read cut: %w", err)
	}
	checked, err := requested.clipped(a.clock.Now())
	if err != nil {
		return fmt.Errorf("check cut: %w", err)
	}
	return rq.JSON(http.StatusOK, m.preview(checked))
}

func (a *App) hCreateOverride(rq *Req) error {
	if err := rq.Idempotent(func() error {
		var body overrideBody
		if err := rq.Decode(&body); err != nil {
			return fmt.Errorf("read override: %w", err)
		}
		var saved struct {
			Override overrideView `json:"override"`
			Final    finalView    `json:"final"`
		}
		err := a.Do(rq.Ctx(), func(w *Work) error {
			m, err := a.loadScheduleModel(w.Ctx, w.Tx, rq.Param("id"))
			if err != nil {
				return fmt.Errorf("read schedule: %w", err)
			}
			requested, err := a.parseCut(rq, w.Tx, body)
			if err != nil {
				return fmt.Errorf("read cut: %w", err)
			}
			if !instantReached(requested.start, requested.end) {
				if o := m.overlapping(requested); o != nil {
					return m.refusal(o)
				}
			}
			checked, err := requested.clipped(w.Now)
			if err != nil {
				return fmt.Errorf("check cut: %w", err)
			}
			overrideID := newID()
			_, err = w.Tx.Exec(w.Ctx, `insert into schedule_overrides (id, schedule_id, person_id, starts_at, ends_at, created_at)
				values ($1, $2, $3, $4, $5, $6)`, overrideID, m.ID, checked.person, checked.start, checked.end, w.Now)
			if err != nil {
				return fmt.Errorf("insert override: %w", err)
			}
			before := m.slotAt(w.Now).person
			if m, err = a.loadScheduleModel(w.Ctx, w.Tx, m.ID); err != nil {
				return fmt.Errorf("read saved schedule: %w", err)
			}
			saved.Override = overrideView{ID: overrideID, Person: nil, Start: formatInstant(checked.start), End: formatInstant(checked.end)}
			if checked.person != nil {
				saved.Override.Person = m.personRef(*checked.person)
			}
			saved.Final = m.final(checked.start.Add(-24*time.Hour), checked.end.Add(24*time.Hour), m.Zone, m.loc)
			if err := a.scheduleEdited(w, m.ID, before); err != nil {
				return fmt.Errorf("announce schedule edit: %w", err)
			}
			return nil
		})
		if err != nil {
			return fmt.Errorf("create override: %w", err)
		}
		return rq.JSON(http.StatusCreated, saved)
	}); err != nil {
		return fmt.Errorf("save override: %w", err)
	}
	return nil
}

func (a *App) hDeleteOverride(rq *Req) error {
	err := a.Do(rq.Ctx(), func(w *Work) error {
		m, err := a.loadScheduleModel(w.Ctx, w.Tx, rq.Param("id"))
		if err != nil {
			return fmt.Errorf("read schedule: %w", err)
		}
		var found *overrideRow
		for i := range m.overrides {
			if m.overrides[i].ID == rq.Param("override_id") {
				found = &m.overrides[i]
			}
		}
		if found == nil {
			return errNotFound()
		}
		if instantReached(w.Now, found.Start) {
			return errConflict("override_started")
		}
		if _, err := w.Tx.Exec(w.Ctx, `delete from schedule_overrides where id = $1`, found.ID); err != nil {
			return fmt.Errorf("delete override: %w", err)
		}
		if err := a.scheduleEdited(w, m.ID, m.slotAt(w.Now).person); err != nil {
			return fmt.Errorf("announce schedule edit: %w", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("delete override: %w", err)
	}
	return rq.NoContent()
}

func init() {
	routeSetups = append(routeSetups, func(a *App) {
		a.route(route{Pattern: "POST /api/schedules/{id}/overrides/preview", Access: accLead, Resource: "schedule", Handler: a.hOverridePreview})
		a.route(route{Pattern: "POST /api/schedules/{id}/overrides", Access: accLead, Resource: "schedule", Handler: a.hCreateOverride})
		a.route(route{Pattern: "DELETE /api/schedules/{id}/overrides/{override_id}", Access: accLead, Resource: "schedule", Handler: a.hDeleteOverride})
	})
}
