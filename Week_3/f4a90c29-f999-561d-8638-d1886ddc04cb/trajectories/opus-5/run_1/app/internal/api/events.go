package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"sundialwren/internal/domain"
	"sundialwren/internal/store"
)

func (s *Server) handleCreateEvent(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	var raw map[string]json.RawMessage
	if readJSON(w, r, &raw) != nil {
		return
	}
	f := fields{raw: raw}
	calendarID := f.str("calendar_id")
	if _, err := s.Store.Calendar(r.Context(), calendarID); err != nil {
		notFound(w)
		return
	}
	if !c.Viewer.CanEditCalendar(calendarID) {
		forbidden(w, "forbidden")
		return
	}
	cal, err := s.Store.Calendar(r.Context(), calendarID)
	if err != nil {
		s.fail(w, err)
		return
	}
	now := s.Clock.Now()
	e := &domain.Event{
		ID:          newID("evt"),
		CalendarID:  calendarID,
		Kind:        domain.KindEvent,
		Colour:      "Calendar colour",
		Zone:        c.Person.Zone,
		Visibility:  domain.VisibilityDefault,
		Reminders:   []int{},
		Switches:    c.Settings.GuestDefaults,
		Version:     1,
		SavedAt:     now,
		SavedByID:   c.Person.ID,
		OrganiserID: c.Person.ID,
	}
	e.SeriesID = e.ID
	if cal.OwnerID != nil {
		e.OrganiserID = *cal.OwnerID
	}
	if errs := f.apply(e, c.Settings); errs != nil {
		unprocessable(w, errs)
		return
	}
	if !f.has("reminders") && !e.AllDay {
		e.Reminders = cal.DefaultReminders
	}
	if err := s.Store.InsertEvent(r.Context(), e); err != nil {
		s.fail(w, err)
		return
	}
	guestIDs := f.strings("guest_ids")
	for _, id := range guestIDs {
		if _, err := s.Store.Person(r.Context(), id); err != nil {
			continue
		}
		if err := s.Store.AddGuest(r.Context(), e.ID, id); err != nil {
			s.fail(w, err)
			return
		}
	}
	fresh, err := s.Store.Event(r.Context(), e.ID)
	if err != nil {
		s.fail(w, err)
		return
	}
	s.afterInvite(r.Context(), c, fresh, guestIDs)
	s.syncReminders(r.Context(), fresh)
	if fresh.Kind == domain.KindFocusTime && fresh.DeclineMode == domain.DeclineNewAndExisting {
		s.declineExistingForWindow(r.Context(), c, fresh)
	}
	s.publish(r.Context(), changeEvent, changeSpec{EventID: e.ID, CalendarID: e.CalendarID})
	reloaded, err := s.Store.Event(r.Context(), e.ID)
	if err != nil {
		s.fail(w, err)
		return
	}
	s.withETag(w, reloaded.Version)
	writeJSON(w, http.StatusCreated, c.Projector.Event(reloaded, ""))
}

func (s *Server) handleGetEvent(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	e, key, ok := s.readableEvent(w, r, c)
	if !ok {
		return
	}
	s.withETag(w, e.Version)
	writeJSON(w, http.StatusOK, c.Projector.Event(e, key))
}

// readableEvent loads the event in the address, answering 404 when the caller
// cannot read it at all.
func (s *Server) readableEvent(w http.ResponseWriter, r *http.Request, c *Context) (*domain.Event, string, bool) {
	id := pathValue(r, "id")
	e, err := s.Store.Event(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		notFound(w)
		return nil, "", false
	}
	if err != nil {
		s.fail(w, err)
		return nil, "", false
	}
	if !c.Viewer.CanRead(e) {
		notFound(w)
		return nil, "", false
	}
	key := domain.OccurrenceKey(e.ID, r.URL.Query().Get("occurrence_id"))
	return e, key, true
}

func (s *Server) handlePatchEvent(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	id := pathValue(r, "id")
	e, err := s.Store.Event(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		notFound(w)
		return
	}
	if err != nil {
		s.fail(w, err)
		return
	}
	if !c.Viewer.CanRead(e) {
		notFound(w)
		return
	}
	if !c.Viewer.CanEdit(e) {
		forbidden(w, "forbidden")
		return
	}
	var raw map[string]json.RawMessage
	if readJSON(w, r, &raw) != nil {
		return
	}
	f := fields{raw: raw}
	if c.Viewer.Access(e) == domain.AccessGuest {
		// Modify event lets a guest change these fields and nothing else.
		allowed := map[string]bool{"title": true, "location": true, "notes": true,
			"start_local": true, "end_local": true, "rrule": true, "all_day": true,
			"scope": true, "occurrence_id": true, "zone": true}
		for name := range raw {
			if !allowed[name] {
				forbidden(w, "forbidden")
				return
			}
		}
	}
	version, ok := ifMatch(w, r)
	if !ok {
		return
	}
	scope := f.str("scope")
	key := domain.OccurrenceKey(e.ID, f.str("occurrence_id"))
	if e.IsSeries() {
		switch scope {
		case domain.ScopeThis, domain.ScopeFollowing, domain.ScopeAll:
		default:
			unprocessable(w, map[string]string{"scope": "Choose this event, this and following events or all events."})
			return
		}
		if key == "" && scope != domain.ScopeAll {
			unprocessable(w, map[string]string{"occurrence_id": "Name the occurrence you are changing."})
			return
		}
		if x := e.Exception(key); x != nil && x.Deleted {
			notFound(w)
			return
		}
	} else {
		scope = domain.ScopeAll
		key = ""
	}
	if e.TrashedAt != nil {
		writeError(w, http.StatusConflict, "trashed", "That event is in the trash.", nil)
		return
	}

	switch scope {
	case domain.ScopeThis:
		s.patchOccurrence(w, r, c, e, key, f, version)
	case domain.ScopeFollowing:
		s.patchFollowing(w, r, c, e, key, f, version)
	default:
		s.patchSeries(w, r, c, e, key, f, version)
	}
}

// patchSeries applies a change to a whole series or single event, leaving each
// exception's own overridden values in place unless that field is the one
// being edited.
func (s *Server) patchSeries(w http.ResponseWriter, r *http.Request, c *Context, e *domain.Event, key string, f fields, version int) {
	updated := *e
	if errs := f.apply(&updated, c.Settings); errs != nil {
		unprocessable(w, errs)
		return
	}
	updated.SavedAt = s.Clock.Now()
	updated.SavedByID = c.Person.ID
	saved, err := s.Store.UpdateEvent(r.Context(), &updated, version)
	if err != nil {
		s.fail(w, err)
		return
	}
	if !saved {
		s.answerConflict(w, r, c, e.ID, key)
		return
	}
	// An exception keeps every value it overrode, except a field this save is
	// itself editing, which takes the new value.
	for _, x := range e.Exceptions {
		if x.Deleted {
			continue
		}
		for _, field := range []string{"title", "location", "notes"} {
			if f.has(field) {
				_ = s.Store.ClearExceptionField(r.Context(), e.ID, x.Key, field)
			}
		}
		if f.touchesTime() {
			_ = s.Store.ClearExceptionField(r.Context(), e.ID, x.Key, "start_local")
			_ = s.Store.ClearExceptionField(r.Context(), e.ID, x.Key, "end_local")
		}
	}
	if f.has("switches") && !updated.Switches.SeeGuestList && e.Link != nil {
		// A link dies for good when See guest list is turned off.
		_ = s.Store.DeleteShareLink(r.Context(), e.ID)
	}
	if f.has("rrule") {
		s.dropUnfittingExceptions(r.Context(), &updated)
	}
	s.afterSave(w, r, c, e.ID, key, f.touchesTime(), domain.ScopeAll)
}

// patchOccurrence writes one occurrence's own values as an exception.
func (s *Server) patchOccurrence(w http.ResponseWriter, r *http.Request, c *Context, e *domain.Event, key string, f fields, version int) {
	occ := c.Expander.One(e, key)
	if occ == nil {
		notFound(w)
		return
	}
	probe := *e
	probe.StartLocal = occ.ShownStart.Local(e.AllDay)
	probe.EndLocal = occ.ShownEnd.Local(e.AllDay)
	probe.RRule = ""
	if errs := f.apply(&probe, c.Settings); errs != nil {
		unprocessable(w, errs)
		return
	}
	unchanged := *e
	unchanged.SavedAt = s.Clock.Now()
	unchanged.SavedByID = c.Person.ID
	saved, err := s.Store.UpdateEvent(r.Context(), &unchanged, version)
	if err != nil {
		s.fail(w, err)
		return
	}
	if !saved {
		s.answerConflict(w, r, c, e.ID, key)
		return
	}
	x := domain.Exception{Key: key}
	if f.touchesTime() {
		start := s.savedClockOf(e, probe.StartLocal, occ)
		end := s.savedClockOf(e, probe.EndLocal, occ)
		x.StartLocal, x.EndLocal = &start, &end
	}
	if f.has("title") {
		title := probe.Title
		x.Title = &title
	}
	if f.has("location") {
		location := probe.Location
		x.Location = &location
	}
	if f.has("notes") {
		notes := probe.Notes
		x.Notes = &notes
	}
	if err := s.Store.PutException(r.Context(), e.ID, x); err != nil {
		s.fail(w, err)
		return
	}
	s.afterSave(w, r, c, e.ID, key, f.touchesTime(), domain.ScopeThis)
}

// savedClockOf reads a submitted clock time, which on a warned occurrence is
// read as a shown time and stored back at its saved offset.
func (s *Server) savedClockOf(e *domain.Event, local string, occ *domain.Occurrence) string {
	if occ.Warning == nil || e.AllDay {
		return local
	}
	w, err := domain.ParseLocal(local, e.AllDay)
	if err != nil {
		return local
	}
	return w.AddMinutes(-occ.Warning.ShiftMinutes).Local(e.AllDay)
}

// patchFollowing ends the series on the day before an occurrence and starts a
// new one there with the change.
func (s *Server) patchFollowing(w http.ResponseWriter, r *http.Request, c *Context, e *domain.Event, key string, f fields, version int) {
	first := c.Expander.Expand(e, nil, 1)
	if len(first) == 1 && first[0].Key == key {
		s.patchSeries(w, r, c, e, key, f, version)
		return
	}
	occ := c.Expander.One(e, key)
	if occ == nil {
		notFound(w)
		return
	}
	later := *e
	later.StartLocal = occ.SavedStart.Local(e.AllDay)
	later.EndLocal = occ.SavedEnd.Local(e.AllDay)
	if errs := f.apply(&later, c.Settings); errs != nil {
		unprocessable(w, errs)
		return
	}
	splitDate, err := domain.ParseLocal(occ.SavedStart.Date(), true)
	if err != nil {
		s.fail(w, err)
		return
	}
	earlier := *e
	until := splitDate.AddDays(-1).Date()
	earlier.SeriesUntil = &until
	earlier.SavedAt = s.Clock.Now()
	earlier.SavedByID = c.Person.ID
	saved, err := s.Store.UpdateEvent(r.Context(), &earlier, version)
	if err != nil {
		s.fail(w, err)
		return
	}
	if !saved {
		s.answerConflict(w, r, c, e.ID, key)
		return
	}
	generatedBefore := len(c.Expander.Expand(&earlier, nil, 0))
	later.ID = newID("evt")
	later.SplitFrom = &e.ID
	later.SeriesUntil = nil
	later.Version = 1
	later.SavedAt = s.Clock.Now()
	later.SavedByID = c.Person.ID
	later.RRule = remainingRule(later.RRule, generatedBefore)
	if err := s.Store.InsertEvent(r.Context(), &later); err != nil {
		s.fail(w, err)
		return
	}
	if err := s.Store.CopyGuests(r.Context(), e.ID, later.ID); err != nil {
		s.fail(w, err)
		return
	}
	if err := s.Store.CopyZoneMoves(r.Context(), e.ID, later.ID); err != nil {
		s.fail(w, err)
		return
	}
	s.moveDatedRecords(r.Context(), c, e, &later, key)
	s.afterSave(w, r, c, later.ID, "", f.touchesTime(), domain.ScopeFollowing)
	s.publish(r.Context(), changeEvent, changeSpec{EventID: e.ID, CalendarID: e.CalendarID})
}

// moveDatedRecords moves every exception, per-occurrence answer and open
// proposal dated on or after the split to the new series, on the same date.
func (s *Server) moveDatedRecords(ctx context.Context, c *Context, from, to *domain.Event, splitKey string) {
	keyByDate := map[string]string{}
	for _, o := range c.Expander.Expand(to, nil, 0) {
		if _, ok := keyByDate[o.SavedStart.Date()]; !ok {
			keyByDate[o.SavedStart.Date()] = o.Key
		}
	}
	rekey := func(oldKey string) string {
		w, err := domain.ParseLocal(oldKey[:4]+"-"+oldKey[4:6]+"-"+oldKey[6:8], true)
		if err != nil {
			return oldKey
		}
		if newKey, ok := keyByDate[w.Date()]; ok {
			return newKey
		}
		return oldKey
	}
	for _, x := range from.Exceptions {
		if x.Key < splitKey {
			continue
		}
		moved := x
		moved.Key = rekey(x.Key)
		_ = s.Store.DeleteException(ctx, from.ID, x.Key)
		_ = s.Store.PutException(ctx, to.ID, moved)
	}
	for _, reply := range from.Replies {
		if reply.Key < splitKey {
			continue
		}
		_ = s.Store.SetOccurrenceAnswer(ctx, to.ID, rekey(reply.Key), reply.PersonID, reply.Answer, reply.Message)
	}
	for _, p := range from.Proposals {
		if p.Key < splitKey || p.Status != domain.ProposalProposed {
			continue
		}
		_ = s.Store.MoveProposal(ctx, p.ID, to.ID, rekey(p.Key))
	}
	for _, reply := range from.Replies {
		if reply.Key >= splitKey {
			_ = s.Store.ClearOneAnswer(ctx, from.ID, reply.Key, reply.PersonID)
		}
	}
}

// remainingRule divides a COUNT between an earlier and a later series.
func remainingRule(rule string, generatedBefore int) string {
	if rule == "" || !strings.Contains(rule, "COUNT=") {
		return rule
	}
	parsed, err := domain.ParseRRule(rule, domain.Wall{Y: 2000, M: 1, D: 1, H: 0, Min: 0})
	remaining := 0
	if err == nil {
		remaining = parsed.Count - generatedBefore
	}
	parts := strings.Split(rule, ";")
	for i, part := range parts {
		if strings.HasPrefix(part, "COUNT=") {
			if remaining < 1 {
				remaining = 1
			}
			parts[i] = "COUNT=" + itoa(remaining)
		}
	}
	return strings.Join(parts, ";")
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	digits := ""
	for n > 0 {
		digits = string(rune('0'+n%10)) + digits
		n /= 10
	}
	return digits
}

// dropUnfittingExceptions keeps a modified exception whose date no longer fits
// a changed rule as a standalone occurrence and drops a deleted one.
func (s *Server) dropUnfittingExceptions(ctx context.Context, e *domain.Event) {
	fresh, err := s.Store.Event(ctx, e.ID)
	if err != nil {
		return
	}
	expander := domain.Expander{Rules: nil, Now: s.Clock.Now()}
	fits := map[string]bool{}
	for _, o := range expander.Expand(fresh, nil, 0) {
		fits[o.Key] = true
	}
	for _, x := range fresh.Exceptions {
		if fits[x.Key] {
			continue
		}
		if x.Deleted {
			_ = s.Store.DeleteException(ctx, e.ID, x.Key)
			continue
		}
		s.standalone(ctx, fresh, x)
	}
}

// standalone turns an exception the rule no longer reaches into its own event.
func (s *Server) standalone(ctx context.Context, e *domain.Event, x domain.Exception) {
	alone := *e
	alone.ID = newID("evt")
	alone.SplitFrom = &e.ID
	alone.RRule = ""
	alone.SeriesUntil = nil
	alone.Version = 1
	if x.StartLocal != nil {
		alone.StartLocal = *x.StartLocal
	}
	if x.EndLocal != nil {
		alone.EndLocal = *x.EndLocal
	}
	if x.Title != nil {
		alone.Title = *x.Title
	}
	if x.Location != nil {
		alone.Location = *x.Location
	}
	if x.Notes != nil {
		alone.Notes = *x.Notes
	}
	if err := s.Store.InsertEvent(ctx, &alone); err != nil {
		return
	}
	_ = s.Store.CopyGuests(ctx, e.ID, alone.ID)
	_ = s.Store.DeleteException(ctx, e.ID, x.Key)
}

// afterSave settles the replies, declines and reminders a save changes, then
// answers with the saved event.
func (s *Server) afterSave(w http.ResponseWriter, r *http.Request, c *Context, eventID, key string, timeChanged bool, scope string) {
	ctx := r.Context()
	fresh, err := s.Store.Event(ctx, eventID)
	if err != nil {
		s.fail(w, err)
		return
	}
	if timeChanged {
		s.reopenReplies(ctx, c, fresh, key, scope, "")
	}
	s.syncReminders(ctx, fresh)
	if fresh.Kind == domain.KindFocusTime && fresh.DeclineMode == domain.DeclineNewAndExisting {
		s.declineExistingForWindow(ctx, c, fresh)
	}
	occurrenceID := ""
	if key != "" {
		occurrenceID = eventID + "@" + key
	}
	s.publish(ctx, changeEvent, changeSpec{EventID: eventID, CalendarID: fresh.CalendarID, OccurrenceID: occurrenceID})
	reloaded, err := s.Store.Event(ctx, eventID)
	if err != nil {
		s.fail(w, err)
		return
	}
	body := map[string]any{"event": c.Projector.Event(reloaded, key), "split": nil}
	if scope == domain.ScopeFollowing && reloaded.SplitFrom != nil {
		body["split"] = map[string]any{"earlier_id": *reloaded.SplitFrom, "later_id": reloaded.ID}
	}
	s.withETag(w, reloaded.Version)
	writeJSON(w, http.StatusOK, body)
}

func (s *Server) answerConflict(w http.ResponseWriter, r *http.Request, c *Context, eventID, key string) {
	winner, err := s.Store.Event(r.Context(), eventID)
	if err != nil {
		s.fail(w, err)
		return
	}
	s.conflict(w, c, winner, key)
}

// reopenReplies returns the guests of changed occurrences to waiting and
// rechecks the decline windows.
func (s *Server) reopenReplies(ctx context.Context, c *Context, e *domain.Event, key, scope, exceptPerson string) {
	var keys []string
	if scope == domain.ScopeThis && key != "" {
		keys = []string{key}
	} else {
		_ = s.Store.ClearAllAnswers(ctx, e.ID)
		for _, g := range e.Guests {
			if g.PersonID == exceptPerson {
				continue
			}
			_ = s.Store.SetSeriesAnswer(ctx, e.ID, g.PersonID, domain.AnswerInvited, "")
		}
		horizon := domain.WallFromUTC(c.Now.AddDate(1, 0, 0))
		for _, o := range c.Expander.Expand(e, &horizon, 0) {
			if !o.Deleted {
				keys = append(keys, o.Key)
			}
		}
	}
	for _, k := range keys {
		for _, g := range e.Guests {
			if g.PersonID == exceptPerson {
				continue
			}
			if scope == domain.ScopeThis {
				_ = s.Store.SetOccurrenceAnswer(ctx, e.ID, k, g.PersonID, domain.AnswerInvited, "")
			}
		}
	}
	fresh, err := s.Store.Event(ctx, e.ID)
	if err != nil {
		return
	}
	for _, k := range keys {
		s.applyDeclines(ctx, c, fresh, k, nil, exceptPerson)
	}
	s.publish(ctx, changeReply, changeSpec{EventID: e.ID, CalendarID: e.CalendarID})
}

func (s *Server) handleDeleteEvent(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	id := pathValue(r, "id")
	e, err := s.Store.Event(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		notFound(w)
		return
	}
	if err != nil {
		s.fail(w, err)
		return
	}
	if !c.Viewer.CanRead(e) {
		notFound(w)
		return
	}
	if c.Viewer.Access(e) != domain.AccessFull {
		forbidden(w, "forbidden")
		return
	}
	version, ok := ifMatch(w, r)
	if !ok {
		return
	}
	scope := r.URL.Query().Get("scope")
	key := domain.OccurrenceKey(e.ID, r.URL.Query().Get("occurrence_id"))
	if !e.IsSeries() {
		scope = domain.ScopeAll
		key = ""
	}
	if e.IsSeries() {
		switch scope {
		case domain.ScopeThis, domain.ScopeFollowing, domain.ScopeAll:
		default:
			unprocessable(w, map[string]string{"scope": "Choose this event, this and following events or all events."})
			return
		}
		if key == "" && scope != domain.ScopeAll {
			unprocessable(w, map[string]string{"occurrence_id": "Name the occurrence you are deleting."})
			return
		}
		if x := e.Exception(key); x != nil && x.Deleted {
			notFound(w)
			return
		}
	}
	now := s.Clock.Now()
	purgeAt := now.Add(s.Config.TrashRetention)
	trashID := newID("trh")

	switch scope {
	case domain.ScopeThis:
		occ := c.Expander.One(e, key)
		if occ == nil {
			notFound(w)
			return
		}
		unchanged := *e
		unchanged.SavedAt = now
		unchanged.SavedByID = c.Person.ID
		saved, err := s.Store.UpdateEvent(r.Context(), &unchanged, version)
		if err != nil {
			s.fail(w, err)
			return
		}
		if !saved {
			s.answerConflict(w, r, c, e.ID, key)
			return
		}
		if err := s.Store.PutException(r.Context(), e.ID, domain.Exception{Key: key, Deleted: true}); err != nil {
			s.fail(w, err)
			return
		}
		_ = s.Store.CancelReminders(r.Context(), e.ID, &key, nil)
		if err := s.Store.InsertTrashItem(r.Context(), store.TrashItem{
			ID: trashID, Kind: "occurrence", EventID: e.ID, Key: key, Title: occ.Title, CalendarID: e.CalendarID,
		}, now, purgeAt); err != nil {
			s.fail(w, err)
			return
		}
		s.publish(r.Context(), changeDeleted, changeSpec{EventID: e.ID, OccurrenceID: e.ID + "@" + key, CalendarID: e.CalendarID})
		s.publish(r.Context(), changeEvent, changeSpec{EventID: e.ID, CalendarID: e.CalendarID})
	case domain.ScopeFollowing:
		first := c.Expander.Expand(e, nil, 1)
		if len(first) == 1 && first[0].Key == key {
			s.trashWholeEvent(w, r, c, e, version, trashID, now, purgeAt)
			return
		}
		occ := c.Expander.One(e, key)
		if occ == nil {
			notFound(w)
			return
		}
		splitDate, _ := domain.ParseLocal(occ.SavedStart.Date(), true)
		later := *e
		later.ID = newID("evt")
		later.SplitFrom = &e.ID
		later.StartLocal = occ.SavedStart.Local(e.AllDay)
		later.EndLocal = occ.SavedEnd.Local(e.AllDay)
		later.Version = 1
		later.SavedAt = now
		later.SavedByID = c.Person.ID
		earlier := *e
		until := splitDate.AddDays(-1).Date()
		earlier.SeriesUntil = &until
		earlier.SavedAt = now
		earlier.SavedByID = c.Person.ID
		saved, err := s.Store.UpdateEvent(r.Context(), &earlier, version)
		if err != nil {
			s.fail(w, err)
			return
		}
		if !saved {
			s.answerConflict(w, r, c, e.ID, key)
			return
		}
		generatedBefore := len(c.Expander.Expand(&earlier, nil, 0))
		later.RRule = remainingRule(later.RRule, generatedBefore)
		trashedAt := now
		later.TrashedAt = &trashedAt
		if err := s.Store.InsertEvent(r.Context(), &later); err != nil {
			s.fail(w, err)
			return
		}
		_ = s.Store.CopyGuests(r.Context(), e.ID, later.ID)
		_ = s.Store.CopyZoneMoves(r.Context(), e.ID, later.ID)
		s.moveDatedRecords(r.Context(), c, e, &later, key)
		_ = s.Store.SetTrashed(r.Context(), later.ID, &trashedAt)
		_ = s.Store.CancelReminders(r.Context(), later.ID, nil, nil)
		if err := s.Store.InsertTrashItem(r.Context(), store.TrashItem{
			ID: trashID, Kind: "series", EventID: later.ID, Title: e.Title, CalendarID: e.CalendarID,
		}, now, purgeAt); err != nil {
			s.fail(w, err)
			return
		}
		s.publish(r.Context(), changeEvent, changeSpec{EventID: e.ID, CalendarID: e.CalendarID})
		s.publish(r.Context(), changeDeleted, changeSpec{EventID: later.ID, CalendarID: e.CalendarID})
	default:
		s.trashWholeEvent(w, r, c, e, version, trashID, now, purgeAt)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"trash_id": trashID})
}

func (s *Server) trashWholeEvent(w http.ResponseWriter, r *http.Request, c *Context, e *domain.Event, version int, trashID string, now, purgeAt time.Time) {
	trashed := *e
	trashed.TrashedAt = &now
	trashed.SavedAt = now
	trashed.SavedByID = c.Person.ID
	saved, err := s.Store.UpdateEvent(r.Context(), &trashed, version)
	if err != nil {
		s.fail(w, err)
		return
	}
	if !saved {
		s.answerConflict(w, r, c, e.ID, "")
		return
	}
	kind := "event"
	if e.IsSeries() {
		kind = "series"
	}
	_ = s.Store.CancelReminders(r.Context(), e.ID, nil, nil)
	if err := s.Store.InsertTrashItem(r.Context(), store.TrashItem{
		ID: trashID, Kind: kind, EventID: e.ID, Title: e.Title, CalendarID: e.CalendarID,
	}, now, purgeAt); err != nil {
		s.fail(w, err)
		return
	}
	s.publish(r.Context(), changeDeleted, changeSpec{EventID: e.ID, CalendarID: e.CalendarID})
	writeJSON(w, http.StatusOK, map[string]any{"trash_id": trashID})
}

func (s *Server) handleDuplicate(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	e, _, ok := s.readableEvent(w, r, c)
	if !ok {
		return
	}
	if c.Viewer.Access(e) == domain.AccessBusy {
		forbidden(w, "forbidden")
		return
	}
	copyOf := *e
	copyOf.ID = newID("evt")
	copyOf.SeriesID = copyOf.ID
	copyOf.SplitFrom = nil
	copyOf.Title = e.Title + " copy"
	copyOf.Version = 1
	copyOf.SavedAt = s.Clock.Now()
	copyOf.SavedByID = c.Person.ID
	copyOf.Switches = c.Settings.GuestDefaults
	copyOf.SeriesUntil = e.SeriesUntil
	if !c.Viewer.CanEditCalendar(e.CalendarID) {
		own := "cal-" + strings.TrimPrefix(c.Person.ID, "p-")
		if !c.Viewer.CanEditCalendar(own) {
			forbidden(w, "forbidden")
			return
		}
		copyOf.CalendarID = own
		copyOf.OrganiserID = c.Person.ID
	}
	if err := s.Store.InsertEvent(r.Context(), &copyOf); err != nil {
		s.fail(w, err)
		return
	}
	fresh, err := s.Store.Event(r.Context(), copyOf.ID)
	if err != nil {
		s.fail(w, err)
		return
	}
	s.syncReminders(r.Context(), fresh)
	s.publish(r.Context(), changeEvent, changeSpec{EventID: fresh.ID, CalendarID: fresh.CalendarID})
	s.withETag(w, fresh.Version)
	writeJSON(w, http.StatusCreated, c.Projector.Event(fresh, ""))
}

func (s *Server) handleMoveCalendar(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	id := pathValue(r, "id")
	e, err := s.Store.Event(r.Context(), id)
	if err != nil {
		notFound(w)
		return
	}
	if !c.Viewer.CanRead(e) {
		notFound(w)
		return
	}
	var body struct {
		CalendarID string `json:"calendar_id"`
	}
	if readJSON(w, r, &body) != nil {
		return
	}
	if !c.Viewer.CanEditCalendar(e.CalendarID) || !c.Viewer.CanEditCalendar(body.CalendarID) {
		forbidden(w, "forbidden")
		return
	}
	version, ok := ifMatch(w, r)
	if !ok {
		return
	}
	target, err := s.Store.Calendar(r.Context(), body.CalendarID)
	if err != nil {
		notFound(w)
		return
	}
	moved := *e
	moved.CalendarID = body.CalendarID
	moved.SavedAt = s.Clock.Now()
	moved.SavedByID = c.Person.ID
	if target.OwnerID != nil {
		moved.OrganiserID = *target.OwnerID
	}
	saved, err := s.Store.UpdateEvent(r.Context(), &moved, version)
	if err != nil {
		s.fail(w, err)
		return
	}
	if !saved {
		s.answerConflict(w, r, c, e.ID, "")
		return
	}
	if err := s.Store.SetOrganiser(r.Context(), e.ID, moved.OrganiserID); err != nil {
		s.fail(w, err)
		return
	}
	fresh, err := s.Store.Event(r.Context(), e.ID)
	if err != nil {
		s.fail(w, err)
		return
	}
	s.syncReminders(r.Context(), fresh)
	s.publish(r.Context(), changeEvent, changeSpec{EventID: fresh.ID, CalendarID: fresh.CalendarID})
	s.withETag(w, fresh.Version)
	writeJSON(w, http.StatusOK, c.Projector.Event(fresh, ""))
}
