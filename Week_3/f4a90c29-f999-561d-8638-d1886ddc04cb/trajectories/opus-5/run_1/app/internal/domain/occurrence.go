package domain

import (
	"fmt"
	"sort"
	"time"
)

// Occurrence is one dated instance of an event, with every time rule applied.
type Occurrence struct {
	Event *Event
	// Key is the original rule-generated local start, YYYYMMDDTHHMM.
	Key string

	SavedStart Wall // the stored clock time, an exception's own when it has one
	SavedEnd   Wall
	ShownStart Wall // what every surface reads, a zone rule's shift included
	ShownEnd   Wall
	StartUTC   *time.Time
	EndUTC     *time.Time

	AllDay         bool
	Adjusted       bool
	RequestedStart Wall
	IsException    bool
	Deleted        bool
	Title          string
	Location       string
	Notes          string
	Warning        *ZoneWarning
}

func (o *Occurrence) ID() string {
	if o.Event.IsSeries() {
		return o.Event.ID + "@" + o.Key
	}
	return o.Event.ID
}

// Instants gives an occurrence's span, taking an all-day occurrence as local
// midnight to local midnight in its own zone.
func (o *Occurrence) Instants() (time.Time, time.Time) {
	if !o.AllDay {
		return *o.StartUTC, *o.EndUTC
	}
	start := StartOfDay(o.ShownStart, o.Event.Zone)
	end := StartOfDay(o.ShownEnd.AddDays(1), o.Event.Zone)
	return start, end
}

// Dates lists every calendar date an all-day occurrence covers.
func (o *Occurrence) Dates() []string {
	var out []string
	for d := o.ShownStart; !d.After(o.ShownEnd); d = d.AddDays(1) {
		out = append(out, d.Date())
	}
	return out
}

// Expander turns stored events into occurrences. Every repeat, gap and zone
// rule decision is made here.
type Expander struct {
	Rules ZoneRules
	Now   time.Time
}

// ExpandRange lists an event's occurrences overlapping a window of instants,
// deleted ones left out.
func (ex Expander) ExpandRange(e *Event, from, to time.Time) []*Occurrence {
	// A generous local window, so occurrences near the edges in any zone are
	// generated and then filtered by instant.
	windowEnd := WallFromUTC(to.Add(48 * time.Hour))
	var out []*Occurrence
	for _, o := range ex.Expand(e, &windowEnd, 0) {
		if o.Deleted {
			continue
		}
		s, en := o.Instants()
		if en.After(from) && s.Before(to) {
			out = append(out, o)
		}
	}
	return out
}

// Expand lists an event's occurrences from its start, including deleted ones.
func (ex Expander) Expand(e *Event, windowEnd *Wall, limit int) []*Occurrence {
	start, err := ParseLocal(e.StartLocal, e.AllDay)
	if err != nil {
		return nil
	}
	rule, err := ParseRRule(e.RRule, start)
	if err != nil {
		rule = nil
	}
	end := *windowEndOrNil(windowEnd, e.SeriesUntil)
	keys := rule.Occurs(start, &end, limit)
	out := make([]*Occurrence, 0, len(keys))
	for _, w := range keys {
		out = append(out, ex.occurrence(e, w))
	}
	// A modified exception whose own date moved still sorts by its shown start.
	sort.SliceStable(out, func(i, j int) bool { return out[i].ShownStart.Before(out[j].ShownStart) })
	return out
}

func windowEndOrNil(windowEnd *Wall, seriesUntil *string) *Wall {
	limit := windowEnd
	if seriesUntil != nil {
		if w, err := ParseDate(*seriesUntil); err == nil {
			cap := Wall{w.Y, w.M, w.D, 23, 59}
			if limit == nil || cap.Before(*limit) {
				limit = &cap
			}
		}
	}
	if limit == nil {
		far := WallFrom(time.Date(2100, 1, 1, 0, 0, 0, 0, time.UTC))
		limit = &far
	}
	return limit
}

// One gives one occurrence of an event by its key, whether or not the key
// still fits the rule.
func (ex Expander) One(e *Event, key string) *Occurrence {
	w, err := parseKey(key)
	if err != nil {
		return nil
	}
	return ex.occurrence(e, w)
}

func parseKey(key string) (Wall, error) {
	t, err := time.Parse(keyLayout, key)
	if err != nil {
		return Wall{}, fmt.Errorf("want YYYYMMDDTHHMM")
	}
	return wallOf(t), nil
}

// OccurrenceKey reads the occurrence part of an occurrence id.
func OccurrenceKey(eventID, occurrenceID string) string {
	if occurrenceID == eventID || occurrenceID == "" {
		return ""
	}
	if len(occurrenceID) > len(eventID)+1 && occurrenceID[:len(eventID)+1] == eventID+"@" {
		return occurrenceID[len(eventID)+1:]
	}
	return ""
}

// SplitOccurrenceID reads an occurrence id into its event id and key.
func SplitOccurrenceID(occurrenceID string) (eventID, key string) {
	for i := len(occurrenceID) - 1; i >= 0; i-- {
		if occurrenceID[i] == '@' {
			return occurrenceID[:i], occurrenceID[i+1:]
		}
	}
	return occurrenceID, ""
}

func (ex Expander) occurrence(e *Event, w Wall) *Occurrence {
	o := &Occurrence{
		Event:    e,
		Key:      w.Key(),
		AllDay:   e.AllDay,
		Title:    e.Title,
		Location: e.Location,
		Notes:    e.Notes,
	}
	seriesStart, _ := ParseLocal(e.StartLocal, e.AllDay)
	seriesEnd, _ := ParseLocal(e.EndLocal, e.AllDay)
	duration := seriesStart.MinutesUntil(seriesEnd)
	o.SavedStart = w
	o.SavedEnd = w.AddMinutes(duration)
	if x := e.Exception(w.Key()); x != nil {
		o.IsException = true
		o.Deleted = x.Deleted
		if x.StartLocal != nil {
			if s, err := ParseLocal(*x.StartLocal, e.AllDay); err == nil {
				o.SavedStart = s
				o.SavedEnd = s.AddMinutes(duration)
			}
		}
		if x.EndLocal != nil {
			if en, err := ParseLocal(*x.EndLocal, e.AllDay); err == nil {
				o.SavedEnd = en
			}
		}
		if x.Title != nil {
			o.Title = *x.Title
		}
		if x.Location != nil {
			o.Location = *x.Location
		}
		if x.Notes != nil {
			o.Notes = *x.Notes
		}
	}
	ex.applyTimes(e, o)
	return o
}

// applyTimes settles an occurrence's instants, shown clock times, gap move and
// zone rule warning.
func (ex Expander) applyTimes(e *Event, o *Occurrence) {
	o.ShownStart, o.ShownEnd = o.SavedStart, o.SavedEnd
	o.RequestedStart = o.SavedStart
	if e.AllDay {
		// All-day events are the same calendar dates for every viewer, and have
		// no clock times to warn about.
		return
	}
	date := o.SavedStart.Date()
	latest := ex.Rules.Latest(e.Zone, date)
	moved := ex.movedRule(e, date)
	if moved != nil {
		startUTC := o.SavedStart.AsUTC().Add(-time.Duration(moved.OffsetMinutes) * time.Minute)
		endUTC := o.SavedEnd.AsUTC().Add(-time.Duration(moved.OffsetMinutes) * time.Minute)
		o.StartUTC, o.EndUTC = &startUTC, &endUTC
	} else {
		startUTC, actual, adjusted := Resolve(o.SavedStart, e.Zone)
		if adjusted {
			o.Adjusted = true
			o.ShownStart = actual
			o.ShownEnd = actual.AddMinutes(o.SavedStart.MinutesUntil(o.SavedEnd))
			o.SavedStart, o.SavedEnd = actual, o.ShownEnd
		}
		endUTC, _, _ := Resolve(o.SavedEnd, e.Zone)
		o.StartUTC, o.EndUTC = &startUTC, &endUTC
	}
	if latest == nil || latest == moved {
		return
	}
	shift := latest.OffsetMinutes - OffsetAt(o.SavedStart, e.Zone)
	if shift == 0 || !ex.savedAfter(e, latest) {
		return
	}
	o.ShownStart = o.SavedStart.AddMinutes(shift)
	o.ShownEnd = o.SavedEnd.AddMinutes(shift)
	o.Warning = &ZoneWarning{
		RuleID:        latest.ID,
		City:          latest.City,
		EffectiveDate: latest.EffectiveDate,
		NewOffset:     latest.NewOffset,
		ShiftMinutes:  shift,
		SavedTime:     o.SavedStart.Clock(),
		ShownTime:     o.ShownStart.Clock(),
		Note:          latest.Note,
	}
}

// movedRule gives the last rule this event has already been moved for.
func (ex Expander) movedRule(e *Event, date string) *ZoneRule {
	var out *ZoneRule
	for i := range ex.Rules {
		r := &ex.Rules[i]
		if r.Zone != e.Zone || r.EffectiveDate > date || !e.MovedFor(r.ID) {
			continue
		}
		if out == nil || r.EffectiveDate > out.EffectiveDate {
			out = r
		}
	}
	return out
}

// savedAfter reports whether the event's last save fell, in the rule's zone,
// strictly after the rule's effective date.
func (ex Expander) savedAfter(e *Event, r *ZoneRule) bool {
	return InZone(e.SavedAt, r.Zone).Date() > r.EffectiveDate
}

// Warnings lists each rule warning any of an event's occurrences, with the
// values of the first occurrence so warned.
func (ex Expander) Warnings(e *Event) []ZoneWarning {
	var out []ZoneWarning
	seen := map[string]bool{}
	windowEnd := WallFromUTC(ex.Now.AddDate(2, 0, 0))
	for _, o := range ex.Expand(e, &windowEnd, 0) {
		if o.Deleted || o.Warning == nil || seen[o.Warning.RuleID] {
			continue
		}
		seen[o.Warning.RuleID] = true
		out = append(out, *o.Warning)
	}
	return out
}

// FirstWarned gives the earliest occurrence warned for a rule.
func (ex Expander) FirstWarned(e *Event, ruleID string) *Occurrence {
	windowEnd := WallFromUTC(ex.Now.AddDate(2, 0, 0))
	for _, o := range ex.Expand(e, &windowEnd, 0) {
		if !o.Deleted && o.Warning != nil && o.Warning.RuleID == ruleID {
			return o
		}
	}
	return nil
}

// NextOccurrence gives the first undeleted occurrence at or after an instant,
// or the last undeleted one when none remain.
func (ex Expander) NextOccurrence(e *Event, at time.Time) *Occurrence {
	windowEnd := WallFromUTC(at.AddDate(3, 0, 0))
	all := ex.Expand(e, &windowEnd, 0)
	var last *Occurrence
	for _, o := range all {
		if o.Deleted {
			continue
		}
		start, _ := o.Instants()
		if !start.Before(at) {
			return o
		}
		last = o
	}
	return last
}
