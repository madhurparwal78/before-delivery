package api

import (
	"context"
	"net/http"
	"time"

	"sundialwren/internal/domain"
)

func (s *Server) handleReply(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	e, _, ok := s.readableEvent(w, r, c)
	if !ok {
		return
	}
	if !e.IsGuest(c.Person.ID) {
		forbidden(w, "not_a_guest")
		return
	}
	var body struct {
		Scope        string `json:"scope"`
		OccurrenceID string `json:"occurrence_id"`
		Answer       string `json:"answer"`
	}
	if readJSON(w, r, &body) != nil {
		return
	}
	switch body.Answer {
	case domain.AnswerYes, domain.AnswerNo, domain.AnswerMaybe:
	default:
		unprocessable(w, map[string]string{"answer": "Answer Yes, No or Maybe."})
		return
	}
	key := domain.OccurrenceKey(e.ID, body.OccurrenceID)
	switch body.Scope {
	case "series":
		if err := s.Store.SetSeriesAnswer(r.Context(), e.ID, c.Person.ID, body.Answer, ""); err != nil {
			s.fail(w, err)
			return
		}
	case "occurrence":
		if key == "" && e.IsSeries() {
			unprocessable(w, map[string]string{"occurrence_id": "Name the occurrence you are answering."})
			return
		}
		if key == "" {
			if err := s.Store.SetSeriesAnswer(r.Context(), e.ID, c.Person.ID, body.Answer, ""); err != nil {
				s.fail(w, err)
				return
			}
		} else if err := s.Store.SetOccurrenceAnswer(r.Context(), e.ID, key, c.Person.ID, body.Answer, ""); err != nil {
			s.fail(w, err)
			return
		}
	default:
		unprocessable(w, map[string]string{"scope": "Answer for this event or all events."})
		return
	}
	if err := s.Store.BumpVersion(r.Context(), e.ID); err != nil {
		s.fail(w, err)
		return
	}
	fresh, err := s.Store.Event(r.Context(), e.ID)
	if err != nil {
		s.fail(w, err)
		return
	}
	s.syncReminders(r.Context(), fresh)
	occurrenceID := ""
	if key != "" {
		occurrenceID = e.ID + "@" + key
	}
	s.publish(r.Context(), changeReply, changeSpec{EventID: e.ID, CalendarID: e.CalendarID, OccurrenceID: occurrenceID})
	answer, message := fresh.ReplyFor(key, c.Person.ID)
	writeJSON(w, http.StatusOK, map[string]any{"my_reply": map[string]any{"answer": answer, "message": message}})
}

func (s *Server) handleAddGuests(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	e, _, ok := s.readableEvent(w, r, c)
	if !ok {
		return
	}
	access := c.Viewer.Access(e)
	if access != domain.AccessFull && !(access == domain.AccessGuest && e.Switches.InviteOthers) {
		forbidden(w, "forbidden")
		return
	}
	var body struct {
		PersonIDs []string `json:"person_ids"`
	}
	if readJSON(w, r, &body) != nil {
		return
	}
	var added []string
	for _, id := range body.PersonIDs {
		if _, err := s.Store.Person(r.Context(), id); err != nil {
			continue
		}
		if e.IsGuest(id) {
			continue
		}
		if err := s.Store.AddGuest(r.Context(), e.ID, id); err != nil {
			s.fail(w, err)
			return
		}
		added = append(added, id)
	}
	if err := s.Store.BumpVersion(r.Context(), e.ID); err != nil {
		s.fail(w, err)
		return
	}
	fresh, err := s.Store.Event(r.Context(), e.ID)
	if err != nil {
		s.fail(w, err)
		return
	}
	s.afterInvite(r.Context(), c, fresh, added)
	s.syncReminders(r.Context(), fresh)
	s.publish(r.Context(), changeEvent, changeSpec{EventID: e.ID, CalendarID: e.CalendarID})
	reloaded, err := s.Store.Event(r.Context(), e.ID)
	if err != nil {
		s.fail(w, err)
		return
	}
	s.withETag(w, reloaded.Version)
	writeJSON(w, http.StatusOK, c.Projector.Event(reloaded, ""))
}

func (s *Server) handleRemoveGuest(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	e, _, ok := s.readableEvent(w, r, c)
	if !ok {
		return
	}
	if c.Viewer.Access(e) != domain.AccessFull {
		forbidden(w, "forbidden")
		return
	}
	personID := pathValue(r, "personID")
	if err := s.Store.RemoveGuest(r.Context(), e.ID, personID); err != nil {
		s.fail(w, err)
		return
	}
	_ = s.Store.CancelReminders(r.Context(), e.ID, nil, &personID)
	if err := s.Store.BumpVersion(r.Context(), e.ID); err != nil {
		s.fail(w, err)
		return
	}
	fresh, err := s.Store.Event(r.Context(), e.ID)
	if err != nil {
		s.fail(w, err)
		return
	}
	s.publish(r.Context(), changeEvent, changeSpec{EventID: e.ID, CalendarID: e.CalendarID})
	s.withETag(w, fresh.Version)
	writeJSON(w, http.StatusOK, c.Projector.Event(fresh, ""))
}

// afterInvite writes each invited person their one notice and checks their
// decline windows.
func (s *Server) afterInvite(ctx context.Context, c *Context, e *domain.Event, invited []string) {
	for _, id := range invited {
		s.notify(ctx, id, noticeInvitation, invitation(c.Person.Name, e.Title), e.ID, "")
		s.publish(ctx, changeDecision, changeSpec{
			EventID:    e.ID,
			DecisionID: newID("inv"),
			Text:       invitation(c.Person.Name, e.Title),
			Audience:   []string{id},
		})
		s.declineForPerson(ctx, c, e, id)
	}
}

// declineForPerson answers no to each occurrence of an event overlapping one
// of that person's decline windows.
func (s *Server) declineForPerson(ctx context.Context, c *Context, e *domain.Event, personID string) {
	horizon := domain.WallFromUTC(c.Now.AddDate(1, 0, 0))
	for _, o := range c.Expander.Expand(e, &horizon, 0) {
		if o.Deleted {
			continue
		}
		s.applyDeclines(ctx, c, e, o.Key, []string{personID}, "")
	}
}

// applyDeclines is the one place an automatic decline is decided. With no
// named people it checks every guest.
func (s *Server) applyDeclines(ctx context.Context, c *Context, e *domain.Event, key string, only []string, exceptPerson string) {
	if e.Kind != domain.KindEvent {
		return
	}
	occ := c.Expander.One(e, key)
	if occ == nil || occ.Deleted {
		return
	}
	start, end := occ.Instants()
	for _, g := range e.Guests {
		if g.PersonID == exceptPerson || (only != nil && !contains(only, g.PersonID)) {
			continue
		}
		if s.ownsCalendar(ctx, g.PersonID, e.CalendarID) {
			continue
		}
		window, message := s.windowCovering(ctx, g.PersonID, e.Title, start, end)
		if window == nil {
			continue
		}
		answer, _ := e.ReplyFor(key, g.PersonID)
		if answer == domain.AnswerNo {
			continue
		}
		if e.IsSeries() {
			_ = s.Store.SetOccurrenceAnswer(ctx, e.ID, key, g.PersonID, domain.AnswerNo, message)
		} else {
			_ = s.Store.SetSeriesAnswer(ctx, e.ID, g.PersonID, domain.AnswerNo, message)
		}
		_ = s.Store.CancelReminders(ctx, e.ID, &key, &g.PersonID)
		s.decide(ctx, e.ID, message, s.decisionAudience(ctx, e, g.PersonID, false))
		s.publish(ctx, changeReply, changeSpec{EventID: e.ID, CalendarID: e.CalendarID, OccurrenceID: e.ID + "@" + key})
	}
}

func (s *Server) ownsCalendar(ctx context.Context, personID, calendarID string) bool {
	cal, err := s.Store.Calendar(ctx, calendarID)
	if err != nil || cal.OwnerID == nil {
		return false
	}
	return *cal.OwnerID == personID
}

// windowCovering finds the first out-of-office or focus window of a person
// overlapping a span, and the message its decline carries.
func (s *Server) windowCovering(ctx context.Context, personID, title string, start, end time.Time) (*domain.Occurrence, string) {
	windows, err := s.Store.DeclineWindows(ctx, personID)
	if err != nil {
		return nil, ""
	}
	person, err := s.Store.Person(ctx, personID)
	if err != nil {
		return nil, ""
	}
	rules, err := s.Store.ZoneRules(ctx)
	if err != nil {
		return nil, ""
	}
	expander := domain.Expander{Rules: rules, Now: s.Clock.Now()}
	for _, window := range windows {
		for _, o := range expander.ExpandRange(window, start, end) {
			windowStart, windowEnd := o.Instants()
			if !windowEnd.After(start) || !windowStart.Before(end) {
				continue
			}
			return o, declineMessageFor(window, o, person, title)
		}
	}
	return nil, ""
}

func declineMessageFor(window *domain.Event, o *domain.Occurrence, person domain.Person, title string) string {
	if window.Kind == domain.KindOutOfOffice {
		if window.DeclineMessage != "" {
			return window.DeclineMessage
		}
		last := o.ShownEnd
		if !window.AllDay {
			last = domain.InZone(*o.EndUTC, person.Zone)
		}
		return outOfOfficeDecline(person.Name, domain.ReadableDate(last), title)
	}
	endsAt := o.ShownEnd.Clock()
	if o.EndUTC != nil {
		endsAt = domain.InZone(*o.EndUTC, person.Zone).Clock()
	}
	return focusTimeDecline(person.Name, endsAt, title)
}

// declineExistingForWindow answers no to every existing meeting a new or moved
// focus window covers, for the person whose window it is.
func (s *Server) declineExistingForWindow(ctx context.Context, c *Context, window *domain.Event) {
	cal, err := s.Store.Calendar(ctx, window.CalendarID)
	if err != nil || cal.OwnerID == nil {
		return
	}
	personID := *cal.OwnerID
	events, err := s.Store.EventsBlocking(ctx, personID)
	if err != nil {
		return
	}
	horizon := domain.WallFromUTC(c.Now.AddDate(1, 0, 0))
	for _, windowOcc := range c.Expander.Expand(window, &horizon, 0) {
		if windowOcc.Deleted {
			continue
		}
		windowStart, windowEnd := windowOcc.Instants()
		for _, e := range events {
			if e.ID == window.ID || !e.IsGuest(personID) || e.Kind != domain.KindEvent {
				continue
			}
			for _, o := range c.Expander.ExpandRange(e, windowStart, windowEnd) {
				s.applyDeclines(ctx, c, e, o.Key, []string{personID}, "")
			}
		}
	}
}

func (s *Server) handleConflicts(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	e, _, ok := s.readableEvent(w, r, c)
	if !ok {
		return
	}
	if e.Kind != domain.KindOutOfOffice || !s.ownsCalendar(r.Context(), c.Person.ID, e.CalendarID) {
		forbidden(w, "forbidden")
		return
	}
	events, err := s.Store.EventsBlocking(r.Context(), c.Person.ID)
	if err != nil {
		s.fail(w, err)
		return
	}
	type row struct {
		EventID    string `json:"event_id"`
		Occurrence string `json:"occurrence_id"`
		Title      string `json:"title"`
		StartLocal string `json:"start_local"`
		Zone       string `json:"zone"`
		Answer     string `json:"answer"`
		start      time.Time
	}
	var rows []row
	horizon := domain.WallFromUTC(c.Now.AddDate(1, 0, 0))
	for _, windowOcc := range c.Expander.Expand(e, &horizon, 0) {
		if windowOcc.Deleted {
			continue
		}
		windowStart, windowEnd := windowOcc.Instants()
		for _, other := range events {
			if other.ID == e.ID || !other.IsGuest(c.Person.ID) || other.Kind != domain.KindEvent {
				continue
			}
			for _, o := range c.Expander.ExpandRange(other, windowStart, windowEnd) {
				answer, _ := other.ReplyFor(o.Key, c.Person.ID)
				start, _ := o.Instants()
				rows = append(rows, row{
					EventID: other.ID, Occurrence: o.ID(), Title: o.Title,
					StartLocal: o.ShownStart.Local(other.AllDay), Zone: other.Zone,
					Answer: answer, start: start,
				})
			}
		}
	}
	for i := 1; i < len(rows); i++ {
		for j := i; j > 0 && rows[j].start.Before(rows[j-1].start); j-- {
			rows[j], rows[j-1] = rows[j-1], rows[j]
		}
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		out = append(out, map[string]any{
			"event_id": row.EventID, "occurrence_id": row.Occurrence, "title": row.Title,
			"start_local": row.StartLocal, "zone": row.Zone, "answer": row.Answer,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"conflicts": out})
}
