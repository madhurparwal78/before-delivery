package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"sort"
	"strings"
	"time"
)

// layerView is the published layer, in its newest form.
type layerView struct {
	ID           string            `json:"id"`
	Name         string            `json:"name"`
	Order        int               `json:"order"`
	ShiftDays    int               `json:"shift_days"`
	HandoffTime  string            `json:"handoff_time"`
	StartDate    string            `json:"start_date"`
	People       []personRef       `json:"people"`
	Restrictions []restrictionSpec `json:"restrictions"`
	Version      int               `json:"version"`
}

// scheduleView is the published schedule with its layers, lowest first.
type scheduleView struct {
	ID           string      `json:"id"`
	Name         string      `json:"name"`
	Zone         string      `json:"zone"`
	RecordFormat int         `json:"record_format"`
	UpgradedAt   *string     `json:"upgraded_at"`
	Layers       []layerView `json:"layers"`
	Version      int         `json:"version"`
}

// orderedLayers lists a schedule's layers lowest first, by their newest form's order.
func (m *scheduleModel) orderedLayers() []*layerHistory {
	layers := append([]*layerHistory(nil), m.layers...)
	sort.SliceStable(layers, func(i, j int) bool { return layers[i].current().Order < layers[j].current().Order })
	return layers
}

func (m *scheduleModel) layerView(layer *layerHistory) layerView {
	form := layer.current()
	people := make([]personRef, 0, len(form.People))
	for _, id := range form.People {
		people = append(people, personRef{ID: id, Name: m.names[id]})
	}
	restrictions := form.Restrictions
	if restrictions == nil {
		restrictions = []restrictionSpec{}
	}
	return layerView{ID: layer.ID, Name: form.Name, Order: form.Order, ShiftDays: form.ShiftDays,
		HandoffTime: form.HandoffTime, StartDate: form.StartDate, People: people, Restrictions: restrictions,
		Version: layer.Version}
}

func (m *scheduleModel) view() scheduleView {
	layers := make([]layerView, 0, len(m.layers))
	for _, layer := range m.orderedLayers() {
		layers = append(layers, m.layerView(layer))
	}
	view := scheduleView{ID: m.ID, Name: m.Name, Zone: m.Zone, RecordFormat: m.RecordFormat, Layers: layers, Version: m.Version}
	if m.UpgradedAt != nil {
		upgraded := formatInstant(*m.UpgradedAt)
		view.UpgradedAt = &upgraded
	}
	return view
}

func (a *App) hSchedules(rq *Req) error {
	models, err := a.loadScheduleModels(rq.Ctx(), a.db, "")
	if err != nil {
		return fmt.Errorf("list schedules: %w", err)
	}
	items := make([]scheduleView, 0, len(models))
	for _, m := range models {
		items = append(items, m.view())
	}
	return rq.JSON(http.StatusOK, map[string]any{"items": items})
}

func (a *App) hSchedule(rq *Req) error {
	m, err := a.loadScheduleModel(rq.Ctx(), a.db, rq.Param("id"))
	if err != nil {
		return fmt.Errorf("read schedule: %w", err)
	}
	return rq.Record(http.StatusOK, m.view(), m.Version)
}

func (a *App) hCreateSchedule(rq *Req) error {
	var body struct {
		Name string `json:"name"`
		Zone string `json:"zone"`
	}
	if err := rq.Decode(&body); err != nil {
		return fmt.Errorf("read schedule: %w", err)
	}
	problems := map[string]string{}
	if strings.TrimSpace(body.Name) == "" {
		problems["name"] = "Name is required."
	}
	if !isListedZone(body.Zone) {
		problems["zone"] = zoneSentence
	}
	if len(problems) > 0 {
		return errFields(problems)
	}
	id := newID()
	var view scheduleView
	err := a.Do(rq.Ctx(), func(w *Work) error {
		_, err := w.Tx.Exec(w.Ctx, `insert into schedules (id, name, zone, created_at) values ($1, $2, $3, $4)`,
			id, strings.TrimSpace(body.Name), body.Zone, w.Now)
		if err != nil {
			return fmt.Errorf("insert schedule: %w", err)
		}
		m, err := a.loadScheduleModel(w.Ctx, w.Tx, id)
		if err != nil {
			return fmt.Errorf("read new schedule: %w", err)
		}
		view = m.view()
		if err := a.scheduleEdited(w, id, ""); err != nil {
			return fmt.Errorf("announce schedule edit: %w", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("create schedule: %w", err)
	}
	return rq.JSON(http.StatusCreated, view)
}

const (
	zoneSentence        = "Choose a listed time zone."
	instantSentence     = "Use a UTC instant such as 2027-03-14T14:00:00Z."
	rangeEndSentence    = "The range must end after it starts."
	viewLimitSentence   = "View at most 35 days."
	viewLimit           = 35 * 24 * time.Hour
	outOfRangeSentence  = "Out of range."
	dateSentence        = "Use the format YYYY-MM-DD."
	peopleSentence      = "Choose people from the list."
	restrictionSentence = "Each restriction needs days and a start and end in the format HH:MM."
)

// layerBody is what a layer is saved from.
type layerBody struct {
	Name         string            `json:"name"`
	Order        int               `json:"order"`
	ShiftDays    int               `json:"shift_days"`
	HandoffTime  string            `json:"handoff_time"`
	StartDate    string            `json:"start_date"`
	People       []string          `json:"people"`
	Restrictions []restrictionSpec `json:"restrictions"`
}

// form checks a layer body and reads it into a layer form, or answers the 422.
func (b layerBody) form(ctx context.Context, q dbq) (layerForm, error) {
	problems := map[string]string{}
	if strings.TrimSpace(b.Name) == "" {
		problems["name"] = "Name is required."
	}
	if b.Order < 1 || b.Order > 99 {
		problems["order"] = outOfRangeSentence
	}
	if b.ShiftDays < 1 || b.ShiftDays > 28 {
		problems["shift_days"] = outOfRangeSentence
	}
	if _, ok := clockMinutes(b.HandoffTime, false); !ok {
		problems["handoff_time"] = quietSentence
	}
	if _, err := parseLocalDay(b.StartDate); err != nil {
		problems["start_date"] = dateSentence
	}
	known, err := knownStaff(ctx, q, b.People)
	if err != nil {
		return layerForm{}, fmt.Errorf("check layer people: %w", err)
	}
	if len(b.People) == 0 || !known {
		problems["people"] = peopleSentence
	}
	for _, spec := range b.Restrictions {
		if !validRestriction(spec) {
			problems["restrictions"] = restrictionSentence
		}
	}
	if len(problems) > 0 {
		return layerForm{}, errFields(problems)
	}
	restrictions := b.Restrictions
	if restrictions == nil {
		restrictions = []restrictionSpec{}
	}
	form := layerForm{Name: strings.TrimSpace(b.Name), Order: b.Order, ShiftDays: b.ShiftDays, HandoffTime: b.HandoffTime,
		StartDate: b.StartDate, People: b.People, Restrictions: restrictions}
	if err := form.compile(); err != nil {
		return layerForm{}, fmt.Errorf("compile checked layer: %w", err)
	}
	return form, nil
}

func validRestriction(spec restrictionSpec) bool {
	if len(spec.Days) == 0 {
		return false
	}
	for _, day := range spec.Days {
		if !slices.Contains(weekdayNames[:], day) {
			return false
		}
	}
	_, startOK := clockMinutes(spec.Start, false)
	_, endOK := clockMinutes(spec.End, true)
	return startOK && endOK
}

// knownStaff reports whether every id names a person who can hold a shift: signed up, not removed, not a stakeholder.
func knownStaff(ctx context.Context, q dbq, ids []string) (bool, error) {
	distinct := map[string]struct{}{}
	for _, id := range ids {
		distinct[id] = struct{}{}
	}
	var found int
	err := q.QueryRow(ctx, `select count(*) from users where id = any($1) and removed_at is null and role <> 'stakeholder'`, ids).
		Scan(&found)
	if err != nil {
		return false, fmt.Errorf("check people: %w", err)
	}
	return found == len(distinct), nil
}

func (a *App) hCreateLayer(rq *Req) error {
	var body layerBody
	if err := rq.Decode(&body); err != nil {
		return fmt.Errorf("read layer: %w", err)
	}
	var view layerView
	err := a.Do(rq.Ctx(), func(w *Work) error {
		m, before, err := a.currentSchedule(w, rq.Param("id"))
		if err != nil {
			return fmt.Errorf("read schedule: %w", err)
		}
		form, err := body.form(w.Ctx, w.Tx)
		if err != nil {
			return fmt.Errorf("check layer: %w", err)
		}
		layerID := newID()
		if _, err := w.Tx.Exec(w.Ctx, `insert into schedule_layers (id, schedule_id, created_at) values ($1, $2, $3)`,
			layerID, m.ID, w.Now); err != nil {
			return fmt.Errorf("insert layer: %w", err)
		}
		if err := insertRevision(w, layerID, 1, nil, form); err != nil {
			return fmt.Errorf("save layer revision: %w", err)
		}
		if err := a.finishLayerEdit(w, m.ID, layerID, before, &view); err != nil {
			return fmt.Errorf("finish layer edit: %w", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("create layer: %w", err)
	}
	return rq.JSON(http.StatusCreated, view)
}

func (a *App) hUpdateLayer(rq *Req) error {
	var body layerBody
	if err := rq.Decode(&body); err != nil {
		return fmt.Errorf("read layer: %w", err)
	}
	var view layerView
	err := a.Do(rq.Ctx(), func(w *Work) error {
		m, before, err := a.currentSchedule(w, rq.Param("id"))
		if err != nil {
			return fmt.Errorf("read schedule: %w", err)
		}
		layer := m.layer(rq.Param("layer_id"))
		if layer == nil {
			return errNotFound()
		}
		version, err := rq.IfMatch()
		if err != nil {
			return fmt.Errorf("read layer version: %w", err)
		}
		if version != layer.Version {
			return errVersionConflict(m.layerView(layer))
		}
		form, err := body.form(w.Ctx, w.Tx)
		if err != nil {
			return fmt.Errorf("check layer: %w", err)
		}
		if err := insertRevision(w, layer.ID, layer.Revisions[len(layer.Revisions)-1].Number+1, &w.Now, form); err != nil {
			return fmt.Errorf("save layer revision: %w", err)
		}
		if _, err := w.Tx.Exec(w.Ctx, `update schedule_layers set version = version + 1 where id = $1`, layer.ID); err != nil {
			return fmt.Errorf("bump layer version: %w", err)
		}
		if err := a.finishLayerEdit(w, m.ID, layer.ID, before, &view); err != nil {
			return fmt.Errorf("finish layer edit: %w", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("update layer: %w", err)
	}
	return rq.JSON(http.StatusOK, view)
}

func (m *scheduleModel) layer(id string) *layerHistory {
	for _, layer := range m.layers {
		if layer.ID == id {
			return layer
		}
	}
	return nil
}

func insertRevision(w *Work, layerID string, number int, from *time.Time, form layerForm) error {
	restrictions, err := json.Marshal(form.Restrictions)
	if err != nil {
		return fmt.Errorf("encode restrictions: %w", err)
	}
	_, err = w.Tx.Exec(w.Ctx, `insert into schedule_layer_revisions
		(layer_id, revision, effective_from, name, ord, shift_days, handoff_time, start_date, people, restrictions)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, layerID, number, from, form.Name, form.Order, form.ShiftDays,
		form.HandoffTime, form.StartDate, form.People, restrictions)
	if err != nil {
		return fmt.Errorf("insert layer revision: %w", err)
	}
	return nil
}

// finishLayerEdit bumps the schedule record, runs the edit's effects and reads the saved layer back into view.
func (a *App) finishLayerEdit(w *Work, scheduleID, layerID string, before string, view *layerView) error {
	if _, err := w.Tx.Exec(w.Ctx, `update schedules set version = version + 1 where id = $1`, scheduleID); err != nil {
		return fmt.Errorf("bump schedule version: %w", err)
	}
	m, err := a.loadScheduleModel(w.Ctx, w.Tx, scheduleID)
	if err != nil {
		return fmt.Errorf("read saved schedule: %w", err)
	}
	*view = m.layerView(m.layer(layerID))
	if err := a.scheduleEdited(w, scheduleID, before); err != nil {
		return fmt.Errorf("announce schedule edit: %w", err)
	}
	return nil
}

// finalView is the published final schedule over a range, with its days in the viewed zone.
type finalView struct {
	Zone   string         `json:"zone"`
	From   string         `json:"from"`
	To     string         `json:"to"`
	Blocks []blockView    `json:"blocks"`
	Days   []dayView      `json:"days"`
	Layers []layerRowView `json:"layers"`
}

type blockView struct {
	Start      string     `json:"start"`
	End        string     `json:"end"`
	Minutes    int        `json:"minutes"`
	Person     *personRef `json:"person"`
	Gap        bool       `json:"gap"`
	Source     string     `json:"source"`
	LayerID    *string    `json:"layer_id"`
	OverrideID *string    `json:"override_id"`
}

type dayView struct {
	Date    string `json:"date"`
	Start   string `json:"start"`
	End     string `json:"end"`
	Minutes int    `json:"minutes"`
}

type layerRowView struct {
	ID     string      `json:"id"`
	Name   string      `json:"name"`
	Order  int         `json:"order"`
	Blocks []blockView `json:"blocks"`
}

func (m *scheduleModel) blockOf(r stretch) blockView {
	block := blockView{Start: formatInstant(r.Start), End: formatInstant(r.End), Minutes: int(r.End.Sub(r.Start) / time.Minute),
		Person: m.personRef(r.person), Gap: r.person == "", Source: r.source}
	if r.layerID != "" {
		block.LayerID = &r.layerID
	}
	if r.overrideID != "" {
		block.OverrideID = &r.overrideID
	}
	return block
}

func (m *scheduleModel) blocksOf(runs []stretch) []blockView {
	blocks := make([]blockView, 0, len(runs))
	for _, r := range runs {
		blocks = append(blocks, m.blockOf(r))
	}
	return blocks
}

// final computes the published final schedule over [from, to) with its day bands in the viewed zone.
func (m *scheduleModel) final(from, to time.Time, viewZone string, view *time.Location) finalView {
	layers := make([]layerRowView, 0, len(m.layers))
	for _, layer := range m.orderedLayers() {
		layers = append(layers, layerRowView{ID: layer.ID, Name: layer.current().Name, Order: layer.current().Order,
			Blocks: m.blocksOf(m.layerRuns(layer, from, to))})
	}
	days := []dayView{}
	for day := dayOf(from, view); ; day = day.plus(1) {
		begin, end := day.at(view, 0), day.plus(1).at(view, 0)
		if instantReached(begin, to) {
			break
		}
		begin, end = laterOf(begin, from), earlierOf(end, to)
		days = append(days, dayView{Date: day.String(), Start: formatInstant(begin), End: formatInstant(end),
			Minutes: int(end.Sub(begin) / time.Minute)})
	}
	return finalView{Zone: viewZone, From: formatInstant(from), To: formatInstant(to),
		Blocks: m.blocksOf(m.finalRuns(from, to)), Days: days, Layers: layers}
}

func (a *App) hFinal(rq *Req) error {
	from, errFrom := parseInstant(rq.Query("from"))
	to, errTo := parseInstant(rq.Query("to"))
	problems := map[string]string{}
	if errFrom != nil {
		problems["from"] = instantSentence
	}
	if errTo != nil {
		problems["to"] = instantSentence
	}
	if len(problems) == 0 && instantReached(from, to) {
		problems["to"] = rangeEndSentence
	}
	if len(problems) == 0 && to.Sub(from) > viewLimit {
		problems["to"] = viewLimitSentence
	}
	m, err := a.loadScheduleModel(rq.Ctx(), a.db, rq.Param("id"))
	if err != nil {
		return fmt.Errorf("read schedule: %w", err)
	}
	zone := rq.Query("zone")
	if zone == "" {
		zone = m.Zone
	}
	if !isListedZone(zone) {
		problems["zone"] = zoneSentence
	}
	if len(problems) > 0 {
		return errFields(problems)
	}
	view, err := time.LoadLocation(zone)
	if err != nil {
		return fmt.Errorf("load zone %s: %w", zone, err)
	}
	return rq.JSON(http.StatusOK, m.final(from, to, zone, view))
}

func init() {
	routeSetups = append(routeSetups, func(a *App) {
		a.route(route{Pattern: "GET /api/schedules", Access: accStaff, Handler: a.hSchedules})
		a.route(route{Pattern: "GET /api/schedules/{id}", Access: accStaff, Resource: "schedule", Handler: a.hSchedule})
		a.route(route{Pattern: "POST /api/schedules", Access: accLead, Handler: a.hCreateSchedule})
		a.route(route{Pattern: "POST /api/schedules/{id}/layers", Access: accLead, Resource: "schedule", Handler: a.hCreateLayer})
		a.route(route{Pattern: "PUT /api/schedules/{id}/layers/{layer_id}", Access: accLead, Resource: "schedule", Handler: a.hUpdateLayer})
		a.route(route{Pattern: "GET /api/schedules/{id}/final", Access: accStaff, Resource: "schedule", Handler: a.hFinal})
	})
}
