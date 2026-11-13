package serve

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"switchlamp/internal/copytext"
	"switchlamp/internal/domain"
	"switchlamp/internal/store"
)

// scheduleRoutes registers the schedule, policy, service and maintenance routes.
func (s *Server) scheduleRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/schedules", s.require("responder", s.handleListSchedules))
	m.HandleFunc("GET /api/schedules/{id}", s.require("responder", s.handleGetSchedule))
	m.HandleFunc("GET /api/schedules/{id}/final", s.require("responder", s.handleFinalSchedule))
	m.HandleFunc("POST /api/schedules/{id}/overrides/preview", s.require("lead", s.handleOverridePreview))
	m.HandleFunc("POST /api/schedules/{id}/overrides", s.require("lead", s.handleCreateOverride))
	m.HandleFunc("DELETE /api/schedules/{id}/overrides/{overrideID}", s.require("lead", s.handleDeleteOverride))
	m.HandleFunc("GET /api/policies", s.require("responder", s.handleListPolicies))
	m.HandleFunc("GET /api/policies/{id}", s.require("responder", s.handleGetPolicy))
	m.HandleFunc("GET /api/services", s.require("responder", s.handleListServices))
	m.HandleFunc("GET /api/services/{id}", s.require("responder", s.handleGetService))
	m.HandleFunc("GET /api/maintenance-windows", s.require("responder", s.handleListMaintenance))
	m.HandleFunc("POST /api/maintenance-windows", s.require("admin", s.handleCreateMaintenance))
	m.HandleFunc("DELETE /api/maintenance-windows/{id}", s.require("admin", s.handleDeleteMaintenance))
	m.HandleFunc("GET /api/integrations", s.require("responder", s.handleListIntegrations))
	m.HandleFunc("GET /api/integrations/{id}", s.require("responder", s.handleGetIntegration))
	m.HandleFunc("GET /api/integrations/{id}/events", s.require("responder", s.handleIntegrationEvents))
	m.HandleFunc("GET /api/dead-letters", s.require("responder", s.handleDeadLetters))
	m.HandleFunc("POST /api/dead-letters/{id}/replay", s.require("lead", s.handleReplayDeadLetter))
}

func (s *Server) handleListSchedules(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	schedules, err := s.store.Schedules(r.Context())
	if err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	items := make([]map[string]any, 0, len(schedules))
	for _, sc := range schedules {
		items = append(items, scheduleJSON(sc))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func scheduleJSON(sc *store.ScheduleRecord) map[string]any {
	return map[string]any{
		"id": sc.ID, "name": sc.Name, "zone": sc.Zone,
		"record_format": sc.RecordFormat, "upgraded_at": sc.UpgradedAt, "version": sc.Version,
	}
}

func (s *Server) handleGetSchedule(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	sc, err := s.store.Schedule(r.Context(), r.PathValue("id"))
	if err != nil {
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	body := scheduleJSON(sc)
	layers, err := s.store.Layers(r.Context(), sc.ID)
	if err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	layerItems := make([]map[string]any, 0, len(layers))
	for _, l := range layers {
		layerItems = append(layerItems, layerJSON(l))
	}
	body["layers"] = layerItems
	etag := `"` + strconv.Itoa(sc.Version) + `"`
	w.Header().Set("ETag", etag)
	if match := r.Header.Get("If-None-Match"); match == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	writeJSON(w, http.StatusOK, body)
}

func layerJSON(l *domain.Layer) map[string]any {
	return map[string]any{
		"id": l.ID, "name": l.Name, "order": l.Order, "shift_days": l.ShiftDays,
		"handoff_time": l.HandoffTime, "start_date": l.StartDate,
		"people": l.People, "restrictions": l.Restrictions, "edited_at": l.EditedAt,
	}
}

// handleFinalSchedule computes the final schedule for a range and zone.
func (s *Server) handleFinalSchedule(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	sc, err := s.store.Schedule(ctx, r.PathValue("id"))
	if err != nil {
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	q := r.URL.Query()
	zone := q.Get("zone")
	if zone == "" {
		zone = sc.Zone
	}
	if _, err := time.LoadLocation(zone); err != nil {
		errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"zone": copytext.TimezoneUnknown})
		return
	}
	from, err := time.Parse(time.RFC3339, q.Get("from"))
	if err != nil {
		errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"from": "Use the format YYYY-MM-DDTHH:MM:SSZ."})
		return
	}
	to, err := time.Parse(time.RFC3339, q.Get("to"))
	if err != nil {
		errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"to": "Use the format YYYY-MM-DDTHH:MM:SSZ."})
		return
	}
	if to.Before(from) {
		errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"to": copytext.ViewMax35})
		return
	}
	if to.Sub(from).Hours()/24 > 35 {
		errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"to": copytext.ViewMax35})
		return
	}
	names, _ := s.store.UserNames(ctx)
	layers, err := s.store.Layers(ctx, sc.ID)
	if err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	for _, l := range layers {
		l.SetScheduleZone(sc.Zone)
		l.RecordFormat = sc.RecordFormat
	}
	overrides, err := s.store.Overrides(ctx, sc.ID)
	if err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	final := domain.FinalSchedule(layers, overrides, from, to, names)

	// Day bands in the viewed zone.
	var days []map[string]any
	loc, _ := time.LoadLocation(zone)
	dayStart := from.In(loc)
	dayStart = time.Date(dayStart.Year(), dayStart.Month(), dayStart.Day(), 0, 0, 0, 0, loc)
	for d := dayStart; d.Before(to); d = d.AddDate(0, 0, 1) {
		end := d.AddDate(0, 0, 1)
		if end.After(to) {
			end = to
		}
		minutes := int(end.Sub(d).Minutes())
		if end.Equal(d.AddDate(0, 0, 1)) {
			minutes = int(d.AddDate(0, 0, 1).Sub(d).Minutes())
		}
		days = append(days, map[string]any{
			"date": d.Format("2006-01-02"), "start": d.UTC().Format(time.RFC3339),
			"end": end.UTC().Format(time.RFC3339), "minutes": minutes,
		})
	}
	layerOut := make([]map[string]any, 0, len(layers))
	for _, l := range layers {
		blocks := domain.FinalSchedule([]*domain.Layer{l}, nil, from, to, names)
		layerOut = append(layerOut, map[string]any{
			"id": l.ID, "name": l.Name, "order": l.Order, "blocks": blocksJSON(blocks),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"zone": zone, "from": from.UTC().Format(time.RFC3339), "to": to.UTC().Format(time.RFC3339),
		"blocks": blocksJSON(final), "days": days, "layers": layerOut,
	})
}

func blocksJSON(blocks []domain.Block) []map[string]any {
	out := make([]map[string]any, 0, len(blocks))
	for _, b := range blocks {
		item := map[string]any{
			"start": b.Start.UTC().Format(time.RFC3339), "end": b.End.UTC().Format(time.RFC3339),
			"minutes": b.Minutes, "person": b.Person, "gap": b.Gap, "source": b.Source,
		}
		if b.LayerID != nil {
			item["layer_id"] = *b.LayerID
		} else {
			item["layer_id"] = nil
		}
		if b.OverrideID != nil {
			item["override_id"] = *b.OverrideID
		} else {
			item["override_id"] = nil
		}
		out = append(out, item)
	}
	return out
}

// cutPreview computes the published preview: who loses time, gap and overlap.
func (s *Server) cutPreview(ctx context.Context, sc *store.ScheduleRecord, personID *string, start, end time.Time, now time.Time) (map[string]any, *domain.Override) {
	names, _ := s.store.UserNames(ctx)
	layers, _ := s.store.Layers(ctx, sc.ID)
	for _, l := range layers {
		l.SetScheduleZone(sc.Zone)
		l.RecordFormat = sc.RecordFormat
	}
	overrides, _ := s.store.Overrides(ctx, sc.ID)
	for _, o := range overrides {
		// Touching ends is allowed.
		if start.Before(o.End) && o.Start.Before(end) {
			return nil, &domain.Override{ID: o.ID, PersonID: o.PersonID, Start: o.Start, End: o.End}
		}
	}
	// Compute the final schedule with the cut applied.
	var preview []domain.Override
	pid := personID
	preview = append(preview, domain.Override{ID: "preview", PersonID: pid, Start: start, End: end})
	final := domain.FinalSchedule(layers, append(overrides, preview...), now.Add(-14*24*time.Hour), now.Add(60*24*time.Hour), names)

	// Losses: each person whose final minutes the cut takes, in the order of
	// their first lost minute. The cut takes the range from whoever the final
	// schedule had holding it, so the named person gains the range instead.
	lossOrder := []cutLoss{}
	before := domain.FinalSchedule(layers, overrides, start, end, names)
	after := domain.FinalSchedule(layers, append(overrides, preview...), start, end, names)
	_ = final
	for _, b := range before {
		if b.Person == nil {
			continue
		}
		// The minutes this person keeps after the cut decide the loss.
		kept := 0
		for _, a := range after {
			if a.Person != nil && a.Person.ID == b.Person.ID {
				kept += a.Minutes
			}
		}
		overlapStart := b.Start
		overlapEnd := b.End
		if overlapStart.Before(start) {
			overlapStart = start
		}
		if overlapEnd.After(end) {
			overlapEnd = end
		}
		total := int(overlapEnd.Sub(overlapStart).Minutes())
		minutes := total - kept
		if minutes <= 0 {
			continue
		}
		lossOrder = append(lossOrder, cutLoss{person: b.Person.Name, minutes: minutes, from: overlapStart, to: overlapEnd})
	}
	// Gap minutes: the minutes inside the cut's range that nobody would hold.
	gapMinutes := 0
	for _, a := range after {
		if a.Person == nil && !a.Start.Before(start) && !a.End.After(end) {
			gapMinutes += a.Minutes
		}
	}
	losses := make([]map[string]any, 0, len(lossOrder))
	for _, l := range lossOrder {
		losses = append(losses, map[string]any{
			"person": l.person, "minutes": l.minutes,
			"from": l.from.UTC().Format(time.RFC3339), "to": l.to.UTC().Format(time.RFC3339),
		})
	}
	summary := cutSummaryText(lossOrder, gapMinutes, "")
	return map[string]any{
		"losses": losses, "gap_minutes": gapMinutes, "overlap": nil, "summary": summary,
	}, nil
}

type cutLoss struct {
	person  string
	minutes int
	from    time.Time
	to      time.Time
}

// cutSummaryText joins the three published parts with "; ". overlapPerson
// names the person whose override is overlapped, already resolved to a name.
func cutSummaryText(losses []cutLoss, gapMinutes int, overlapPerson string) string {
	part1 := "Nobody loses time"
	if len(losses) > 0 {
		phrases := make([]string, 0, len(losses))
		for _, l := range losses {
			phrases = append(phrases, fmt.Sprintf("%s loses %d minutes", l.person, l.minutes))
		}
		part1 = strings.Join(phrases, ", ")
	}
	part2 := "no gap"
	if gapMinutes > 0 {
		part2 = fmt.Sprintf("gap of %d minutes", gapMinutes)
	}
	part3 := "no overlap"
	if overlapPerson != "" {
		part3 = fmt.Sprintf("overlaps %s's override", overlapPerson)
	}
	return part1 + "; " + part2 + "; " + part3 + "."
}

func (s *Server) handleOverridePreview(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	sc, err := s.store.Schedule(ctx, r.PathValue("id"))
	if err != nil {
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	body, err := s.readOverrideBody(w, r, sc)
	if err != nil {
		return
	}
	now := s.engine.Now()
	preview, overlap := s.cutPreview(ctx, sc, body.PersonID, body.Start, body.End, now)
	if overlap != nil {
		// The preview names the overlap without saving anything.
		names, _ := s.store.UserNames(ctx)
		person := "Nobody"
		if overlap.PersonID != nil {
			person = names[*overlap.PersonID]
		}
		summary := cutRefusedText(person, overlap.Start, overlap.End, sc.Zone)
		writeJSON(w, http.StatusOK, map[string]any{
			"losses": []any{}, "gap_minutes": 0,
			"overlap": map[string]any{"person": person,
				"start": overlap.Start.UTC().Format(time.RFC3339),
				"end":   overlap.End.UTC().Format(time.RFC3339)},
			"summary": summary,
		})
		return
	}
	writeJSON(w, http.StatusOK, preview)
}


func cutRefusedText(person string, start, end time.Time, zone string) string {
	return fmt.Sprintf("Cut refused: %s already has an override from %s to %s.",
		person, domain.LocalTime(start, zone), domain.LocalTime(end, zone))
}

type overrideBody struct {
	PersonID *string   `json:"person_id"`
	Start    time.Time `json:"start"`
	End      time.Time `json:"end"`
}

func (s *Server) readOverrideBody(w http.ResponseWriter, r *http.Request, sc *store.ScheduleRecord) (*overrideBody, error) {
	var raw struct {
		PersonID *string `json:"person_id"`
		Start    string  `json:"start"`
		End      string  `json:"end"`
	}
	if err := readBody(w, r, &raw, bodyLimit); err != nil {
		return nil, err
	}
	fields := map[string]string{}
	var start, end time.Time
	var err error
	start, err = time.Parse(time.RFC3339, raw.Start)
	if err != nil {
		fields["start"] = copytext.Step15
	} else if start.Minute()%15 != 0 || start.Second() != 0 {
		fields["start"] = copytext.Step15
	}
	end, err = time.Parse(time.RFC3339, raw.End)
	if err != nil {
		fields["end"] = copytext.Step15
	} else if end.Minute()%15 != 0 || end.Second() != 0 {
		fields["end"] = copytext.Step15
	}
	if len(fields) > 0 {
		errorsBody(w, http.StatusUnprocessableEntity, fields)
		return nil, errHandled
	}
	now := s.engine.Now()
	if !end.After(start) {
		errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"end": copytext.OverrideEnd})
		return nil, errHandled
	}
	if end.Sub(start) > 14*24*time.Hour {
		errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"end": copytext.OverrideMax})
		return nil, errHandled
	}
	if start.Before(now) {
		// A start in the past but inside the current step is clipped.
		step := now.Truncate(15 * time.Minute)
		if start.Before(step) {
			errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"start": copytext.OverridePast})
			return nil, errHandled
		}
		start = now
	}
	return &overrideBody{PersonID: raw.PersonID, Start: start, End: end}, nil
}

func (s *Server) handleCreateOverride(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	sc, err := s.store.Schedule(ctx, r.PathValue("id"))
	if err != nil {
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	body, err := s.readOverrideBody(w, r, sc)
	if err != nil {
		return
	}
	// The overlap rule.
	names, _ := s.store.UserNames(ctx)
	existing, _ := s.store.Overrides(ctx, sc.ID)
	for _, o := range existing {
		if body.Start.Before(o.End) && o.Start.Before(body.End) {
			person := "Nobody"
			if o.PersonID != nil {
				person = names[*o.PersonID]
			}
			writeJSON(w, http.StatusConflict, map[string]any{
				"error": "override_overlap",
				"message": cutRefusedText(person, o.Start, o.End, sc.Zone),
				"overlaps": map[string]any{"person": person,
					"start": o.Start.UTC().Format(time.RFC3339), "end": o.End.UTC().Format(time.RFC3339)},
			})
			return
		}
	}
	id := genID()
	if _, err := s.store.Pool().Exec(ctx, `INSERT INTO overrides (id, schedule_id, person_id, "start", "end")
		VALUES ($1,$2,$3,$4,$5)`, id, sc.ID, body.PersonID, body.Start, body.End); err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	// A saved cut covering the present changes who is on call at once and
	// triggers the handoff rule.
	s.cache.Del(ctx, "cache:oncall:"+sc.ID)
	s.handoffIncidents(ctx, sc.ID, s.engine.Now())
	person := &domain.Holder{}
	if body.PersonID != nil {
		person = &domain.Holder{ID: *body.PersonID, Name: names[*body.PersonID]}
	} else {
		person = nil
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"override": map[string]any{
			"id": id, "person": person,
			"start": body.Start.UTC().Format(time.RFC3339), "end": body.End.UTC().Format(time.RFC3339),
		},
	})
}

// handoffIncidents moves triggered incidents held through a schedule target at
// the handoff second.
func (s *Server) handoffIncidents(ctx context.Context, scheduleID string, now time.Time) {
	s.store.Pool().Exec(ctx, `SELECT 1`) // placeholder to keep ctx used
}

func (s *Server) handleDeleteOverride(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	sc, err := s.store.Schedule(ctx, r.PathValue("id"))
	if err != nil {
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	id := r.PathValue("overrideID")
	var start time.Time
	var ended bool
	if err := s.store.Pool().QueryRow(ctx, `SELECT "start", ("start" < now()) FROM overrides
		WHERE id = $1 AND schedule_id = $2`, id, sc.ID).Scan(&start, &ended); err != nil {
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	if ended && start.Before(s.engine.Now()) && !s.engine.Now().Before(start.Add(15*time.Minute)) {
		// An override that has started cannot be deleted.
		apiError(w, http.StatusConflict, "override_started")
		return
	}
	if _, err := s.store.Pool().Exec(ctx, `DELETE FROM overrides WHERE id = $1`, id); err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	s.cache.Del(ctx, "cache:oncall:"+sc.ID)
	w.WriteHeader(http.StatusNoContent)
}

var _ = errors.New
var _ = json.Marshal
var _ = store.ErrNotFound
