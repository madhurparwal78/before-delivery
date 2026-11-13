package main

import (
	"database/sql"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/lib/pq"
)

func (s *Server) registerEventRoutes() {
	s.route("GET /api/occurrences", false, s.handleOccurrences)
	s.route("POST /api/events", false, s.handleCreateEvent)
	s.route("GET /api/events/{id}", false, s.handleGetEvent)
	s.route("PATCH /api/events/{id}", false, s.handlePatchEvent)
	s.route("DELETE /api/events/{id}", false, s.handleDeleteEvent)
	s.route("POST /api/events/{id}/duplicate", false, s.handleDuplicate)
	s.route("POST /api/events/{id}/move", false, s.handleMoveToCalendar)
	s.route("POST /api/events/{id}/undo", false, s.handleUndo)
	s.route("GET /api/events/{id}/conflicts", false, s.handleConflicts)
	s.route("POST /api/events/{id}/guests", false, s.handleAddGuests)
	s.route("DELETE /api/events/{id}/guests/{person}", false, s.handleRemoveGuest)
	s.route("PUT /api/events/{id}/replies/me", false, s.handleReply)
	s.route("POST /api/events/{id}/proposals", false, s.handlePropose)
	s.route("POST /api/proposals/{id}/accept", false, s.handleDecideProposal)
	s.route("POST /api/proposals/{id}/decline", false, s.handleDecideProposal)
	s.route("POST /api/events/{id}/share-link", false, s.handleCreateLink)
	s.route("DELETE /api/events/{id}/share-link", false, s.handleDeleteLink)
	s.route("GET /api/share/{token}", true, s.handleSharedEvent)
	s.route("POST /api/share/{token}", true, readOnly)
	s.route("PUT /api/share/{token}", true, readOnly)
	s.route("PATCH /api/share/{token}", true, readOnly)
	s.route("DELETE /api/share/{token}", true, readOnly)
	s.route("POST /api/events/{id}/zone-moves", false, s.handleZoneMove)
	s.route("GET /api/trash", false, s.handleTrash)
	s.route("POST /api/trash/{id}/restore", false, s.handleRestore)
	s.route("DELETE /api/trash/{id}", false, s.handleDeleteForGood)
	s.route("GET /api/search", false, s.handleSearch)
	s.route("GET /api/find-a-time", false, s.handleFindATime)
	s.route("GET /api/reminders", false, s.handleReminders)
	s.route("POST /api/reminders/{id}/snooze", false, s.handleSnooze)
}

func readOnly(rq *Req) error {
	return apiErr(405, "read_only", "Shared links are read only.")
}

// view projects one event or occurrence for a viewer.
func view(w *World, viewer *Person, e *Event, occ *Occurrence, access string, eventLevel bool) map[string]any {
	if occ == nil {
		occ = w.firstOccurrence(e)
	}
	return w.project(View{Viewer: viewer, E: e, O: occ, Access: access, EventLevel: eventLevel, Key: occ.ReplyKey()})
}

func (rq *Req) etag(e *Event) { rq.W.Header().Set("ETag", fmt.Sprintf(`"%d"`, e.Version)) }

// readable loads an event the caller may read, with its access; 404 otherwise.
func (rq *Req) readable(id string) (*World, *Event, string, error) {
	w, err := rq.World()
	if err != nil {
		return nil, nil, "", err
	}
	e, err := loadEvent(rq.ctx(), rq.S.db, id)
	if err != nil {
		return nil, nil, "", err
	}
	if e == nil || e.Trashed {
		return nil, nil, "", errNotFound
	}
	access := w.access(e, rq.Me)
	if access == "" {
		return nil, nil, "", errNotFound
	}
	return w, e, access, attachDetails(rq.ctx(), rq.S.db, []*Event{e}, w.Now)
}

func parseDay(q, name string) (time.Time, *APIError) {
	d, err := parseDate(q)
	if err != nil {
		return d, fieldErr(name, "Use YYYY-MM-DD.")
	}
	return d, nil
}

func (s *Server) handleOccurrences(rq *Req) error {
	q := rq.R.URL.Query()
	from, perr := parseDay(q.Get("from"), "from")
	if perr != nil {
		return perr
	}
	to, perr := parseDay(q.Get("to"), "to")
	if perr != nil {
		return perr
	}
	if !to.After(from) || to.Sub(from) > 366*24*time.Hour {
		return fieldErr("to", "Use a date after from, at most 366 days later.")
	}
	w, err := rq.World()
	if err != nil {
		return err
	}
	loc := zoneLocations[rq.Me.Zone]
	begin, _, _ := resolveLocal(loc, from, nil)
	finish, _, _ := resolveLocal(loc, to, nil)
	win := Window{From: begin, To: finish, Dates: true, FromDate: from, ToDate: to}
	ids := pq.StringArray{}
	wanted := map[string]bool{}
	for _, id := range strings.Split(q.Get("calendars"), ",") {
		wanted[id] = true
	}
	for id, c := range w.Calendars {
		if !w.canRead(c, rq.Me) {
			continue
		}
		if q.Get("calendars") == "" && id != holidaysCalendar || wanted[id] {
			ids = append(ids, id)
		}
	}
	events, err := loadEvents(rq.ctx(), s.db, `NOT trashed AND (calendar_id = ANY($1) OR id IN (SELECT event_id FROM guests WHERE person_id = $2))
		AND start_local < $3 AND (rrule IS NOT NULL OR end_local >= $4)`, ids, rq.Me.ID, to.AddDate(0, 0, 2).Format(layoutDate), from.AddDate(0, 0, -3).Format(layoutDate))
	if err != nil {
		return err
	}
	type hit struct {
		e    *Event
		occs []*Occurrence
	}
	var hits []hit
	var withRows []*Event
	for _, e := range events {
		if w.access(e, rq.Me) == "" {
			continue
		}
		if occs := w.occurrences(e, win); len(occs) > 0 {
			hits = append(hits, hit{e, occs})
			withRows = append(withRows, e)
		}
	}
	if err := attachDetails(rq.ctx(), s.db, withRows, w.Now); err != nil {
		return err
	}
	var all []*Occurrence
	for _, h := range hits {
		all = append(all, h.occs...)
	}
	sort.Slice(all, func(i, j int) bool {
		if !all[i].Begin.Equal(all[j].Begin) {
			return all[i].Begin.Before(all[j].Begin)
		}
		return all[i].ID < all[j].ID
	})
	rows := make([]map[string]any, 0, len(all))
	for _, o := range all {
		rows = append(rows, w.project(View{Viewer: rq.Me, E: o.Event, O: o, Access: w.access(o.Event, rq.Me), ForOccurrence: true, Key: o.ReplyKey()}))
	}
	return rq.json(200, map[string]any{"occurrences": rows})
}

func (s *Server) handleGetEvent(rq *Req) error {
	w, e, access, err := rq.readable(rq.R.PathValue("id"))
	if err != nil {
		return err
	}
	var occ *Occurrence
	if id := rq.R.URL.Query().Get("occurrence_id"); id != "" {
		eventID, key := splitOccurrenceID(id)
		if eventID != e.ID {
			return errNotFound
		}
		if occ = w.occurrenceAt(e, key); occ == nil {
			return errNotFound
		}
	}
	rq.etag(e)
	return rq.json(200, view(w, rq.Me, e, occ, access, occ == nil))
}

func (s *Server) handleCreateEvent(rq *Req) error {
	fields, err := rq.fields()
	if err != nil {
		return err
	}
	p, errs := parsePatch(fields)
	if len(errs) > 0 {
		return fieldErrors(errs)
	}
	if p.CalendarID == nil {
		return fieldErr("calendar_id", "Choose a calendar.")
	}
	var created string
	err = s.edit(rq.ctx(), rq.Me, func(ed *Edit) error {
		cal := ed.W.Calendars[*p.CalendarID]
		if cal == nil || !ed.W.canRead(cal, ed.Actor) {
			return errNotFound
		}
		if !ed.W.canWrite(cal, ed.Actor) {
			return errForbidden
		}
		e := &Event{ID: newID("evt-"), CalendarID: cal.ID, Colour: "calendar", Visibility: "default", Version: 1,
			SavedAt: ed.Now, CreatedAt: ed.Now, SavedBy: ed.Actor.ID, Reminders: []int{}, Exceptions: map[string]*Exception{}}
		e.SeriesID = e.ID
		p.applyContent(e)
		p.wholeEventFields(e)
		e.StartLocal, e.EndLocal = deref(p.Start), deref(p.End)
		e.Switches = ed.W.Defaults
		if p.RRule != nil && *p.RRule != "" {
			e.RRule = p.RRule
		}
		p.applyEventWide(e)
		if p.Reminders == nil && !e.AllDay {
			e.Reminders = append([]int{}, cal.DefaultReminders...)
		}
		if errs := validateEvent(e); len(errs) > 0 {
			return fieldErrors(errs)
		}
		guests, err := ed.guestCandidates(e, p.GuestIDs, "guest_ids")
		if err != nil {
			return err
		}
		if err := insertEvent(ed.Ctx, ed.Tx, e); err != nil {
			return err
		}
		if err := ed.invite(e, guests); err != nil {
			return err
		}
		if err := ed.recheck(e, nil); err != nil {
			return err
		}
		created = e.ID
		return ed.changed(e, "event.changed")
	})
	if err != nil {
		return err
	}
	_, e, access, err := rq.readableFresh(created)
	if err != nil {
		return err
	}
	rq.etag(e)
	return rq.json(201, view(rq.world, rq.Me, e, nil, access, true))
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// readableFresh reloads the world after a write, then loads the event for the caller.
func (rq *Req) readableFresh(id string) (*World, *Event, string, error) {
	rq.world = nil
	return rq.readable(id)
}

// checkVersion enforces If-Match: 428 when missing, 412 with the winner's values when stale.
func (rq *Req) checkVersion(ed *Edit, e *Event) error {
	header := strings.Trim(rq.R.Header.Get("If-Match"), `"`)
	if header == "" {
		return apiErr(428, "version_required", "Send the event version in If-Match.")
	}
	version, err := strconv.Atoi(header)
	if err != nil {
		return apiErr(428, "version_required", "Send the event version in If-Match.")
	}
	if version == e.Version {
		return nil
	}
	winner := "Someone"
	if p := ed.W.People[e.SavedBy]; p != nil {
		winner = p.Name
	}
	if err := attachDetails(ed.Ctx, ed.Tx, []*Event{e}, ed.Now); err != nil {
		return err
	}
	conflict := apiErr(412, "version_conflict", winner+" saved this first.")
	conflict.Current = view(ed.W, ed.Actor, e, nil, ed.W.access(e, ed.Actor), true)
	return conflict
}

// target resolves the scope and occurrence an edit or delete addresses.
func (rq *Req) target(w *World, e *Event, scope, occurrenceID string) (*Occurrence, string, error) {
	if !e.recurring() {
		return w.firstOccurrence(e), "all", nil
	}
	if scope != "this" && scope != "following" && scope != "all" {
		return nil, "", fieldErr("scope", "Choose this, following or all.")
	}
	if occurrenceID == "" {
		if scope != "all" {
			return nil, "", fieldErr("occurrence_id", "Name the occurrence this applies to.")
		}
		return w.firstOccurrence(e), scope, nil
	}
	eventID, key := splitOccurrenceID(occurrenceID)
	if eventID != e.ID {
		return nil, "", errNotFound
	}
	occ := w.occurrenceAt(e, key)
	if occ == nil {
		return nil, "", errNotFound
	}
	return occ, scope, nil
}

var guestEditable = map[string]bool{"title": true, "location": true, "notes": true, "start_local": true, "end_local": true,
	"rrule": true, "scope": true, "occurrence_id": true}

func (s *Server) handlePatchEvent(rq *Req) error {
	fields, err := rq.fields()
	if err != nil {
		return err
	}
	p, errs := parsePatch(fields)
	if len(errs) > 0 {
		return fieldErrors(errs)
	}
	var out map[string]any
	var split *SplitResult
	var result *Event
	err = s.edit(rq.ctx(), rq.Me, func(ed *Edit) error {
		e, err := ed.readableEvent(rq.R.PathValue("id"))
		if err != nil {
			return err
		}
		access := ed.W.access(e, ed.Actor)
		switch {
		case access == "full":
			if p.Present["calendar_id"] || p.Present["guest_ids"] {
				return fieldErr("calendar_id", "Use Move to calendar and the guest list instead.")
			}
		case access == "guest" && e.Switches.ModifyEvent:
			for name := range fields {
				if !guestEditable[name] {
					return errForbidden
				}
			}
		default:
			return errForbidden
		}
		if err := rq.checkVersion(ed, e); err != nil {
			return err
		}
		occ, scope, err := rq.target(ed.W, e, p.Scope, p.OccurrenceID)
		if err != nil {
			return err
		}
		result, split, err = ed.patchEvent(e, p, scope, occ)
		if err != nil {
			return err
		}
		if err := ed.changed(result, "event.changed"); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return err
	}
	_, e, access, err := rq.readableFresh(result.ID)
	if err != nil {
		return err
	}
	out = map[string]any{"event": view(rq.world, rq.Me, e, nil, access, true), "split": nil}
	if split != nil {
		out["split"] = split
	}
	rq.etag(e)
	return rq.json(200, out)
}

func (s *Server) handleDeleteEvent(rq *Req) error {
	scope, occurrenceID := rq.R.URL.Query().Get("scope"), rq.R.URL.Query().Get("occurrence_id")
	var trashID string
	err := s.edit(rq.ctx(), rq.Me, func(ed *Edit) error {
		e, err := ed.readableEvent(rq.R.PathValue("id"))
		if err != nil {
			return err
		}
		if ed.W.access(e, ed.Actor) != "full" {
			return errForbidden
		}
		if err := rq.checkVersion(ed, e); err != nil {
			return err
		}
		occ, scope, err := rq.target(ed.W, e, scope, occurrenceID)
		if err != nil {
			return err
		}
		trashID, err = ed.trash(e, scope, occ)
		return err
	})
	if err != nil {
		return err
	}
	return rq.json(200, map[string]any{"trash_id": trashID})
}

func (s *Server) handleDuplicate(rq *Req) error {
	var created string
	err := s.edit(rq.ctx(), rq.Me, func(ed *Edit) error {
		e, err := ed.readableEvent(rq.R.PathValue("id"))
		if err != nil {
			return err
		}
		access := ed.W.access(e, ed.Actor)
		if access == "busy" {
			return errForbidden
		}
		calendar := e.CalendarID
		if access != "full" {
			calendar = "cal-" + firstName(ed.Actor.Name)
			if ed.Actor.Role == "guest" {
				return errForbidden
			}
		}
		duplicate := *e
		duplicate.ID, duplicate.CalendarID, duplicate.Title = newID("evt-"), calendar, e.Title+" copy"
		duplicate.SeriesID, duplicate.SplitFrom, duplicate.Version, duplicate.Switches = duplicate.ID, nil, 1, ed.W.Defaults
		duplicate.SavedAt, duplicate.CreatedAt, duplicate.SavedBy, duplicate.Trashed = ed.Now, ed.Now, ed.Actor.ID, false
		duplicate.MovedRules, duplicate.ICalUID, duplicate.Exceptions, duplicate.GuestIDs = nil, nil, map[string]*Exception{}, nil
		if err := insertEvent(ed.Ctx, ed.Tx, &duplicate); err != nil {
			return err
		}
		created = duplicate.ID
		return ed.changed(&duplicate, "event.changed")
	})
	if err != nil {
		return err
	}
	_, e, access, err := rq.readableFresh(created)
	if err != nil {
		return err
	}
	rq.etag(e)
	return rq.json(201, view(rq.world, rq.Me, e, nil, access, true))
}

func (s *Server) handleMoveToCalendar(rq *Req) error {
	var body struct {
		CalendarID string `json:"calendar_id"`
	}
	if err := rq.decode(&body); err != nil {
		return err
	}
	var id string
	err := s.edit(rq.ctx(), rq.Me, func(ed *Edit) error {
		e, err := ed.readableEvent(rq.R.PathValue("id"))
		if err != nil {
			return err
		}
		target := ed.W.Calendars[body.CalendarID]
		if ed.W.access(e, ed.Actor) != "full" || target == nil {
			return errForbidden
		}
		if !ed.W.canWrite(target, ed.Actor) {
			return errForbidden
		}
		if err := rq.checkVersion(ed, e); err != nil {
			return err
		}
		id = e.ID
		if err := ed.log(ChangeRow{Type: "event.deleted", EventID: e.ID, CalendarID: e.CalendarID, Data: map[string]any{}}); err != nil {
			return err
		}
		e.CalendarID = target.ID
		if err := ed.touch(e); err != nil {
			return err
		}
		return ed.changed(e, "event.changed")
	})
	if err != nil {
		return err
	}
	_, e, access, err := rq.readableFresh(id)
	if err != nil {
		return err
	}
	rq.etag(e)
	return rq.json(200, view(rq.world, rq.Me, e, nil, access, true))
}

func (s *Server) handleUndo(rq *Req) error {
	var id string
	err := s.edit(rq.ctx(), rq.Me, func(ed *Edit) error {
		e, err := ed.readableEvent(rq.R.PathValue("id"))
		if err != nil {
			return err
		}
		if ed.W.access(e, ed.Actor) != "full" {
			return errForbidden
		}
		if err := rq.checkVersion(ed, e); err != nil {
			return err
		}
		var raw []byte
		var after int
		err = ed.Tx.QueryRowContext(ed.Ctx, `SELECT after_version, snapshot FROM undo_snapshots WHERE event_id = $1`, e.ID).Scan(&after, &raw)
		if err != nil && err != sql.ErrNoRows {
			return err
		}
		if err == sql.ErrNoRows || after != e.Version {
			return apiErr(409, "nothing_to_undo", "There is nothing to undo.")
		}
		if err := ed.restoreSnapshot(e, raw); err != nil {
			return err
		}
		if _, err := ed.Tx.ExecContext(ed.Ctx, `DELETE FROM undo_snapshots WHERE event_id = $1`, e.ID); err != nil {
			return err
		}
		id = e.ID
		return ed.changed(e, "event.changed")
	})
	if err != nil {
		return err
	}
	_, e, access, err := rq.readableFresh(id)
	if err != nil {
		return err
	}
	rq.etag(e)
	return rq.json(200, map[string]any{"event": view(rq.world, rq.Me, e, nil, access, true), "split": nil})
}

func (s *Server) handleConflicts(rq *Req) error {
	w, e, access, err := rq.readable(rq.R.PathValue("id"))
	if err != nil {
		return err
	}
	if o := w.organiser(e); access != "full" || e.Kind != "out_of_office" || o == nil || o.ID != rq.Me.ID {
		return errForbidden
	}
	first := w.firstOccurrence(e)
	span := Window{From: first.Begin.Add(-24 * time.Hour), To: first.Begin.AddDate(0, 0, declineHorizonDays)}
	windows := w.occurrences(e, span)
	meetings, err := loadEvents(rq.ctx(), s.db, `NOT trashed AND id IN (SELECT event_id FROM guests WHERE person_id = $1)`, rq.Me.ID)
	if err != nil {
		return err
	}
	if err := attachReplies(rq.ctx(), s.db, meetings); err != nil {
		return err
	}
	var found []*Occurrence
	seen := map[string]bool{}
	for _, m := range meetings {
		for _, wo := range windows {
			for _, o := range w.occurrences(m, Window{From: wo.Begin, To: wo.Finish}) {
				if !seen[o.ID] {
					seen[o.ID] = true
					found = append(found, o)
				}
			}
		}
	}
	sort.Slice(found, func(i, j int) bool { return found[i].Begin.Before(found[j].Begin) })
	rows := []map[string]any{}
	for _, o := range found {
		status, _ := o.Event.replyFor(rq.Me.ID, o.ReplyKey())
		fields := w.project(View{Viewer: rq.Me, E: o.Event, O: o, Access: w.access(o.Event, rq.Me), ForOccurrence: true, Key: o.ReplyKey()})
		row := pick(fields, "event_id", "occurrence_id", "title", "start_local", "zone")
		row["answer"] = status
		rows = append(rows, row)
	}
	return rq.json(200, map[string]any{"conflicts": rows})
}

func (s *Server) handleAddGuests(rq *Req) error {
	var body struct {
		PersonIDs []string `json:"person_ids"`
	}
	if err := rq.decode(&body); err != nil {
		return err
	}
	var id string
	err := s.edit(rq.ctx(), rq.Me, func(ed *Edit) error {
		e, err := ed.readableEvent(rq.R.PathValue("id"))
		if err != nil {
			return err
		}
		access := ed.W.access(e, ed.Actor)
		if access != "full" && !(access == "guest" && e.Switches.InviteOthers) {
			return errForbidden
		}
		ids, err := ed.guestCandidates(e, body.PersonIDs, "person_ids")
		if err != nil {
			return err
		}
		id = e.ID
		if err := ed.invite(e, ids); err != nil {
			return err
		}
		return ed.changed(e, "event.changed")
	})
	if err != nil {
		return err
	}
	_, e, access, err := rq.readableFresh(id)
	if err != nil {
		return err
	}
	rq.etag(e)
	return rq.json(200, view(rq.world, rq.Me, e, nil, access, true))
}

func (s *Server) handleRemoveGuest(rq *Req) error {
	var id string
	err := s.edit(rq.ctx(), rq.Me, func(ed *Edit) error {
		e, err := ed.readableEvent(rq.R.PathValue("id"))
		if err != nil {
			return err
		}
		if ed.W.access(e, ed.Actor) != "full" {
			return errForbidden
		}
		if err := ed.removeGuest(e, rq.R.PathValue("person")); err != nil {
			return err
		}
		id = e.ID
		return ed.changed(e, "event.changed")
	})
	if err != nil {
		return err
	}
	_, e, access, err := rq.readableFresh(id)
	if err != nil {
		return err
	}
	return rq.json(200, view(rq.world, rq.Me, e, nil, access, true))
}

func (s *Server) handleReply(rq *Req) error {
	var body struct {
		Scope        string `json:"scope"`
		OccurrenceID string `json:"occurrence_id"`
		Status       string `json:"answer"`
	}
	if err := rq.decode(&body); err != nil {
		return err
	}
	var reply map[string]any
	err := s.edit(rq.ctx(), rq.Me, func(ed *Edit) error {
		e, err := ed.readableEvent(rq.R.PathValue("id"))
		if err != nil {
			return err
		}
		if !e.isGuest(ed.Actor.ID) {
			return apiErr(403, "not_a_guest", "Only a guest can answer an invitation.")
		}
		errs := map[string]string{}
		key := ""
		switch body.Scope {
		case "series":
		case "occurrence":
			eventID, k := splitOccurrenceID(body.OccurrenceID)
			if eventID != e.ID || (e.recurring() && ed.W.occurrenceAt(e, k) == nil) {
				errs["occurrence_id"] = "Name an occurrence of this event."
			}
			if e.recurring() {
				key = k
			}
		default:
			errs["scope"] = "Use occurrence or series."
		}
		if len(errs) > 0 {
			return fieldErrors(errs)
		}
		if err := ed.setReply(e, ed.Actor.ID, key, body.Status, nil, true); err != nil {
			return err
		}
		reply = map[string]any{"answer": body.Status, "message": nil}
		return ed.changed(e, "reply.changed")
	})
	if err != nil {
		return err
	}
	return rq.json(200, map[string]any{"my_reply": reply})
}
