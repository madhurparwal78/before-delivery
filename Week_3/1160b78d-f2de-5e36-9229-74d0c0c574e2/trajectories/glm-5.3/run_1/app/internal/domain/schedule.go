package domain

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

// Layer is a rotation layer.
type Layer struct {
	ID           string           `json:"id"`
	ScheduleID   string           `json:"-"`
	Name         string           `json:"name"`
	Order        int              `json:"order"`
	ShiftDays     int              `json:"shift_days"`
	HandoffTime  string           `json:"handoff_time"`
	StartDate    string           `json:"start_date"`
	People       []string         `json:"people"`
	PeopleByID   map[string]string `json:"-"`
	Restrictions []Restriction    `json:"restrictions"`
	EditedAt     time.Time        `json:"edited_at"`
	RecordFormat int              `json:"record_format"`
	ScheduleZone string           `json:"-"`
	// PastForms keeps earlier forms of a layer so past ranges read identically.
	PastForms []*Layer `json:"-"`
}

// Restriction limits a layer to local windows.
type Restriction struct {
	Days  []string `json:"days"`
	Start string   `json:"start"`
	End   string   `json:"end"`
}

var dayIndex = map[string]time.Weekday{
	"mon": time.Monday, "tue": time.Tuesday, "wed": time.Wednesday,
	"thu": time.Thursday, "fri": time.Friday, "sat": time.Saturday, "sun": time.Sunday,
}

// LocalInstant resolves a local date, clock time and zone to an instant under
// the Daylight saving rule: a missing time takes the first valid instant after
// the jump, and a repeated time takes its first occurrence.
func LocalInstant(date string, clock string, zone string) (time.Time, error) {
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return time.Time{}, fmt.Errorf("unknown zone %s", zone)
	}
	naive := date + " " + clock
	base, perr := time.ParseInLocation("2006-01-02 15:04", naive, loc)
	if perr != nil {
		return time.Time{}, fmt.Errorf("bad local time %q", naive)
	}
	// A nonexistent wall time is normalized by Go onto an earlier instant, so
	// the parsed instant's own wall time differs from the requested one. The
	// rule then takes the first valid instant after the jump: the smallest
	// instant that is not before the parsed one and whose wall time is at or
	// after the requested one.
	if got := base.In(loc).Format("2006-01-02 15:04"); got != naive {
		// Walk minute by minute forward through the requested day. The first
		// candidate whose own wall time matches a valid instant at or after the
		// requested clock is the answer. In practice the jump lands the wall
		// clock exactly on the step after the gap.
		h, m, _ := parseClock(clock)
		requested := h*60 + m
		dayStart, derr := time.ParseInLocation("2006-01-02 15:04", date+" 00:00", loc)
		if derr != nil {
			return base, nil
		}
		for i := 0; i <= 3*24*60; i++ {
			cand := dayStart.Add(time.Duration(i) * time.Minute)
			wall := cand.In(loc)
			minutes := wall.Hour()*60 + wall.Minute()
			if minutes >= requested && wall.Format("2006-01-02") == date {
				if _, off1 := cand.Zone(); true {
					// Validity: converting back must land on the same wall time.
					if back := cand.In(loc); back == cand {
						_ = off1
						return cand, nil
					}
				}
			}
		}
		return base, nil
	}
	// A repeated wall time takes its first occurrence: Go's ParseInLocation
	// resolves the fold to the earlier instant, which the check above leaves
	// untouched because its wall time round-trips.
	return base, nil
}

func parseClock(clock string) (int, int, error) {
	var h, m int
	if _, err := fmt.Sscanf(clock, "%d:%d", &h, &m); err != nil {
		return 0, 0, fmt.Errorf("bad clock %q", clock)
	}
	return h, m, nil
}

// HandoffInstants lists every handoff instant of the layer in [from, to].
// The layer's holder at a moment comes from counting local-date shifts of
// shift_days from start_date at handoff_time, through people in turn.
func (l *Layer) HandoffInstants(zone string, from, to time.Time) []time.Time {
	if l.RecordFormat == 1 {
		zone = "UTC"
	}
	hh, mm, _ := parseClock(l.HandoffTime)
	startDate, err := time.Parse("2006-01-02", l.StartDate)
	if err != nil {
		return nil
	}
	fromD := time.Date(from.Year(), from.Month(), from.Day(), 0, 0, 0, 0, time.UTC)
	toD := time.Date(to.Year(), to.Month(), to.Day(), 0, 0, 0, 0, time.UTC)
	// Start a little before the range so the block covering `from` is found.
	probeD := fromD.AddDate(0, 0, -2)
	if probeD.Before(startDate) {
		probeD = startDate
	}
	var out []time.Time
	for d := probeD; !d.After(toD); d = d.AddDate(0, 0, 1) {
		inst, err := LocalInstant(d.Format("2006-01-02"), l.HandoffTime, zone)
		if err != nil {
			continue
		}
		// Counting shifts: only dates on the shift cadence produce handoffs.
		days := int(d.Sub(startDate).Hours() / 24)
		if days%l.ShiftDays != 0 {
			continue
		}
		if inst.Before(from.Add(-48 * time.Hour)) {
			continue
		}
		if inst.After(to.Add(48 * time.Hour)) {
			break
		}
		out = append(out, inst)
		_ = hh
		_ = mm
	}
	sort.Slice(out, func(a, b int) bool { return out[a].Before(out[b]) })
	return out
}

// HolderAt resolves who holds the layer at instant t. The holder comes from
// counting local-date shifts of shift_days from start_date at handoff_time,
// through people in turn, so the rotation never drifts across a clock change.
func (l *Layer) HolderAt(t time.Time, zone string, names map[string]string) *Holder {
	if len(l.People) == 0 {
		return nil
	}
	zone = l.ZoneFor(zone)
	startInstant, err := LocalInstant(l.StartDate, l.HandoffTime, zone)
	if err != nil {
		return nil
	}
	if t.Before(startInstant) {
		// Before start_date at handoff_time the layer has no holder and never
		// extends backwards.
		return nil
	}
	// Count completed local-date shifts: the local date of t at the handoff
	// clock, minus the start date, divided by shift_days.
	loc, lerr := time.LoadLocation(zone)
	if lerr != nil {
		return nil
	}
	hh, mm, _ := parseClock(l.HandoffTime)
	lt := t.In(loc)
	localDate := time.Date(lt.Year(), lt.Month(), lt.Day(), hh, mm, 0, 0, loc)
	if localDate.After(t) {
		// The handoff has not yet happened on this local date: the shift
		// belongs to the previous local date.
		localDate = localDate.AddDate(0, 0, -1)
	}
	start, serr := time.Parse("2006-01-02", l.StartDate)
	if serr != nil {
		return nil
	}
	days := int(localDate.Sub(start).Hours() / 24)
	idx := days / l.ShiftDays
	if idx < 0 {
		return nil
	}
	if idx >= len(l.People) {
		idx = idx % len(l.People)
	}
	id := l.People[idx]
	name, ok := names[id]
	if !ok {
		return nil
	}
	return &Holder{ID: id, Name: name}
}

// ZoneFor returns the layer's zone, honouring the record format upgrade.
func (l *Layer) ZoneFor(viewZone string) string {
	if l.RecordFormat == 1 {
		return "UTC"
	}
	if viewZone == "" {
		viewZone = l.ScheduleZone
	}
	return viewZone
}

// ScheduleZone is set by the loader for zone defaulting.
func (l *Layer) SetScheduleZone(z string) { l.ScheduleZone = z }

// RestrictionAllows reports whether instant t lies in one of the layer's
// local windows. A window that crosses midnight belongs to its start day.
func (l *Layer) RestrictionAllows(t time.Time, zone string) bool {
	if len(l.Restrictions) == 0 {
		return true
	}
	zone = l.ZoneFor(zone)
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return false
	}
	lt := t.In(loc)
	dayName := strings.ToLower(lt.Weekday().String()[0:3])
	minutes := lt.Hour()*60 + lt.Minute()
	// A crossing-midnight window started yesterday.
	yesterday := lt.AddDate(0, 0, -1)
	yName := strings.ToLower(yesterday.Weekday().String()[0:3])
	for _, r := range l.Restrictions {
		sh, sm, err1 := parseClock(r.Start)
		eh, em, err2 := parseClock(r.End)
		if err1 != nil || err2 != nil {
			continue
		}
		startM := sh*60 + sm
		endM := eh*60 + em
		if endM == 24*60 {
			endM = 24*60
		}
		hasDay := func(name string) bool {
			for _, d := range r.Days {
				if d == name {
					return true
				}
			}
			return false
		}
		if hasDay(dayName) {
			if startM <= endM {
				if minutes >= startM && minutes < endM {
					return true
				}
			} else {
				if minutes >= startM {
					return true
				}
			}
		}
		if hasDay(yName) && startM > endM {
			if minutes < endM {
				return true
			}
		}
	}
	return false
}

// FinalSchedule computes the one final schedule: the lowest layer first, each
// higher layer replacing where it has a holder, and overrides above all.
// Any moment without a person is a flagged gap.
func FinalSchedule(layers []*Layer, overrides []Override, from, to time.Time, names map[string]string) []Block {
	ordered := make([]*Layer, len(layers))
	copy(ordered, layers)
	sort.Slice(ordered, func(a, b int) bool { return ordered[a].Order < ordered[b].Order })

	// Candidate boundaries: every handoff instant and restriction edge inside range.
	edges := map[time.Time]bool{}
	probeFrom := from.Add(-48 * time.Hour)
	for _, l := range ordered {
		for _, inst := range l.HandoffInstants("", probeFrom, to) {
			if inst.After(probeFrom) && !inst.After(to) {
				edges[inst] = true
			}
		}
	}
	for _, o := range overrides {
		if o.Start.After(from) && !o.Start.After(to) {
			edges[o.Start] = true
		}
		if o.End.After(from) && !o.End.After(to) {
			edges[o.End] = true
		}
	}
	// Also step minute-by-minute through restriction edges.
	span := to.Sub(from)
	if span > 0 && span < 60*24*40*time.Hour {
		step := time.Minute
		for t := from; !t.After(to); t = t.Add(step) {
			if t.Equal(from) {
				continue
			}
			changed := false
			for _, l := range ordered {
				if len(l.Restrictions) == 0 {
					continue
				}
				if l.RestrictionAllows(t.Add(-time.Second), "") != l.RestrictionAllows(t, "") {
					changed = true
					break
				}
			}
			if changed {
				edges[t] = true
			}
		}
	}
	edgeList := make([]time.Time, 0, len(edges))
	for e := range edges {
		edgeList = append(edgeList, e)
	}
	sort.Slice(edgeList, func(a, b int) bool { return edgeList[a].Before(edgeList[b]) })

	buildAt := func(t time.Time) *Block {
		// Overrides above all.
		for _, o := range overrides {
			if Includes(o.Start, o.End, t) {
				var person *Holder
				if o.PersonID != nil {
					if name, ok := names[*o.PersonID]; ok {
						person = &Holder{ID: *o.PersonID, Name: name}
					}
				}
				return &Block{Start: t, End: t, Person: person, Gap: person == nil, Source: SourceOverride, OverrideID: &o.ID}
			}
		}
		for i := len(ordered) - 1; i >= 0; i-- {
			l := ordered[i]
			if l.RestrictionAllows(t, "") {
				h := l.HolderAt(t, "", names)
				if h != nil {
					return &Block{Start: t, End: t, Person: h, Source: SourceLayer, LayerID: &l.ID, LayerName: l.Name}
				}
			}
		}
		return &Block{Start: t, End: t, Person: nil, Gap: true, Source: SourceGap}
	}

	if len(edgeList) == 0 {
		b := buildAt(from)
		b.Start, b.End = from, to
		b.Minutes = int(to.Sub(from).Minutes())
		if b.Person == nil {
			b.Gap = true
		}
		return []Block{*b}
	}

	var blocks []Block
	points := append([]time.Time{from}, edgeList...)
	seen := map[time.Time]bool{}
	for _, p := range points {
		if seen[p] || p.Before(from) || p.After(to) {
			continue
		}
		seen[p] = true
		b := buildAt(p)
		end := to
		for _, q := range points {
			if seen[q] {
				continue
			}
			if q.After(p) && q.Before(to) {
				end = q
				break
			}
		}
		b.Start, b.End = p, end
		b.Minutes = int(end.Sub(p).Minutes())
		blocks = append(blocks, *b)
		if end.Equal(to) {
			break
		}
	}
	// A block runs from one change of holder or source to the next, so pieces
	// that agree on person and source are one block.
	merged := blocks[:0]
	for _, b := range blocks {
		if len(merged) > 0 {
			last := &merged[len(merged)-1]
			samePerson := (last.Person == nil && b.Person == nil) ||
				(last.Person != nil && b.Person != nil && last.Person.ID == b.Person.ID)
			if samePerson && last.Source == b.Source && last.Gap == b.Gap {
				last.End = b.End
				last.Minutes += b.Minutes
				continue
			}
		}
		merged = append(merged, b)
	}
	return merged
}

// Override is a schedule override; person null is a deliberate gap.
type Override struct {
	ID       string  `json:"id"`
	PersonID *string `json:"-"`
	Start    time.Time `json:"start"`
	End      time.Time `json:"end"`
}

// OverrideJSON is the published override shape.
type OverrideJSON struct {
	ID     string `json:"id"`
	Person *Holder `json:"person"`
	Start  time.Time `json:"start"`
	End    time.Time `json:"end"`
}
