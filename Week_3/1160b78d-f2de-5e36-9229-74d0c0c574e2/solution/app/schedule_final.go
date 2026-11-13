package main

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"sort"
	"time"
)

// This file is the final-schedule computation, the only one: the lowest layer first, each higher layer replacing it
// where it has a holder, overrides above all, and every moment left over a flagged gap.

const (
	sourceLayer    = "layer"
	sourceOverride = "override"
	sourceGap      = "gap"
)

// restrictionSpec is one local window a layer is limited to; days name the local day the window starts on.
type restrictionSpec struct {
	Days  []string `json:"days"`
	Start string   `json:"start"`
	End   string   `json:"end"`
}

// restrictionWindow is a restrictionSpec read for computing.
type restrictionWindow struct {
	days       [7]bool
	start, end int // minutes after local midnight; end may be 1440
}

// layerForm is one saved form of a layer.
type layerForm struct {
	Name         string
	Order        int
	ShiftDays    int
	HandoffTime  string // HH:MM in the schedule zone
	StartDate    string // YYYY-MM-DD in the schedule zone
	People       []string
	Restrictions []restrictionSpec

	handoff int
	start   localDay
	windows []restrictionWindow
}

// compile reads the text fields into the values holderAt works with.
func (f *layerForm) compile() error {
	handoff, ok := clockMinutes(f.HandoffTime, false)
	if !ok {
		return fmt.Errorf("handoff time %q is not HH:MM", f.HandoffTime)
	}
	start, err := parseLocalDay(f.StartDate)
	if err != nil {
		return fmt.Errorf("read start date: %w", err)
	}
	f.handoff, f.start = handoff, start
	f.windows = f.windows[:0]
	for _, spec := range f.Restrictions {
		window := restrictionWindow{}
		for _, name := range spec.Days {
			weekday := slices.Index(weekdayNames[:], name)
			if weekday < 0 {
				return fmt.Errorf("restriction day %q is not a weekday", name)
			}
			window.days[weekday] = true
		}
		var startOK, endOK bool
		window.start, startOK = clockMinutes(spec.Start, false)
		window.end, endOK = clockMinutes(spec.End, true)
		if !startOK || !endOK {
			return fmt.Errorf("restriction %q to %q is not HH:MM", spec.Start, spec.End)
		}
		f.windows = append(f.windows, window)
	}
	return nil
}

// span is the instants a window runs on the local day it starts on.
func (r restrictionWindow) span(day localDay, loc *time.Location) (time.Time, time.Time) {
	endDay := day
	if r.end <= r.start {
		endDay = day.plus(1)
	}
	return day.at(loc, r.start), endDay.at(loc, r.end)
}

// allows reports whether the restrictions let the layer hold at an instant; a layer without any is always allowed.
func (f *layerForm) allows(t time.Time, loc *time.Location) bool {
	if len(f.windows) == 0 {
		return true
	}
	today := dayOf(t, loc)
	for _, day := range []localDay{today, today.plus(-1)} {
		for _, window := range f.windows {
			if !window.days[day.weekday()] {
				continue
			}
			if begin, end := window.span(day, loc); periodHolds(begin, end, t) {
				return true
			}
		}
	}
	return false
}

// holderAt is the person this form puts on call at an instant: local-date shifts of ShiftDays from StartDate at the
// handoff time, in turn through People, and nobody before the first handoff.
func (f *layerForm) holderAt(t time.Time, loc *time.Location) (string, bool) {
	if len(f.People) == 0 || !f.allows(t, loc) {
		return "", false
	}
	day := dayOf(t, loc)
	if !instantReached(t, day.at(loc, f.handoff)) {
		day = day.plus(-1)
	}
	elapsed := day.since(f.start)
	if elapsed < 0 {
		return "", false
	}
	return f.People[(elapsed/f.ShiftDays)%len(f.People)], true
}

// edges adds every instant strictly inside (lo, hi) where this form can change its holder.
func (f *layerForm) edges(loc *time.Location, lo, hi time.Time, add func(time.Time)) {
	first := dayOf(lo, loc).plus(-1)
	for shift := max(0, first.since(f.start)/f.ShiftDays); ; shift++ {
		handoff := f.start.plus(shift*f.ShiftDays).at(loc, f.handoff)
		if instantReached(handoff, hi) {
			break
		}
		add(handoff)
	}
	for last, day := dayOf(hi, loc), first; !day.midnight.After(last.midnight); day = day.plus(1) {
		for _, window := range f.windows {
			if window.days[day.weekday()] {
				begin, end := window.span(day, loc)
				add(begin)
				add(end)
			}
		}
	}
}

// layerRevision is a layer form and the second it took effect (nil: since the beginning).
type layerRevision struct {
	Number int
	From   *time.Time
	Form   layerForm
}

// layerHistory is a layer with every form it has had. The earlier form keeps computing the past.
type layerHistory struct {
	ID        string
	Seq       int64
	Version   int
	Revisions []layerRevision
}

// formAt is the form in force at an instant: the latest revision that had taken effect.
func (l *layerHistory) formAt(t time.Time) *layerForm {
	for i := len(l.Revisions) - 1; i >= 0; i-- {
		if from := l.Revisions[i].From; from == nil || instantReached(t, *from) {
			return &l.Revisions[i].Form
		}
	}
	return nil
}

// current is the newest form.
func (l *layerHistory) current() *layerForm { return &l.Revisions[len(l.Revisions)-1].Form }

// edges adds every instant strictly inside (lo, hi) where this layer can change its holder.
func (l *layerHistory) edges(loc *time.Location, lo, hi time.Time, add func(time.Time)) {
	for i := range l.Revisions {
		from, until := lo, hi
		if f := l.Revisions[i].From; f != nil {
			add(*f)
			from = laterOf(from, *f)
		}
		if i+1 < len(l.Revisions) {
			until = earlierOf(until, *l.Revisions[i+1].From)
		}
		if !instantReached(from, until) {
			l.Revisions[i].Form.edges(loc, from, until, add)
		}
	}
}

func laterOf(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}

func earlierOf(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}

// overrideRow is one saved cut; a nil person is a deliberate gap.
type overrideRow struct {
	ID       string
	PersonID *string
	Start    time.Time
	End      time.Time
}

// scheduleModel is a schedule with everything its final computation reads.
type scheduleModel struct {
	ID           string
	Name         string
	Zone         string
	RecordFormat int
	UpgradedAt   *time.Time
	Version      int
	loc          *time.Location
	layers       []*layerHistory
	overrides    []overrideRow
	names        map[string]string
}

// slot is who holds a stretch of the final schedule and by which source.
type slot struct {
	person     string // user id; empty when nobody holds
	source     string
	layerID    string
	overrideID string
}

// sameHolder is the rule for merging neighbouring stretches: the same person from the same source.
func (s slot) sameHolder(o slot) bool { return s.person == o.person && s.source == o.source }

// stretch is a stretch of the final schedule from one change to the next.
type stretch struct {
	slot
	Start time.Time
	End   time.Time
}

// slotAt is the final schedule at one instant.
func (m *scheduleModel) slotAt(t time.Time) slot {
	for _, o := range m.overrides {
		if periodHolds(o.Start, o.End, t) {
			if o.PersonID == nil {
				return slot{source: sourceGap, overrideID: o.ID}
			}
			return slot{person: *o.PersonID, source: sourceOverride, overrideID: o.ID}
		}
	}
	best, found := slot{source: sourceGap}, false
	var bestOrder int
	var bestSeq int64
	for _, layer := range m.layers {
		form := layer.formAt(t)
		if form == nil {
			continue
		}
		person, held := form.holderAt(t, m.loc)
		if held && (!found || form.Order > bestOrder || (form.Order == bestOrder && layer.Seq > bestSeq)) {
			best, found = slot{person: person, source: sourceLayer, layerID: layer.ID}, true
			bestOrder, bestSeq = form.Order, layer.Seq
		}
	}
	return best
}

// layerSlotAt is what one layer alone puts on call at an instant.
func (m *scheduleModel) layerSlotAt(layer *layerHistory, t time.Time) slot {
	if form := layer.formAt(t); form != nil {
		if person, held := form.holderAt(t, m.loc); held {
			return slot{person: person, source: sourceLayer, layerID: layer.ID}
		}
	}
	return slot{source: sourceGap}
}

// sweep evaluates a function of time over [lo, hi) at the given change points and merges neighbours with the same
// holder into runs.
func sweep(lo, hi time.Time, points []time.Time, at func(time.Time) slot) []stretch {
	points = append(points, lo)
	sort.Slice(points, func(i, j int) bool { return points[i].Before(points[j]) })
	var runs []stretch
	for i, point := range points {
		if !periodHolds(lo, hi, point) || (i > 0 && point.Equal(points[i-1])) {
			continue
		}
		next := at(point)
		if n := len(runs); n > 0 && runs[n-1].sameHolder(next) {
			continue
		}
		if n := len(runs); n > 0 {
			runs[n-1].End = point
		}
		runs = append(runs, stretch{slot: next, Start: point})
	}
	if n := len(runs); n > 0 {
		runs[n-1].End = hi
	}
	return runs
}

// strictlyInside reports whether an instant is a change point of [lo, hi): after lo, before hi.
func strictlyInside(lo, hi, t time.Time) bool {
	return !instantReached(lo, t) && !instantReached(t, hi)
}

// changePoints are the instants strictly inside (lo, hi) where any part of the final schedule can change.
func (m *scheduleModel) changePoints(lo, hi time.Time) []time.Time {
	var points []time.Time
	add := func(t time.Time) {
		if strictlyInside(lo, hi, t) {
			points = append(points, t)
		}
	}
	for _, layer := range m.layers {
		layer.edges(m.loc, lo, hi, add)
	}
	for _, o := range m.overrides {
		add(o.Start)
		add(o.End)
	}
	return points
}

// finalRuns is the final schedule over [lo, hi).
func (m *scheduleModel) finalRuns(lo, hi time.Time) []stretch {
	return sweep(lo, hi, m.changePoints(lo, hi), m.slotAt)
}

// layerRuns is what one layer alone holds over [lo, hi), leaving out the stretches where it holds nobody.
func (m *scheduleModel) layerRuns(layer *layerHistory, lo, hi time.Time) []stretch {
	var points []time.Time
	layer.edges(m.loc, lo, hi, func(t time.Time) {
		if strictlyInside(lo, hi, t) {
			points = append(points, t)
		}
	})
	runs := sweep(lo, hi, points, func(t time.Time) slot { return m.layerSlotAt(layer, t) })
	return slices.DeleteFunc(runs, func(r stretch) bool { return r.source == sourceGap })
}

// settledBy is the instant after which no saved edit or first handoff can still change the pattern.
func (m *scheduleModel) settledBy() time.Time {
	var latest time.Time
	for _, layer := range m.layers {
		for _, revision := range layer.Revisions {
			latest = laterOf(latest, revision.Form.start.at(m.loc, revision.Form.handoff))
			if revision.From != nil {
				latest = laterOf(latest, *revision.From)
			}
		}
	}
	for _, o := range m.overrides {
		latest = laterOf(latest, o.End)
	}
	return latest
}

const (
	firstScanDays   = 35
	scanHorizonDays = 5 * 365
)

// holderAt is the holder at an instant and when that holder next changes (nil when it never does).
func (m *scheduleModel) holderAt(at time.Time) (slot, *time.Time) {
	current := m.slotAt(at)
	limit := laterOf(at, m.settledBy()).AddDate(0, 0, scanHorizonDays)
	width := time.Duration(firstScanDays) * 24 * time.Hour
	for lo := at; lo.Before(limit); width *= 2 {
		hi := lo.Add(width)
		for _, r := range m.finalRuns(lo, hi) {
			if r.person != current.person {
				change := r.Start
				return current, &change
			}
		}
		lo = hi
	}
	return current, nil
}

// personRef names a holder; nil when the slot is a gap.
func (m *scheduleModel) personRef(id string) *personRef {
	if id == "" {
		return nil
	}
	return &personRef{ID: id, Name: m.names[id]}
}

// loadScheduleModels reads one schedule's model, or every schedule's when the id is empty, in schedule name order.
func (a *App) loadScheduleModels(ctx context.Context, q dbq, scheduleID string) ([]*scheduleModel, error) {
	rows, err := q.Query(ctx, `select id, name, zone, record_format, upgraded_at, version from schedules
		where $1 = '' or id = $1 order by name, id`, scheduleID)
	if err != nil {
		return nil, fmt.Errorf("list schedules: %w", err)
	}
	defer rows.Close()
	var models []*scheduleModel
	byID := map[string]*scheduleModel{}
	names := map[string]string{}
	for rows.Next() {
		m := &scheduleModel{names: names}
		if err := rows.Scan(&m.ID, &m.Name, &m.Zone, &m.RecordFormat, &m.UpgradedAt, &m.Version); err != nil {
			return nil, fmt.Errorf("scan schedule: %w", err)
		}
		if m.loc, err = time.LoadLocation(m.Zone); err != nil {
			return nil, fmt.Errorf("load zone of schedule %s: %w", m.ID, err)
		}
		models = append(models, m)
		byID[m.ID] = m
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list schedules: %w", err)
	}
	rows.Close()
	if err := a.loadLayers(ctx, q, scheduleID, byID); err != nil {
		return nil, fmt.Errorf("read layers: %w", err)
	}
	if err := a.loadOverrides(ctx, q, scheduleID, byID); err != nil {
		return nil, fmt.Errorf("read overrides: %w", err)
	}
	if err := a.loadNames(ctx, q, models, names); err != nil {
		return nil, fmt.Errorf("read people: %w", err)
	}
	return models, nil
}

func (a *App) loadLayers(ctx context.Context, q dbq, scheduleID string, byID map[string]*scheduleModel) error {
	rows, err := q.Query(ctx, `select l.schedule_id, l.id, l.seq, l.version, r.revision, r.effective_from, r.name, r.ord,
		r.shift_days, r.handoff_time, r.start_date, r.people, r.restrictions
		from schedule_layers l join schedule_layer_revisions r on r.layer_id = l.id
		where $1 = '' or l.schedule_id = $1 order by l.seq, r.revision`, scheduleID)
	if err != nil {
		return fmt.Errorf("list layers: %w", err)
	}
	defer rows.Close()
	var layer *layerHistory
	for rows.Next() {
		var owner, id string
		var seq int64
		var version int
		var revision layerRevision
		var restrictions []byte
		form := &revision.Form
		if err := rows.Scan(&owner, &id, &seq, &version, &revision.Number, &revision.From, &form.Name, &form.Order,
			&form.ShiftDays, &form.HandoffTime, &form.StartDate, &form.People, &restrictions); err != nil {
			return fmt.Errorf("scan layer: %w", err)
		}
		if err := json.Unmarshal(restrictions, &form.Restrictions); err != nil {
			return fmt.Errorf("read restrictions of layer %s: %w", id, err)
		}
		m := byID[owner]
		if m.RecordFormat == 1 {
			if err := form.fromUTC(m.loc); err != nil {
				return fmt.Errorf("read older layer %s: %w", id, err)
			}
		}
		if err := form.compile(); err != nil {
			return fmt.Errorf("read layer %s: %w", id, err)
		}
		if layer == nil || layer.ID != id {
			layer = &layerHistory{ID: id, Seq: seq, Version: version}
			m.layers = append(m.layers, layer)
		}
		layer.Revisions = append(layer.Revisions, revision)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("list layers: %w", err)
	}
	return nil
}

func (a *App) loadOverrides(ctx context.Context, q dbq, scheduleID string, byID map[string]*scheduleModel) error {
	rows, err := q.Query(ctx, `select schedule_id, id, person_id, starts_at, ends_at from schedule_overrides
		where $1 = '' or schedule_id = $1 order by starts_at, id`, scheduleID)
	if err != nil {
		return fmt.Errorf("list overrides: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var owner string
		var o overrideRow
		if err := rows.Scan(&owner, &o.ID, &o.PersonID, &o.Start, &o.End); err != nil {
			return fmt.Errorf("scan override: %w", err)
		}
		o.Start, o.End = o.Start.UTC(), o.End.UTC()
		byID[owner].overrides = append(byID[owner].overrides, o)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("list overrides: %w", err)
	}
	return nil
}

// loadNames fills the shared name map for every person the models mention.
func (a *App) loadNames(ctx context.Context, q dbq, models []*scheduleModel, names map[string]string) error {
	var ids []string
	for _, m := range models {
		for _, layer := range m.layers {
			for _, revision := range layer.Revisions {
				ids = append(ids, revision.Form.People...)
			}
		}
		for _, o := range m.overrides {
			if o.PersonID != nil {
				ids = append(ids, *o.PersonID)
			}
		}
	}
	rows, err := q.Query(ctx, `select id, name from users where id = any($1)`, ids)
	if err != nil {
		return fmt.Errorf("read names: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return fmt.Errorf("scan name: %w", err)
		}
		names[id] = name
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read names: %w", err)
	}
	return nil
}

// loadScheduleModel reads one schedule; an unknown id is the 404.
func (a *App) loadScheduleModel(ctx context.Context, q dbq, scheduleID string) (*scheduleModel, error) {
	models, err := a.loadScheduleModels(ctx, q, scheduleID)
	if err != nil {
		return nil, fmt.Errorf("read schedule %s: %w", scheduleID, err)
	}
	if len(models) == 0 {
		return nil, errNotFound()
	}
	return models[0], nil
}

// scheduleHolderAt is who is on call on a schedule at an instant (nil in a gap) and when that answer next changes
// (nil when it never does).
func (a *App) scheduleHolderAt(ctx context.Context, q dbq, scheduleID string, at time.Time) (*personRef, *time.Time, error) {
	m, err := a.loadScheduleModel(ctx, q, scheduleID)
	if err != nil {
		return nil, nil, fmt.Errorf("read schedule %s: %w", scheduleID, err)
	}
	holder, until := m.holderAt(at)
	return m.personRef(holder.person), until, nil
}

// personShifts lists the final-schedule shifts a person holds between two instants, across schedules, in schedule-name
// then start order. A shift is one unbroken stretch, whatever sources it comes from.
func (a *App) personShifts(ctx context.Context, q dbq, userID string, from, to time.Time) ([]shiftRef, error) {
	models, err := a.loadScheduleModels(ctx, q, "")
	if err != nil {
		return nil, fmt.Errorf("read schedules: %w", err)
	}
	var shifts []shiftRef
	for _, m := range models {
		open := -1
		for _, r := range m.finalRuns(from, to) {
			switch {
			case r.person != userID:
				open = -1
			case open >= 0:
				shifts[open].End = r.End
			default:
				shifts = append(shifts, shiftRef{Schedule: m.Name, Start: r.Start, End: r.End})
				open = len(shifts) - 1
			}
		}
	}
	return shifts, nil
}
