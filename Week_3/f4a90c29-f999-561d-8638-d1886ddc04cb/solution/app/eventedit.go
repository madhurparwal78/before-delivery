package main

import (
	"encoding/json"
	"time"
)

// SplitResult names the two series a This and following edit leaves behind.
type SplitResult struct {
	EarlierID string `json:"earlier_id"`
	LaterID   string `json:"later_id"`
}

type snapshot struct {
	Event      Event
	Exceptions []Exception
	Replies    []ReplyChange
}

func formatWall(e *Event, w wall) string {
	if e.AllDay {
		return w.Format(layoutDate)
	}
	return wallString(w)
}

// deltas is how far the sent start and end move an occurrence, in the occurrence's shown clock terms.
func (p *EventPatch) deltas(occ *Occurrence, allDay bool) (ds, de time.Duration, errs map[string]string) {
	errs = map[string]string{}
	if p.Start == nil && p.End == nil {
		return
	}
	parse := func(name string, text *string) (wall, bool) {
		w, err := parseStored2(*text, allDay)
		if err != nil {
			if allDay {
				errs[name] = "Use YYYY-MM-DD."
			} else {
				errs[name] = "Use YYYY-MM-DDTHH:MM."
			}
			return w, false
		}
		return w, true
	}
	if p.Start != nil {
		if s, ok := parse("start_local", p.Start); ok {
			ds = s.Sub(occ.ShownStart)
		}
	}
	if p.End != nil {
		if en, ok := parse("end_local", p.End); ok {
			de = en.Sub(occ.ShownEnd)
		}
	} else {
		de = ds
	}
	return
}

func parseStored2(s string, allDay bool) (wall, error) {
	if allDay {
		return parseDate(s)
	}
	return parseWall(s)
}

func (p *EventPatch) wholeEventFields(e *Event) {
	if p.Kind != nil {
		e.Kind = *p.Kind
		if e.Kind == "focus" && e.DeclineMode == nil {
			e.DeclineMode = ptr("new_and_existing")
		}
	}
	if p.Zone != nil {
		e.Zone = *p.Zone
	}
	if p.AllDay != nil {
		e.AllDay = *p.AllDay
		if e.AllDay {
			e.Reminders = []int{}
		}
	}
}

// patchEvent applies one edit at a scope. It returns the event the response describes and any split.
func (ed *Edit) patchEvent(e *Event, p *EventPatch, scope string, occ *Occurrence) (*Event, *SplitResult, error) {
	before := *e
	before.Exceptions = map[string]*Exception{}
	exceptionsBefore := make([]Exception, 0, len(e.Exceptions))
	for _, key := range sortedKeys(e.Exceptions) {
		x := e.Exceptions[key]
		over := map[string]string{}
		for k, v := range x.Over {
			over[k] = v
		}
		exceptionsBefore = append(exceptionsBefore, Exception{Key: x.Key, Deleted: x.Deleted, Over: over})
	}
	before.GuestIDs, before.Replies, before.Proposals, before.Link = nil, nil, nil, nil
	hadList := e.Switches.SeeGuestList

	var result *Event
	var split *SplitResult
	var err error
	switch {
	case !e.recurring() || scope == "all":
		result, err = ed.patchWhole(e, p, occ)
	case scope == "this":
		result, err = ed.patchOccurrence(e, p, occ)
	case keyOf(e.baseStart()) == occ.Key:
		result, err = ed.patchWhole(e, p, occ)
	default:
		result, split, err = ed.patchFollowing(e, p, occ)
	}
	if err != nil {
		return nil, nil, err
	}
	if hadList && !e.Switches.SeeGuestList {
		if _, err := ed.Tx.ExecContext(ed.Ctx, `DELETE FROM share_links WHERE event_id = $1`, e.ID); err != nil {
			return nil, nil, err
		}
		e.Link = nil
	}
	if split == nil {
		raw, _ := json.Marshal(snapshot{Event: before, Exceptions: exceptionsBefore, Replies: ed.Undo})
		if _, err := ed.Tx.ExecContext(ed.Ctx, `INSERT INTO undo_snapshots VALUES ($1,$2,$3)
			ON CONFLICT (event_id) DO UPDATE SET after_version=$2, snapshot=$3`, e.ID, e.Version, raw); err != nil {
			return nil, nil, err
		}
	}
	return result, split, nil
}

// restoreSnapshot puts back what the last edit altered: its event row, exceptions and reset replies.
func (ed *Edit) restoreSnapshot(e *Event, raw []byte) error {
	var s snapshot
	if err := json.Unmarshal(raw, &s); err != nil {
		return err
	}
	prev := s.Event
	prev.Version = e.Version
	prev.Exceptions, prev.GuestIDs, prev.Replies = e.Exceptions, e.GuestIDs, e.Replies
	prev.Trashed = e.Trashed
	*e = prev
	for key := range e.Exceptions {
		delete(e.Exceptions, key)
	}
	if _, err := ed.Tx.ExecContext(ed.Ctx, `DELETE FROM exceptions WHERE event_id=$1`, e.ID); err != nil {
		return err
	}
	for i := range s.Exceptions {
		x := s.Exceptions[i]
		if err := ed.writeException(e, &x); err != nil {
			return err
		}
	}
	for i := len(s.Replies) - 1; i >= 0; i-- {
		c := s.Replies[i]
		if c.Prev == nil {
			if err := ed.dropReplies(e, c.PersonID, func(k string) bool { return k == c.Key }); err != nil {
				return err
			}
			continue
		}
		if err := ed.setReply(e, c.PersonID, c.Key, c.Prev.Status, c.Prev.Message, false); err != nil {
			return err
		}
	}
	return ed.touch(e)
}

func clockOf(w wall) string { return w.Format("1504") }

// patchWhole applies an edit to a single event or to every occurrence of a series.
func (ed *Edit) patchWhole(e *Event, p *EventPatch, occ *Occurrence) (*Event, error) {
	oldStart, oldDur := e.baseStart(), e.baseDuration()
	oldZone, oldAllDay := e.Zone, e.AllDay
	oldRule := ""
	if e.recurring() {
		oldRule = *e.RRule
	}
	p.applyContent(e)
	p.applyEventWide(e)
	p.wholeEventFields(e)
	if p.Present["rrule"] {
		e.RRule = p.RRule
		if p.RRule != nil && *p.RRule == "" {
			e.RRule = nil
		}
	}
	modeChange := e.AllDay != oldAllDay
	if p.Start != nil || p.End != nil {
		if modeChange || occ == nil {
			if p.Start != nil {
				e.StartLocal = *p.Start
			}
			if p.End != nil {
				e.EndLocal = *p.End
			}
		} else {
			ds, de, errs := p.deltas(occ, e.AllDay)
			if len(errs) > 0 {
				return nil, fieldErrors(errs)
			}
			e.StartLocal = formatWall(e, oldStart.Add(ds))
			e.EndLocal = formatWall(e, oldStart.Add(oldDur+de))
		}
	}
	if e.recurring() && !p.Present["rrule"] && e.StartLocal != "" {
		if start, err := parseStored2(e.StartLocal, e.AllDay); err == nil {
			if _, ok := parseRule(*e.RRule, dateOnly(start)); !ok {
				if r, ok := parseRule(oldRule, dateOnly(oldStart)); ok {
					if shifted := r.Shifted(dateOnly(start)); shifted != oldRule {
						e.RRule = &shifted
					}
				}
			}
		}
	}
	if errs := validateEvent(e); len(errs) > 0 {
		return nil, fieldErrors(errs)
	}
	newStart, newDur := e.baseStart(), e.baseDuration()
	timeChanged := !newStart.Equal(oldStart) || newDur != oldDur || e.Zone != oldZone || e.AllDay != oldAllDay
	ruleChanged := e.recurring() && *e.RRule != oldRule
	if e.recurring() {
		if err := ed.adjustExceptions(e, p, oldStart, newStart, newDur, ruleChanged, true); err != nil {
			return nil, err
		}
	}
	if err := ed.touch(e); err != nil {
		return nil, err
	}
	if timeChanged {
		if err := ed.reopenReplies(e, nil, nil); err != nil {
			return nil, err
		}
	}
	if timeChanged || ruleChanged || p.Kind != nil {
		if err := ed.recheck(e, nil); err != nil {
			return nil, err
		}
	}
	return e, nil
}

// adjustExceptions keeps each exception on its date when the series changes. When replace is set (All events),
// edited fields take the new value; a new clock time re-keys them; rule changes drop deleted dates that no longer fit.
func (ed *Edit) adjustExceptions(e *Event, p *EventPatch, oldStart, newStart wall, newDur time.Duration, ruleChanged, replace bool) error {
	newClock := clockOf(newStart)
	clockChanged := clockOf(oldStart) != newClock
	if replace {
		for _, key := range sortedKeys(e.Exceptions) {
			x := e.Exceptions[key]
			if _, ok := x.Over["title"]; ok && p.Title != nil {
				x.Over["title"] = e.Title
			}
			if _, ok := x.Over["location"]; ok && p.Location != nil {
				x.Over["location"] = e.Location
			}
			if _, ok := x.Over["notes"]; ok && p.Notes != nil {
				x.Over["notes"] = e.Notes
			}
			if s, ok := x.Over["start_local"]; ok && (p.Start != nil || p.End != nil) {
				moved, _ := parseStored2(s, e.AllDay)
				moved = dateOnly(moved).Add(newStart.Sub(dateOnly(newStart)))
				x.Over["start_local"], x.Over["end_local"] = formatWall(e, moved), formatWall(e, moved.Add(newDur))
			}
		}
	}
	if ruleChanged {
		r := e.rule()
		for _, key := range sortedKeys(e.Exceptions) {
			x := e.Exceptions[key]
			d := dateOnly(wallFromKey(key))
			if x.Deleted && len(r.dates(dateOnly(newStart), d, d)) == 0 {
				x.Deleted = false
				x.Over = map[string]string{}
			}
		}
	}
	if clockChanged {
		if err := ed.rekey(e, func(k string) string { return k[:9] + newClock }); err != nil {
			return err
		}
	}
	return ed.normalizeExceptions(e)
}

// normalizeExceptions drops overrides equal to the series' own values and empty exceptions.
func (ed *Edit) normalizeExceptions(e *Event) error {
	for _, key := range sortedKeys(e.Exceptions) {
		x := e.Exceptions[key]
		nominal := wallFromKey(key)
		if e.AllDay {
			nominal = dateOnly(nominal)
		}
		same := map[string]string{"title": e.Title, "location": e.Location, "notes": e.Notes,
			"start_local": formatWall(e, nominal), "end_local": formatWall(e, nominal.Add(e.baseDuration()))}
		if x.Over["start_local"] == same["start_local"] && x.Over["end_local"] == same["end_local"] {
			delete(x.Over, "start_local")
			delete(x.Over, "end_local")
		}
		for _, f := range []string{"title", "location", "notes"} {
			if v, ok := x.Over[f]; ok && v == same[f] {
				delete(x.Over, f)
			}
		}
		if err := ed.writeException(e, x); err != nil {
			return err
		}
	}
	return nil
}

// patchOccurrence writes an exception for one occurrence.
func (ed *Edit) patchOccurrence(e *Event, p *EventPatch, occ *Occurrence) (*Event, error) {
	errs := map[string]string{}
	for _, f := range []string{"rrule", "zone", "all_day", "kind"} {
		if p.Present[f] {
			errs[f] = "This applies to the whole series. Choose This and following events or All events."
		}
	}
	ds, de, timeErrs := p.deltas(occ, e.AllDay)
	for k, v := range timeErrs {
		errs[k] = v
	}
	p.applyEventWide(e)
	probe := *e
	probe.Title, probe.Location, probe.Notes = occ.Title, occ.Location, occ.Notes
	p.applyContent(&probe)
	newStart, newEnd := occ.SavedStart.Add(ds), occ.SavedEnd.Add(de)
	probe.StartLocal, probe.EndLocal = formatWall(e, newStart), formatWall(e, newEnd)
	probe.RRule, probe.DeclineMessage, probe.DeclineMode = nil, e.DeclineMessage, e.DeclineMode
	for k, v := range validateEvent(&probe) {
		errs[k] = v
	}
	if len(errs) > 0 {
		return nil, fieldErrors(errs)
	}
	x := e.Exceptions[occ.Key]
	if x == nil {
		x = &Exception{Key: occ.Key, Over: map[string]string{}}
	}
	if p.Title != nil {
		x.Over["title"] = probe.Title
	}
	if p.Location != nil {
		x.Over["location"] = probe.Location
	}
	if p.Notes != nil {
		x.Over["notes"] = probe.Notes
	}
	timeChanged := ds != 0 || de != 0
	if timeChanged {
		x.Over["start_local"], x.Over["end_local"] = probe.StartLocal, probe.EndLocal
	}
	e.Exceptions[x.Key] = x
	if err := ed.normalizeExceptions(e); err != nil {
		return nil, err
	}
	if err := ed.touch(e); err != nil {
		return nil, err
	}
	if timeChanged {
		keys := map[string]bool{occ.Key: true}
		if err := ed.reopenReplies(e, []string{occ.Key}, nil); err != nil {
			return nil, err
		}
		if err := ed.recheck(e, keys); err != nil {
			return nil, err
		}
	}
	return e, nil
}

// patchFollowing ends the series before an occurrence and starts a new one there with the changes.
func (ed *Edit) patchFollowing(e *Event, p *EventPatch, occ *Occurrence) (*Event, *SplitResult, error) {
	nominal := wallFromKey(occ.Key)
	if e.AllDay {
		nominal = dateOnly(nominal)
	}
	ds, de, errs := p.deltas(occ, e.AllDay)
	if len(errs) > 0 {
		return nil, nil, fieldErrors(errs)
	}
	oldDur := e.baseDuration()
	later, err := ed.split(e, nominal, nominal.Add(ds), nominal.Add(oldDur+de))
	if err != nil {
		return nil, nil, err
	}
	p.applyContent(later)
	p.applyEventWide(later)
	p.wholeEventFields(later)
	if p.Present["rrule"] {
		later.RRule = p.RRule
		if p.RRule != nil && *p.RRule == "" {
			later.RRule = nil
		}
	}
	if p.Present["rrule"] || ds != 0 {
		if start, perr := parseStored2(later.StartLocal, later.AllDay); perr == nil && later.recurring() {
			if _, ok := parseRule(*later.RRule, dateOnly(start)); !ok {
				if r, ok := parseRule(*later.RRule, dateOnly(nominal)); ok && !p.Present["rrule"] {
					shifted := r.Shifted(dateOnly(start))
					later.RRule = &shifted
				}
			}
		}
	}
	if errs := validateEvent(later); len(errs) > 0 {
		return nil, nil, fieldErrors(errs)
	}
	newStart, newDur := later.baseStart(), later.baseDuration()
	timeChanged := ds != 0 || de != 0 || p.Zone != nil || p.AllDay != nil
	if err := ed.adjustExceptions(later, p, nominal, newStart, newDur, p.Present["rrule"], false); err != nil {
		return nil, nil, err
	}
	if err := ed.touch(e); err != nil {
		return nil, nil, err
	}
	if err := saveEvent(ed.Ctx, ed.Tx, later); err != nil {
		return nil, nil, err
	}
	if timeChanged {
		later.Replies = nil
		if err := attachReplies(ed.Ctx, ed.Tx, []*Event{later}); err != nil {
			return nil, nil, err
		}
		if err := ed.reopenReplies(later, nil, nil); err != nil {
			return nil, nil, err
		}
	} else if err := attachReplies(ed.Ctx, ed.Tx, []*Event{later}); err != nil {
		return nil, nil, err
	}
	if err := ed.recheck(later, nil); err != nil {
		return nil, nil, err
	}
	if err := ed.changed(e, "event.changed"); err != nil {
		return nil, nil, err
	}
	return later, &SplitResult{EarlierID: e.ID, LaterID: later.ID}, nil
}
