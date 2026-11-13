package main

import (
	"sort"
	"time"
)

// Warning is a zone rule warning on one occurrence.
type Warning struct {
	RuleID, City, EffectiveDate, NewOffset, SavedTime, ShownTime, Note string
	ShiftMinutes                                                       int
}

// CityTime is one entry of a clocks array.
type CityTime struct {
	City, Time, Date string
	Inside           bool
}

// Occurrence is one dated occurrence of an event with its effective values.
type Occurrence struct {
	Event                          *Event
	Key, ID                        string
	Title, Location, Notes, Colour string
	AllDay, Adjusted, IsException  bool
	SavedStart, SavedEnd           wall
	ShownStart, ShownEnd           wall
	Begin, Finish                  time.Time
	Warning                        *Warning
}

// ReplyKey is the key of this occurrence's own replies; a single event only has the series default.
func (o *Occurrence) ReplyKey() string {
	if o.Event.recurring() {
		return o.Key
	}
	return ""
}

// Window selects occurrences: timed ones by instants, all-day ones by dates when Dates is set.
type Window struct {
	From, To time.Time
	Dates    bool
	FromDate time.Time
	ToDate   time.Time
}

func (w Window) overlaps(o *Occurrence) bool {
	if o.AllDay && w.Dates {
		return o.SavedStart.Before(w.ToDate) && !o.SavedEnd.Before(w.FromDate)
	}
	return o.Begin.Before(w.To) && o.Finish.After(w.From)
}

func keyOf(w wall) string { return w.Format(layoutKey) }

func wallFromKey(key string) wall {
	t, _ := time.Parse(layoutKey, key)
	return t
}

func (e *Event) baseDuration() time.Duration {
	if e.AllDay {
		s, _ := parseDate(e.StartLocal)
		en, _ := parseDate(e.EndLocal)
		return en.Sub(s)
	}
	s, _ := parseWall(e.StartLocal)
	en, _ := parseWall(e.EndLocal)
	return en.Sub(s)
}

func (e *Event) baseStart() wall {
	if e.AllDay {
		d, _ := parseDate(e.StartLocal)
		return d
	}
	s, _ := parseWall(e.StartLocal)
	return s
}

func (e *Event) rule() *RepeatRule {
	if !e.recurring() {
		return nil
	}
	r, _ := parseRule(*e.RRule, dateOnly(e.baseStart()))
	return r
}

// build makes the occurrence for a nominal start, applying its exception; nil when deleted.
func (w *World) build(e *Event, nominal wall) *Occurrence {
	key := keyOf(nominal)
	x := e.Exceptions[key]
	if x != nil && x.Deleted {
		return nil
	}
	return w.buildWith(e, nominal, x)
}

func (w *World) buildWith(e *Event, nominal wall, x *Exception) *Occurrence {
	o := &Occurrence{Event: e, Key: keyOf(nominal), AllDay: e.AllDay, IsException: x != nil,
		Title: e.Title, Location: e.Location, Notes: e.Notes, Colour: e.Colour}
	o.ID = e.ID
	if e.recurring() {
		o.ID = e.ID + "@" + o.Key
	}
	start, dur := nominal, e.baseDuration()
	if x != nil {
		if v, ok := x.Over["title"]; ok {
			o.Title = v
		}
		if v, ok := x.Over["location"]; ok {
			o.Location = v
		}
		if v, ok := x.Over["notes"]; ok {
			o.Notes = v
		}
		if v, ok := x.Over["start_local"]; ok {
			start = parseStored(v, e.AllDay)
			if end, ok := x.Over["end_local"]; ok {
				dur = parseStored(end, e.AllDay).Sub(start)
			}
		}
	}
	o.SavedStart = start
	loc := zoneLocations[e.Zone]
	if e.AllDay {
		o.SavedEnd = start.Add(dur)
		o.ShownStart, o.ShownEnd = o.SavedStart, o.SavedEnd
		o.Begin, _, _ = resolveLocal(loc, o.SavedStart, nil)
		o.Finish, _, _ = resolveLocal(loc, o.SavedEnd.AddDate(0, 0, 1), nil)
		return o
	}
	fixed := fixedOffsetFor(w.Rules, e.MovedRules, e.Zone, start.Format(layoutDate))
	instant, shown, adjusted := resolveLocal(loc, start, fixed)
	o.Begin, o.SavedStart, o.Adjusted = instant, shown, adjusted
	o.SavedEnd = o.SavedStart.Add(dur)
	o.Finish, o.SavedEnd, _ = resolveLocal(loc, o.SavedEnd, fixed)
	o.ShownStart, o.ShownEnd = o.SavedStart, o.SavedEnd
	w.warn(o, loc)
	return o
}

func parseStored(s string, allDay bool) wall {
	if allDay {
		d, _ := parseDate(s)
		return d
	}
	t, _ := parseWall(s)
	return t
}

// warn sets the zone rule warning of an occurrence and its shown clock times.
func (w *World) warn(o *Occurrence, loc *time.Location) {
	e := o.Event
	date := o.SavedStart.Format(layoutDate)
	rule := latestRule(w.Rules, e.Zone, date)
	if rule == nil || e.AllDay {
		return
	}
	for _, id := range e.MovedRules {
		if id == rule.ID {
			return
		}
	}
	if e.SavedAt.In(loc).Format(layoutDate) <= rule.EffectiveDate {
		return
	}
	shift := (offsetToSeconds(rule.NewOffset) - offsetSeconds(loc, o.Begin)) / 60
	if shift == 0 {
		return
	}
	o.ShownStart = o.SavedStart.Add(time.Duration(shift) * time.Minute)
	o.ShownEnd = o.SavedEnd.Add(time.Duration(shift) * time.Minute)
	o.Warning = &Warning{RuleID: rule.ID, City: zoneCity[e.Zone], EffectiveDate: rule.EffectiveDate, NewOffset: rule.NewOffset,
		ShiftMinutes: shift, SavedTime: o.SavedStart.Format("15:04"), ShownTime: o.ShownStart.Format("15:04"), Note: rule.Note}
}

// occurrences is the one function that expands an event into occurrences inside a window.
func (w *World) occurrences(e *Event, win Window) []*Occurrence {
	if e.Trashed {
		return nil
	}
	loc := zoneLocations[e.Zone]
	lead := int(e.baseDuration().Hours()/24) + 3
	from := dateOnly(wallOf(win.From, loc)).AddDate(0, 0, -lead)
	to := dateOnly(wallOf(win.To, loc)).AddDate(0, 0, 2)
	if win.Dates {
		from, to = win.FromDate.AddDate(0, 0, -lead), win.ToDate.AddDate(0, 0, 2)
	}
	var out []*Occurrence
	seen := map[string]bool{}
	add := func(o *Occurrence) {
		if o != nil && win.overlaps(o) {
			out = append(out, o)
		}
	}
	clock := e.baseStart()
	if r := e.rule(); r != nil {
		start := dateOnly(clock)
		for _, d := range r.dates(start, from, to) {
			nominal := d.Add(clock.Sub(start))
			seen[keyOf(nominal)] = true
			add(w.build(e, nominal))
		}
	} else {
		seen[keyOf(clock)] = true
		add(w.build(e, clock))
	}
	for key, x := range e.Exceptions {
		if !x.Deleted && !seen[key] {
			add(w.buildWith(e, wallFromKey(key), x))
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if !out[i].Begin.Equal(out[j].Begin) {
			return out[i].Begin.Before(out[j].Begin)
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// occurrenceAt returns the live occurrence with the given nominal key, or nil.
func (w *World) occurrenceAt(e *Event, key string) *Occurrence {
	if e.Trashed {
		return nil
	}
	nominal := wallFromKey(key)
	if !e.recurring() {
		if keyOf(e.baseStart()) != key {
			return nil
		}
		return w.build(e, nominal)
	}
	if x := e.Exceptions[key]; x != nil {
		if x.Deleted {
			return nil
		}
		return w.buildWith(e, nominal, x)
	}
	r := e.rule()
	d := dateOnly(nominal)
	if len(r.dates(dateOnly(e.baseStart()), d, d)) == 0 || !nominal.Equal(d.Add(e.baseStart().Sub(dateOnly(e.baseStart())))) {
		return nil
	}
	return w.build(e, nominal)
}

// firstOccurrence is the occurrence an event-level view describes: the first live one.
func (w *World) firstOccurrence(e *Event) *Occurrence {
	start := e.baseStart()
	if o := w.occurrenceAt(e, keyOf(start)); o != nil {
		return o
	}
	if occs := w.occurrences(e, Window{From: start, To: start.AddDate(2, 0, 0)}); len(occs) > 0 {
		return occs[0]
	}
	return w.buildWith(e, start, nil)
}

// clocks lists the three city readings of an occurrence's start; own-zone entry uses the shown clock.
func (w *World) clocks(o *Occurrence) []CityTime {
	if o.AllDay {
		return []CityTime{}
	}
	return w.clocksAt(o.Begin, map[string]wall{o.Event.Zone: o.ShownStart})
}

// clocksAt reads an instant on the three city clocks; a shown reading replaces that zone's own clock.
func (w *World) clocksAt(instant time.Time, shown map[string]wall) []CityTime {
	out := make([]CityTime, 0, 3)
	for _, z := range zoneOrder {
		reading, ok := shown[z]
		if !ok {
			reading = wallOf(instant, zoneLocations[z])
		}
		out = append(out, CityTime{City: zoneCity[z], Time: reading.Format("15:04"), Date: reading.Format(layoutDate),
			Inside: w.hasHours(z).insideHours(reading, false)})
	}
	return out
}

// warnings lists each rule warning any occurrence of the event carries, from the first so warned.
func (w *World) warnings(e *Event) []*Warning {
	if e.Trashed || e.AllDay {
		return nil
	}
	var out []*Warning
	seen := map[string]bool{}
	start := e.baseStart()
	window := Window{From: start.AddDate(0, 0, -1), To: start.AddDate(3, 0, 0)}
	for _, o := range w.occurrences(e, window) {
		if o.Warning != nil && !seen[o.Warning.RuleID] {
			seen[o.Warning.RuleID] = true
			out = append(out, o.Warning)
		}
	}
	return out
}
