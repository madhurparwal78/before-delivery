package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type PersonRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Restriction struct {
	Days  []string `json:"days"`
	Start string   `json:"start"`
	End   string   `json:"end"`
}

type LayerConfig struct {
	ShiftDays    int           `json:"shift_days"`
	HandoffTime  string        `json:"handoff_time"`
	StartDate    string        `json:"start_date"`
	People       []string      `json:"people"`
	Restrictions []Restriction `json:"restrictions"`
}

type layerVersion struct {
	id     string
	fromAt time.Time
	toAt   *time.Time
	config LayerConfig
}

type Layer struct {
	ID       string      `json:"id"`
	Name     string      `json:"name"`
	Order    int         `json:"order"`
	Version  int         `json:"version"`
	Config   LayerConfig `json:"-"`
	versions []layerVersion
}

// MarshalJSON writes a layer with its present form flattened in.
func (l Layer) MarshalJSON() ([]byte, error) {
	return json.Marshal(map[string]any{
		"id": l.ID, "name": l.Name, "order": l.Order, "version": l.Version,
		"shift_days": l.Config.ShiftDays, "handoff_time": l.Config.HandoffTime,
		"start_date": l.Config.StartDate, "people": l.Config.People,
		"restrictions": l.Config.Restrictions,
	})
}

type Schedule struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	Zone         string     `json:"zone"`
	RecordFormat int        `json:"record_format"`
	UpgradedAt   *time.Time `json:"upgraded_at"`
	Version      int        `json:"version"`
	Layers       []Layer    `json:"layers"`
}

type Override struct {
	ID        string     `json:"id"`
	PersonID  *string    `json:"-"`
	Person    *PersonRef `json:"person"`
	Start     time.Time  `json:"start"`
	End       time.Time  `json:"end"`
	CreatedAt time.Time  `json:"-"`
}

type Block struct {
	Start      time.Time  `json:"start"`
	End        time.Time  `json:"end"`
	Minutes    int        `json:"minutes"`
	Person     *PersonRef `json:"person"`
	Gap        bool       `json:"gap"`
	Source     string     `json:"source"`
	LayerID    *string    `json:"layer_id"`
	OverrideID *string    `json:"override_id"`
}

type DayBand struct {
	Date    string    `json:"date"`
	Start   time.Time `json:"start"`
	End     time.Time `json:"end"`
	Minutes int       `json:"minutes"`
}

type LayerBlocks struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Order  int     `json:"order"`
	Blocks []Block `json:"blocks"`
}

type Final struct {
	Zone   string        `json:"zone"`
	From   time.Time     `json:"from"`
	To     time.Time     `json:"to"`
	Blocks []Block       `json:"blocks"`
	Days   []DayBand     `json:"days"`
	Layers []LayerBlocks `json:"layers"`
}

func (a *App) ListSchedules(ctx context.Context) ([]*Schedule, error) {
	rows, err := a.pool.Query(ctx, `SELECT id, name, zone, record_format, upgraded_at, version FROM schedules ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("list schedules: %w", err)
	}
	defer rows.Close()
	var out []*Schedule
	for rows.Next() {
		var s Schedule
		if err := rows.Scan(&s.ID, &s.Name, &s.Zone, &s.RecordFormat, &s.UpgradedAt, &s.Version); err != nil {
			return nil, fmt.Errorf("read schedule: %w", err)
		}
		out = append(out, &s)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, s := range out {
		if err := a.loadLayers(ctx, s); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (a *App) GetSchedule(ctx context.Context, id string) (*Schedule, error) {
	var s Schedule
	err := a.pool.QueryRow(ctx, `SELECT id, name, zone, record_format, upgraded_at, version FROM schedules WHERE id=$1`, id).
		Scan(&s.ID, &s.Name, &s.Zone, &s.RecordFormat, &s.UpgradedAt, &s.Version)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read schedule: %w", err)
	}
	if err := a.loadLayers(ctx, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

func (a *App) loadLayers(ctx context.Context, s *Schedule) error {
	rows, err := a.pool.Query(ctx, `SELECT l.id, l.name, l.ord, l.version, v.id, v.from_at, v.to_at,
		v.shift_days, v.handoff_time, v.start_date, v.people, v.restrictions
		FROM layers l JOIN layer_versions v ON v.layer_id = l.id
		WHERE l.schedule_id=$1 ORDER BY l.ord, l.created_at, v.from_at`, s.ID)
	if err != nil {
		return fmt.Errorf("read layers: %w", err)
	}
	defer rows.Close()
	byID := map[string]*Layer{}
	var order []string
	loc := zoneOr(s.Zone)
	for rows.Next() {
		var layerID, name, versionID, handoff, startDate string
		var ord, version, shiftDays int
		var fromAt time.Time
		var toAt *time.Time
		var people, restrictions []byte
		if err := rows.Scan(&layerID, &name, &ord, &version, &versionID, &fromAt, &toAt,
			&shiftDays, &handoff, &startDate, &people, &restrictions); err != nil {
			return fmt.Errorf("read layer: %w", err)
		}
		cfg := LayerConfig{ShiftDays: shiftDays, HandoffTime: handoff, StartDate: startDate, Restrictions: []Restriction{}}
		if err := json.Unmarshal(people, &cfg.People); err != nil {
			return fmt.Errorf("read layer people: %w", err)
		}
		if err := json.Unmarshal(restrictions, &cfg.Restrictions); err != nil {
			return fmt.Errorf("read layer restrictions: %w", err)
		}
		if s.RecordFormat == 1 {
			cfg.HandoffTime = localHandoffFromUTC(loc, cfg.StartDate, cfg.HandoffTime)
		}
		l, ok := byID[layerID]
		if !ok {
			l = &Layer{ID: layerID, Name: name, Order: ord, Version: version}
			byID[layerID] = l
			order = append(order, layerID)
		}
		l.versions = append(l.versions, layerVersion{id: versionID, fromAt: fromAt.UTC(), toAt: toAt, config: cfg})
		l.Config = cfg
	}
	if err := rows.Err(); err != nil {
		return err
	}
	s.Layers = nil
	for _, id := range order {
		s.Layers = append(s.Layers, *byID[id])
	}
	return nil
}

// localHandoffFromUTC reads an older record's UTC handoff as the local time it
// names, so a read before the upgrade answers the same blocks as after it.
func localHandoffFromUTC(loc *time.Location, startDate, utcHandoff string) string {
	date, ok := parseDate(startDate)
	if !ok {
		return utcHandoff
	}
	h, m, ok := parseHHMM(utcHandoff)
	if !ok {
		return utcHandoff
	}
	instant := time.Date(date.year, date.month, date.day, h, m, 0, 0, time.UTC)
	return instant.In(loc).Format("15:04")
}

func (v layerVersion) activeAt(t time.Time) bool {
	if t.Before(v.fromAt) {
		return false
	}
	return v.toAt == nil || t.Before(*v.toAt)
}

func (l Layer) versionAt(t time.Time) (LayerConfig, bool) {
	for i := len(l.versions) - 1; i >= 0; i-- {
		if l.versions[i].activeAt(t) {
			return l.versions[i].config, true
		}
	}
	return LayerConfig{}, false
}

type handoff struct {
	at    time.Time
	index int
}

// handoffs lists a layer form's handoff instants that matter for a range,
// counting local-date shifts from its start date at its handoff time.
func handoffsFor(cfg LayerConfig, loc *time.Location, from, to time.Time) []handoff {
	start, ok := parseDate(cfg.StartDate)
	if !ok || cfg.ShiftDays <= 0 || len(cfg.People) == 0 {
		return nil
	}
	h, m, ok := parseHHMM(cfg.HandoffTime)
	if !ok {
		return nil
	}
	fromDate := wallOf(from, loc)
	steps := daysBetween(start, fromDate) / cfg.ShiftDays
	k := steps - 2
	if k < 0 {
		k = 0
	}
	var out []handoff
	for i := 0; i < 4000; i++ {
		date := start.addDays(k * cfg.ShiftDays)
		at := resolveWall(loc, date.withTime(h, m))
		if at.After(to) {
			break
		}
		out = append(out, handoff{at: at, index: k})
		k++
	}
	return out
}

type window struct{ start, end time.Time }

// restrictionWindows lists the local windows a layer form is limited to.
func restrictionWindows(cfg LayerConfig, loc *time.Location, from, to time.Time) []window {
	if len(cfg.Restrictions) == 0 {
		return nil
	}
	dayIndex := map[string]time.Weekday{
		"sun": time.Sunday, "mon": time.Monday, "tue": time.Tuesday, "wed": time.Wednesday,
		"thu": time.Thursday, "fri": time.Friday, "sat": time.Saturday,
	}
	var out []window
	first := wallOf(from, loc).dateOnly().addDays(-2)
	days := int(to.Sub(from)/(24*time.Hour)) + 5
	for d := 0; d <= days; d++ {
		date := first.addDays(d)
		weekday := date.utc().Weekday()
		for _, r := range cfg.Restrictions {
			match := false
			for _, name := range r.Days {
				if wd, ok := dayIndex[strings.ToLower(name)]; ok && wd == weekday {
					match = true
				}
			}
			if !match {
				continue
			}
			sh, sm, ok := parseHHMM(r.Start)
			if !ok {
				continue
			}
			eh, em, ok := parseHHMM(r.End)
			if !ok {
				continue
			}
			start := resolveWall(loc, date.withTime(sh, sm))
			var end time.Time
			if eh == 24 || (eh*60+em) <= (sh*60+sm) {
				next := date.addDays(1)
				if eh == 24 {
					end = resolveWall(loc, next.withTime(0, 0))
				} else {
					end = resolveWall(loc, next.withTime(eh, em))
				}
			} else {
				end = resolveWall(loc, date.withTime(eh, em))
			}
			if end.After(from) && start.Before(to) {
				out = append(out, window{start: start, end: end})
			}
		}
	}
	return out
}

func inWindows(windows []window, t time.Time) bool {
	for _, w := range windows {
		if !t.Before(w.start) && t.Before(w.end) {
			return true
		}
	}
	return false
}

// FinalSchedule computes the one person, or flagged gap, at every moment of a
// range: the lowest layer first, each higher layer replacing it, overrides
// above all.
func (a *App) FinalSchedule(ctx context.Context, scheduleID string, from, to time.Time, zone string) (*Final, error) {
	s, err := a.GetSchedule(ctx, scheduleID)
	if err != nil {
		return nil, err
	}
	overrides, err := a.listOverrides(ctx, scheduleID, from, to)
	if err != nil {
		return nil, err
	}
	names, err := a.personNames(ctx)
	if err != nil {
		return nil, err
	}
	viewZone := zone
	if viewZone == "" {
		viewZone = s.Zone
	}
	loc := zoneOr(s.Zone)
	viewLoc := zoneOr(viewZone)

	type layerPlan struct {
		layer    Layer
		cuts     []time.Time
		holderAt func(t time.Time) (string, bool)
	}
	var plans []layerPlan
	boundaries := map[int64]struct{}{}
	mark := func(t time.Time) {
		if !t.Before(from) && !t.After(to) {
			boundaries[t.Unix()] = struct{}{}
		}
	}
	mark(from)
	mark(to)

	for _, l := range s.Layers {
		layer := l
		for _, v := range layer.versions {
			mark(v.fromAt)
			if v.toAt != nil {
				mark(*v.toAt)
			}
			cfg := v.config
			versionFrom, versionTo := v.fromAt, to
			if v.toAt != nil && v.toAt.Before(to) {
				versionTo = *v.toAt
			}
			if versionFrom.Before(from) {
				versionFrom = from
			}
			if !versionFrom.Before(versionTo) {
				continue
			}
			for _, h := range handoffsFor(cfg, loc, versionFrom.Add(-72*time.Hour), versionTo) {
				mark(h.at)
			}
			for _, w := range restrictionWindows(cfg, loc, versionFrom, versionTo) {
				mark(w.start)
				mark(w.end)
			}
		}
		plans = append(plans, layerPlan{layer: layer, holderAt: func(t time.Time) (string, bool) {
			cfg, ok := layer.versionAt(t)
			if !ok {
				return "", false
			}
			hs := handoffsFor(cfg, loc, t.Add(-72*time.Hour), t)
			var current *handoff
			for i := range hs {
				if !hs[i].at.After(t) {
					h := hs[i]
					current = &h
				}
			}
			if current == nil {
				return "", false
			}
			if len(cfg.Restrictions) > 0 {
				windows := restrictionWindows(cfg, loc, t.Add(-48*time.Hour), t.Add(48*time.Hour))
				if !inWindows(windows, t) {
					return "", false
				}
			}
			return cfg.People[((current.index%len(cfg.People))+len(cfg.People))%len(cfg.People)], true
		}})
	}
	for _, o := range overrides {
		mark(o.Start)
		mark(o.End)
	}

	cuts := make([]time.Time, 0, len(boundaries))
	for unix := range boundaries {
		cuts = append(cuts, time.Unix(unix, 0).UTC())
	}
	sort.Slice(cuts, func(i, j int) bool { return cuts[i].Before(cuts[j]) })

	final := &Final{Zone: viewZone, From: from, To: to, Blocks: []Block{}, Days: []DayBand{}, Layers: []LayerBlocks{}}
	var raw []Block
	for i := 0; i+1 < len(cuts); i++ {
		start, end := cuts[i], cuts[i+1]
		if !start.Before(end) {
			continue
		}
		block := Block{Start: start, End: end, Gap: true, Source: "gap"}
		for _, plan := range plans {
			if personID, ok := plan.holderAt(start); ok {
				id := plan.layer.ID
				block = Block{Start: start, End: end, Source: "layer", LayerID: &id,
					Person: &PersonRef{ID: personID, Name: names[personID]}}
			}
		}
		for _, o := range overrides {
			if !start.Before(o.Start) && start.Before(o.End) {
				id := o.ID
				block = Block{Start: start, End: end, Source: "override", OverrideID: &id}
				if o.PersonID != nil {
					block.Person = &PersonRef{ID: *o.PersonID, Name: names[*o.PersonID]}
				} else {
					block.Gap = true
				}
			}
		}
		if block.Person == nil {
			block.Gap = true
			if block.Source == "layer" {
				block.Source = "gap"
				block.LayerID = nil
			}
		}
		raw = append(raw, block)
	}
	final.Blocks = mergeBlocks(raw)

	for _, plan := range plans {
		var layerRaw []Block
		for i := 0; i+1 < len(cuts); i++ {
			start, end := cuts[i], cuts[i+1]
			if !start.Before(end) {
				continue
			}
			if personID, ok := plan.holderAt(start); ok {
				id := plan.layer.ID
				layerRaw = append(layerRaw, Block{Start: start, End: end, Source: "layer", LayerID: &id,
					Person: &PersonRef{ID: personID, Name: names[personID]}})
			}
		}
		final.Layers = append(final.Layers, LayerBlocks{ID: plan.layer.ID, Name: plan.layer.Name,
			Order: plan.layer.Order, Blocks: mergeBlocks(layerRaw)})
	}

	// Day bands in the viewed zone, so a 23-hour or 25-hour day reads to scale.
	dayStart := wallOf(from, viewLoc).dateOnly()
	for d := 0; d < 40; d++ {
		date := dayStart.addDays(d)
		start := resolveWall(viewLoc, date)
		end := resolveWall(viewLoc, date.addDays(1))
		if !end.After(from) {
			continue
		}
		if !start.Before(to) {
			break
		}
		clipStart, clipEnd := start, end
		if clipStart.Before(from) {
			clipStart = from
		}
		if clipEnd.After(to) {
			clipEnd = to
		}
		final.Days = append(final.Days, DayBand{
			Date:    fmt.Sprintf("%04d-%02d-%02d", date.year, int(date.month), date.day),
			Start:   clipStart,
			End:     clipEnd,
			Minutes: int(end.Sub(start) / time.Minute),
		})
	}
	return final, nil
}

func mergeBlocks(in []Block) []Block {
	out := []Block{}
	for _, b := range in {
		if len(out) > 0 {
			last := &out[len(out)-1]
			samePerson := (last.Person == nil && b.Person == nil) ||
				(last.Person != nil && b.Person != nil && last.Person.ID == b.Person.ID)
			sameSource := last.Source == b.Source && sameRef(last.LayerID, b.LayerID) && sameRef(last.OverrideID, b.OverrideID)
			if samePerson && sameSource && last.End.Equal(b.Start) {
				last.End = b.End
				last.Minutes = int(last.End.Sub(last.Start) / time.Minute)
				continue
			}
		}
		b.Minutes = int(b.End.Sub(b.Start) / time.Minute)
		out = append(out, b)
	}
	return out
}

func sameRef(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func (a *App) personNames(ctx context.Context) (map[string]string, error) {
	rows, err := a.pool.Query(ctx, `SELECT id, name FROM users`)
	if err != nil {
		return nil, fmt.Errorf("read names: %w", err)
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, fmt.Errorf("read name: %w", err)
		}
		out[id] = name
	}
	return out, rows.Err()
}

func (a *App) listOverrides(ctx context.Context, scheduleID string, from, to time.Time) ([]Override, error) {
	rows, err := a.pool.Query(ctx, `SELECT id, person_id, starts_at, ends_at, created_at FROM overrides
		WHERE schedule_id=$1 AND ends_at > $2 AND starts_at < $3 ORDER BY starts_at`, scheduleID, from, to)
	if err != nil {
		return nil, fmt.Errorf("list overrides: %w", err)
	}
	defer rows.Close()
	out := []Override{}
	for rows.Next() {
		var o Override
		if err := rows.Scan(&o.ID, &o.PersonID, &o.Start, &o.End, &o.CreatedAt); err != nil {
			return nil, fmt.Errorf("read override: %w", err)
		}
		o.Start, o.End = o.Start.UTC(), o.End.UTC()
		out = append(out, o)
	}
	return out, rows.Err()
}

// OnCall answers who holds a schedule at a moment, and until when.
type OnCall struct {
	Schedule PersonRef  `json:"schedule"`
	At       time.Time  `json:"at"`
	Holder   *PersonRef `json:"holder"`
	Gap      bool       `json:"gap"`
	Until    *time.Time `json:"until"`
}

func (a *App) OnCall(ctx context.Context, scheduleID string, at time.Time) (*OnCall, error) {
	s, err := a.GetSchedule(ctx, scheduleID)
	if err != nil {
		return nil, err
	}
	final, err := a.FinalSchedule(ctx, scheduleID, at, at.AddDate(0, 0, 35), s.Zone)
	if err != nil {
		return nil, err
	}
	out := &OnCall{Schedule: PersonRef{ID: s.ID, Name: s.Name}, At: at, Gap: true}
	for _, b := range final.Blocks {
		if !at.Before(b.Start) && at.Before(b.End) {
			end := b.End
			out.Until = &end
			if b.Person != nil {
				out.Holder = b.Person
				out.Gap = false
			}
			break
		}
	}
	return out, nil
}

// holderIDsForSchedule answers the people a schedule target resolves to at a
// moment: one person, or nobody.
func (a *App) holderIDsForSchedule(ctx context.Context, scheduleID string, at time.Time) ([]string, error) {
	oncall, err := a.OnCall(ctx, scheduleID, at)
	if err != nil {
		return nil, err
	}
	if oncall.Holder == nil {
		return nil, nil
	}
	return []string{oncall.Holder.ID}, nil
}

// CutResult is the running result of a Handoff Cut before it is released.
type CutResult struct {
	Losses     []CutLoss   `json:"losses"`
	GapMinutes int         `json:"gap_minutes"`
	Overlap    *CutOverlap `json:"overlap"`
	Summary    string      `json:"summary"`
}

type CutLoss struct {
	Person  string    `json:"person"`
	Minutes int       `json:"minutes"`
	From    time.Time `json:"from"`
	To      time.Time `json:"to"`
}

type CutOverlap struct {
	Person string    `json:"person"`
	Start  time.Time `json:"start"`
	End    time.Time `json:"end"`
}

// PreviewCut measures who loses time, the gap inside the cut and any overlap.
func (a *App) PreviewCut(ctx context.Context, scheduleID string, personID *string, start, end time.Time) (*CutResult, error) {
	s, err := a.GetSchedule(ctx, scheduleID)
	if err != nil {
		return nil, err
	}
	final, err := a.FinalSchedule(ctx, scheduleID, start, end, s.Zone)
	if err != nil {
		return nil, err
	}
	names, err := a.personNames(ctx)
	if err != nil {
		return nil, err
	}
	result := &CutResult{Losses: []CutLoss{}}
	gap := 0
	order := []string{}
	byPerson := map[string]*CutLoss{}
	for _, b := range final.Blocks {
		from, to := b.Start, b.End
		if from.Before(start) {
			from = start
		}
		if to.After(end) {
			to = end
		}
		if !from.Before(to) {
			continue
		}
		minutes := int(to.Sub(from) / time.Minute)
		if b.Person == nil {
			continue
		}
		if personID != nil && b.Person.ID == *personID {
			continue
		}
		if loss, ok := byPerson[b.Person.ID]; ok {
			loss.Minutes += minutes
			loss.To = to
		} else {
			byPerson[b.Person.ID] = &CutLoss{Person: b.Person.Name, Minutes: minutes, From: from, To: to}
			order = append(order, b.Person.ID)
		}
	}
	for _, id := range order {
		result.Losses = append(result.Losses, *byPerson[id])
	}
	if personID == nil {
		gap = int(end.Sub(start) / time.Minute)
	}
	result.GapMinutes = gap

	overrides, err := a.listOverrides(ctx, scheduleID, start, end)
	if err != nil {
		return nil, err
	}
	if len(overrides) > 0 {
		o := overrides[0]
		name := "Nobody"
		if o.PersonID != nil {
			name = names[*o.PersonID]
		}
		result.Overlap = &CutOverlap{Person: name, Start: o.Start, End: o.End}
	}
	result.Summary = cutSummary(result)
	return result, nil
}

// cutSummary is the one published preview sentence.
func cutSummary(r *CutResult) string {
	var parts []string
	if len(r.Losses) == 0 {
		parts = append(parts, "Nobody loses time")
	} else {
		var phrases []string
		for _, l := range r.Losses {
			phrases = append(phrases, fmt.Sprintf("%s loses %d minutes", l.Person, l.Minutes))
		}
		parts = append(parts, strings.Join(phrases, ", "))
	}
	if r.GapMinutes == 0 {
		parts = append(parts, "no gap")
	} else {
		parts = append(parts, fmt.Sprintf("gap of %d minutes", r.GapMinutes))
	}
	if r.Overlap == nil {
		parts = append(parts, "no overlap")
	} else {
		parts = append(parts, fmt.Sprintf("overlaps %s's override", r.Overlap.Person))
	}
	return strings.Join(parts, "; ") + "."
}

// CreateOverride saves a cut, refusing one that overlaps another override.
func (a *App) CreateOverride(ctx context.Context, scheduleID string, personID *string, start, end time.Time) (*Override, error) {
	a.Lock()
	defer a.Unlock()
	s, err := a.GetSchedule(ctx, scheduleID)
	if err != nil {
		return nil, err
	}
	now := a.Clock.Now()
	if start.Second() != 0 || start.Minute()%15 != 0 {
		// A start inside the current 15-minute step is clipped to the present.
		step := now.Truncate(time.Minute)
		step = step.Add(-time.Duration(step.Minute()%15) * time.Minute)
		if start.Equal(step) || (start.After(step) && start.Before(step.Add(15*time.Minute))) {
			start = now
		} else {
			return nil, errFields("start", "Overrides start and end on a 15-minute step.")
		}
	}
	if start.Before(now) {
		step := now.Truncate(time.Minute)
		step = step.Add(-time.Duration(step.Minute()%15) * time.Minute)
		if !start.Before(step) {
			start = now
		} else {
			return nil, errFields("start", "Overrides cannot change the past.")
		}
	}
	if end.Second() != 0 || end.Minute()%15 != 0 {
		return nil, errFields("end", "Overrides start and end on a 15-minute step.")
	}
	if !end.After(start) {
		return nil, errFields("end", "An override must end after it starts.")
	}
	if end.Sub(start) > 14*24*time.Hour {
		return nil, errFields("end", "An override lasts at most 14 days.")
	}
	existing, err := a.listOverrides(ctx, scheduleID, start, end)
	if err != nil {
		return nil, err
	}
	if len(existing) > 0 {
		names, err := a.personNames(ctx)
		if err != nil {
			return nil, err
		}
		o := existing[0]
		name := "Nobody"
		if o.PersonID != nil {
			name = names[*o.PersonID]
		}
		loc := zoneOr(s.Zone)
		message := fmt.Sprintf("Cut refused: %s already has an override from %s to %s.",
			name, LocalTime(o.Start, loc), LocalTime(o.End, loc))
		return nil, &APIError{Status: 409, Body: map[string]any{
			"error": "override_overlap", "message": message,
			"overlaps": map[string]any{"person": name, "start": o.Start, "end": o.End},
		}}
	}
	id := newID()
	if _, err := a.pool.Exec(ctx, `INSERT INTO overrides (id, schedule_id, person_id, starts_at, ends_at, created_at)
		VALUES ($1,$2,$3,$4,$5,$6)`, id, scheduleID, personID, start, end, now); err != nil {
		return nil, fmt.Errorf("save override: %w", err)
	}
	names, err := a.personNames(ctx)
	if err != nil {
		return nil, err
	}
	out := &Override{ID: id, PersonID: personID, Start: start, End: end}
	if personID != nil {
		out.Person = &PersonRef{ID: *personID, Name: names[*personID]}
	}
	a.clearOncallCache(ctx)
	if err := a.applyHandoffs(ctx); err != nil {
		return nil, err
	}
	a.publishSchedule(ctx, scheduleID)
	return out, nil
}

func (a *App) DeleteOverride(ctx context.Context, scheduleID, overrideID string) error {
	var start time.Time
	err := a.pool.QueryRow(ctx, `SELECT starts_at FROM overrides WHERE id=$1 AND schedule_id=$2`, overrideID, scheduleID).Scan(&start)
	if errors.Is(err, pgx.ErrNoRows) {
		return errNotFound
	}
	if err != nil {
		return fmt.Errorf("read override: %w", err)
	}
	if !start.After(a.Clock.Now()) {
		return errCode(409, "override_started")
	}
	if _, err := a.pool.Exec(ctx, `DELETE FROM overrides WHERE id=$1`, overrideID); err != nil {
		return fmt.Errorf("remove override: %w", err)
	}
	a.clearOncallCache(ctx)
	a.publishSchedule(ctx, scheduleID)
	return nil
}

func (a *App) CreateSchedule(ctx context.Context, name, zone string) (*Schedule, error) {
	if strings.TrimSpace(name) == "" {
		return nil, errFields("name", "Enter a name.")
	}
	if _, err := time.LoadLocation(zone); err != nil {
		return nil, errFields("zone", "Choose a listed time zone.")
	}
	id := newID()
	if _, err := a.pool.Exec(ctx, `INSERT INTO schedules (id, name, zone, record_format, version, created_at)
		VALUES ($1,$2,$3,2,1,$4)`, id, name, zone, a.Clock.Now()); err != nil {
		return nil, fmt.Errorf("create schedule: %w", err)
	}
	return a.GetSchedule(ctx, id)
}

func validateLayerConfig(cfg LayerConfig) error {
	errs := map[string]string{}
	if cfg.ShiftDays < 1 || cfg.ShiftDays > 28 {
		errs["shift_days"] = "Use 1 to 28 days."
	}
	if _, _, ok := parseHHMM(cfg.HandoffTime); !ok {
		errs["handoff_time"] = "Use the format HH:MM."
	}
	if _, ok := parseDate(cfg.StartDate); !ok {
		errs["start_date"] = "Use the format YYYY-MM-DD."
	}
	if len(cfg.People) == 0 {
		errs["people"] = "Choose at least one person."
	}
	if len(errs) > 0 {
		return errFieldMap(errs)
	}
	return nil
}

func (a *App) AddLayer(ctx context.Context, scheduleID, name string, order int, cfg LayerConfig) (*Schedule, error) {
	if err := validateLayerConfig(cfg); err != nil {
		return nil, err
	}
	if _, err := a.GetSchedule(ctx, scheduleID); err != nil {
		return nil, err
	}
	now := a.Clock.Now()
	layerID := newID()
	if _, err := a.pool.Exec(ctx, `INSERT INTO layers (id, schedule_id, name, ord, version, created_at)
		VALUES ($1,$2,$3,$4,1,$5)`, layerID, scheduleID, name, order, now); err != nil {
		return nil, fmt.Errorf("add layer: %w", err)
	}
	if err := a.insertLayerVersion(ctx, layerID, cfg, now); err != nil {
		return nil, err
	}
	a.clearOncallCache(ctx)
	a.publishSchedule(ctx, scheduleID)
	return a.GetSchedule(ctx, scheduleID)
}

// UpdateLayer saves a new form of a layer from the second it is saved, so past
// blocks never move.
func (a *App) UpdateLayer(ctx context.Context, scheduleID, layerID, name string, order int, cfg LayerConfig, ifMatch int) (*Schedule, error) {
	if err := validateLayerConfig(cfg); err != nil {
		return nil, err
	}
	a.Lock()
	defer a.Unlock()
	var version int
	err := a.pool.QueryRow(ctx, `SELECT version FROM layers WHERE id=$1 AND schedule_id=$2`, layerID, scheduleID).Scan(&version)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read layer: %w", err)
	}
	if ifMatch != version {
		return nil, &APIError{Status: 412, Body: map[string]any{"error": "version_conflict", "current": map[string]any{"version": version}}}
	}
	now := a.Clock.Now()
	if _, err := a.pool.Exec(ctx, `UPDATE layer_versions SET to_at=$1 WHERE layer_id=$2 AND to_at IS NULL`, now, layerID); err != nil {
		return nil, fmt.Errorf("close layer version: %w", err)
	}
	if _, err := a.pool.Exec(ctx, `UPDATE layers SET name=$1, ord=$2, version=version+1 WHERE id=$3`, name, order, layerID); err != nil {
		return nil, fmt.Errorf("save layer: %w", err)
	}
	if err := a.insertLayerVersion(ctx, layerID, cfg, now); err != nil {
		return nil, err
	}
	a.clearOncallCache(ctx)
	if err := a.applyHandoffs(ctx); err != nil {
		return nil, err
	}
	a.publishSchedule(ctx, scheduleID)
	return a.GetSchedule(ctx, scheduleID)
}

func (a *App) insertLayerVersion(ctx context.Context, layerID string, cfg LayerConfig, from time.Time) error {
	people, err := json.Marshal(cfg.People)
	if err != nil {
		return fmt.Errorf("write layer people: %w", err)
	}
	if cfg.Restrictions == nil {
		cfg.Restrictions = []Restriction{}
	}
	restrictions, err := json.Marshal(cfg.Restrictions)
	if err != nil {
		return fmt.Errorf("write layer restrictions: %w", err)
	}
	if _, err := a.pool.Exec(ctx, `INSERT INTO layer_versions (id, layer_id, from_at, to_at, shift_days,
		handoff_time, start_date, people, restrictions) VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8)`,
		newID(), layerID, from, cfg.ShiftDays, cfg.HandoffTime, cfg.StartDate, people, restrictions); err != nil {
		return fmt.Errorf("save layer version: %w", err)
	}
	return nil
}

// upgradeSchedules rewrites older schedule records once, without blocking reads.
func (a *App) upgradeSchedules(ctx context.Context) {
	rows, err := a.pool.Query(ctx, `SELECT id, zone FROM schedules WHERE record_format = 1`)
	if err != nil {
		return
	}
	type pending struct{ id, zone string }
	var todo []pending
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.id, &p.zone); err == nil {
			todo = append(todo, p)
		}
	}
	rows.Close()
	upgraded := 0
	for _, p := range todo {
		loc := zoneOr(p.zone)
		versions, err := a.pool.Query(ctx, `SELECT v.id, v.handoff_time, v.start_date FROM layer_versions v
			JOIN layers l ON l.id = v.layer_id WHERE l.schedule_id=$1`, p.id)
		if err != nil {
			continue
		}
		type conv struct{ id, local string }
		var changes []conv
		for versions.Next() {
			var id, handoff, startDate string
			if err := versions.Scan(&id, &handoff, &startDate); err == nil {
				changes = append(changes, conv{id: id, local: localHandoffFromUTC(loc, startDate, handoff)})
			}
		}
		versions.Close()
		for _, c := range changes {
			if _, err := a.pool.Exec(ctx, `UPDATE layer_versions SET handoff_time=$1 WHERE id=$2`, c.local, c.id); err != nil {
				continue
			}
		}
		if _, err := a.pool.Exec(ctx, `UPDATE schedules SET record_format=2, upgraded_at=$1 WHERE id=$2 AND record_format=1`,
			a.Clock.Now(), p.id); err == nil {
			upgraded++
		}
	}
	finished := a.Clock.Now()
	a.upgrade.Store(scheduleUpgradeState{State: "done", Upgraded: upgraded, FinishedAt: &finished})
}

// CalendarFeed writes one event per final-schedule shift of its owner.
func (a *App) CalendarFeed(ctx context.Context, token string) (string, error) {
	var userID string
	var expires time.Time
	err := a.pool.QueryRow(ctx, `SELECT user_id, expires_at FROM calendar_tokens WHERE token=$1`, token).Scan(&userID, &expires)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", errNotFound
	}
	if err != nil {
		return "", fmt.Errorf("read calendar token: %w", err)
	}
	now := a.Clock.Now()
	if !now.Before(expires) {
		return "", errCode(410, "expired")
	}
	schedules, err := a.ListSchedules(ctx)
	if err != nil {
		return "", err
	}
	from := now.AddDate(0, 0, -14)
	to := now.AddDate(0, 0, 60)
	var b strings.Builder
	b.WriteString("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Switchlamp//Shifts//EN\r\n")
	for _, s := range schedules {
		final, err := a.FinalSchedule(ctx, s.ID, from, to, s.Zone)
		if err != nil {
			return "", err
		}
		for _, block := range final.Blocks {
			if block.Person == nil || block.Person.ID != userID {
				continue
			}
			b.WriteString("BEGIN:VEVENT\r\n")
			fmt.Fprintf(&b, "UID:%s-%d@switchlamp\r\n", s.ID, block.Start.Unix())
			fmt.Fprintf(&b, "DTSTAMP:%s\r\n", now.Format("20060102T150405Z"))
			fmt.Fprintf(&b, "DTSTART:%s\r\n", block.Start.Format("20060102T150405Z"))
			fmt.Fprintf(&b, "DTEND:%s\r\n", block.End.Format("20060102T150405Z"))
			fmt.Fprintf(&b, "SUMMARY:On call: %s\r\n", s.Name)
			b.WriteString("END:VEVENT\r\n")
		}
	}
	b.WriteString("END:VCALENDAR\r\n")
	return b.String(), nil
}

func (a *App) CreateCalendarToken(ctx context.Context, userID string) (map[string]any, error) {
	token := randomHex(24)
	now := a.Clock.Now()
	expires := now.AddDate(1, 0, 0)
	if _, err := a.pool.Exec(ctx, `INSERT INTO calendar_tokens (user_id, token, created_at, expires_at)
		VALUES ($1,$2,$3,$4) ON CONFLICT (user_id) DO UPDATE SET token=$2, created_at=$3, expires_at=$4`,
		userID, token, now, expires); err != nil {
		return nil, fmt.Errorf("create calendar token: %w", err)
	}
	return map[string]any{"url": "/calendar/" + token + ".ics", "expires_at": expires}, nil
}

func (a *App) RevokeCalendarToken(ctx context.Context, userID string) error {
	if _, err := a.pool.Exec(ctx, `DELETE FROM calendar_tokens WHERE user_id=$1`, userID); err != nil {
		return fmt.Errorf("revoke calendar token: %w", err)
	}
	return nil
}

func (a *App) CalendarTokenURL(ctx context.Context, userID string) (string, *time.Time, error) {
	var token string
	var expires time.Time
	err := a.pool.QueryRow(ctx, `SELECT token, expires_at FROM calendar_tokens WHERE user_id=$1`, userID).Scan(&token, &expires)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil, nil
	}
	if err != nil {
		return "", nil, fmt.Errorf("read calendar token: %w", err)
	}
	return "/calendar/" + token + ".ics", &expires, nil
}
