package api

import (
	"context"
	"net/http"

	"sundialwren/internal/domain"
	"sundialwren/internal/store"
)

func (s *Server) handleCreateShareLink(w http.ResponseWriter, r *http.Request) {
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
	if !e.Switches.SeeGuestList {
		writeError(w, http.StatusConflict, "guest_list_hidden", "Turn See guest list on before making a shared link.", nil)
		return
	}
	if e.Visibility == domain.VisibilityPrivate {
		writeError(w, http.StatusConflict, "private_event", "A private event cannot carry a shared link.", nil)
		return
	}
	token := store.NewToken()
	expires := s.Clock.Now().Add(s.Config.ShareLinkTTL)
	if err := s.Store.PutShareLink(r.Context(), e.ID, token, expires); err != nil {
		s.fail(w, err)
		return
	}
	s.publish(r.Context(), changeEvent, changeSpec{EventID: e.ID, CalendarID: e.CalendarID})
	writeJSON(w, http.StatusCreated, domain.ShareLink{Token: token, URL: "/share/" + token, ExpiresAt: expires})
}

func (s *Server) handleDeleteShareLink(w http.ResponseWriter, r *http.Request) {
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
	if err := s.Store.DeleteShareLink(r.Context(), e.ID); err != nil {
		s.fail(w, err)
		return
	}
	s.publish(r.Context(), changeEvent, changeSpec{EventID: e.ID, CalendarID: e.CalendarID})
	writeJSON(w, http.StatusNoContent, nil)
}

// handleSharedEvent answers a shared link, a read-only page. A dead or unknown
// token answers exactly as the other.
func (s *Server) handleSharedEvent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "read_only", "A shared link is read only.", nil)
		return
	}
	e, err := s.Store.EventByShareToken(r.Context(), pathValue(r, "token"))
	if err != nil || e.Link == nil || e.TrashedAt != nil ||
		!e.Switches.SeeGuestList || e.Visibility == domain.VisibilityPrivate ||
		!s.Clock.Now().Before(e.Link.ExpiresAt) {
		writeError(w, http.StatusNotFound, "not_found", deadLinkMessage, nil)
		return
	}
	settings, err := s.Store.Settings(r.Context())
	if err != nil {
		s.fail(w, err)
		return
	}
	rules, err := s.Store.ZoneRules(r.Context())
	if err != nil {
		s.fail(w, err)
		return
	}
	expander := domain.Expander{Rules: rules, Now: s.Clock.Now()}
	start, _ := domain.ParseLocal(e.StartLocal, e.AllDay)
	occ := expander.One(e, start.Key())
	guests := make([]map[string]any, 0, len(e.Guests))
	for _, g := range e.Guests {
		answer, _ := e.ReplyFor("", g.PersonID)
		guests = append(guests, map[string]any{"name": g.Name, "answer": answer})
	}
	clocks := domain.OccurrenceClocks(occ, settings)
	writeJSON(w, http.StatusOK, map[string]any{
		"title": e.Title, "location": e.Location, "organiser_name": e.OrganiserName,
		"all_day": e.AllDay, "start_local": occ.ShownStart.Local(e.AllDay),
		"end_local": occ.ShownEnd.Local(e.AllDay), "zone": e.Zone,
		"clocks": clocks, "guests": guests,
	})
}

// handleZoneMove returns an event's warned occurrences to their saved clock
// time, as This and following from the first of them.
func (s *Server) handleZoneMove(w http.ResponseWriter, r *http.Request) {
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
	if c.Viewer.Access(e) != domain.AccessFull {
		forbidden(w, "forbidden")
		return
	}
	var body struct {
		RuleID string `json:"rule_id"`
	}
	if readJSON(w, r, &body) != nil {
		return
	}
	version, ok := ifMatch(w, r)
	if !ok {
		return
	}
	if c.Rules.ByID(body.RuleID) == nil {
		notFound(w)
		return
	}
	warned := c.Expander.FirstWarned(e, body.RuleID)
	if warned == nil {
		writeError(w, http.StatusConflict, "not_warned", "That event carries no warning for this rule.", nil)
		return
	}
	first := c.Expander.Expand(e, nil, 1)
	splitHere := e.IsSeries() && len(first) == 1 && first[0].Key != warned.Key
	target := e
	body2 := map[string]any{"split": nil}
	if splitHere {
		later, err := s.splitForMove(r.Context(), c, e, warned.Key, version)
		if err != nil {
			s.fail(w, err)
			return
		}
		if later == nil {
			s.answerConflict(w, r, c, e.ID, warned.Key)
			return
		}
		target = later
		body2["split"] = map[string]any{"earlier_id": e.ID, "later_id": later.ID}
	} else {
		unchanged := *e
		unchanged.SavedAt = e.SavedAt
		unchanged.SavedByID = c.Person.ID
		saved, err := s.Store.UpdateEvent(r.Context(), &unchanged, version)
		if err != nil {
			s.fail(w, err)
			return
		}
		if !saved {
			s.answerConflict(w, r, c, e.ID, warned.Key)
			return
		}
	}
	if err := s.Store.InsertZoneMove(r.Context(), target.ID, body.RuleID); err != nil {
		s.fail(w, err)
		return
	}
	fresh, err := s.Store.Event(r.Context(), target.ID)
	if err != nil {
		s.fail(w, err)
		return
	}
	s.syncReminders(r.Context(), fresh)
	s.publish(r.Context(), changeEvent, changeSpec{EventID: fresh.ID, CalendarID: fresh.CalendarID})
	if fresh.ID != e.ID {
		s.publish(r.Context(), changeEvent, changeSpec{EventID: e.ID, CalendarID: e.CalendarID})
	}
	body2["event"] = c.Projector.Event(fresh, "")
	s.withETag(w, fresh.Version)
	writeJSON(w, http.StatusOK, body2)
}

// splitForMove ends a series the day before its first warned occurrence and
// starts a new one there, the same way This and following does.
func (s *Server) splitForMove(ctx context.Context, c *Context, e *domain.Event, key string, version int) (*domain.Event, error) {
	occ := c.Expander.One(e, key)
	splitDate, err := domain.ParseLocal(occ.SavedStart.Date(), true)
	if err != nil {
		return nil, err
	}
	earlier := *e
	until := splitDate.AddDays(-1).Date()
	earlier.SeriesUntil = &until
	earlier.SavedAt = e.SavedAt
	earlier.SavedByID = c.Person.ID
	saved, err := s.Store.UpdateEvent(ctx, &earlier, version)
	if err != nil {
		return nil, err
	}
	if !saved {
		return nil, nil
	}
	generatedBefore := len(c.Expander.Expand(&earlier, nil, 0))
	later := *e
	later.ID = newID("evt")
	later.SplitFrom = &e.ID
	later.SeriesUntil = nil
	later.StartLocal = occ.SavedStart.Local(e.AllDay)
	later.EndLocal = occ.SavedEnd.Local(e.AllDay)
	later.Version = 1
	later.SavedAt = e.SavedAt
	later.SavedByID = c.Person.ID
	later.RRule = remainingRule(later.RRule, generatedBefore)
	if err := s.Store.InsertEvent(ctx, &later); err != nil {
		return nil, err
	}
	if err := s.Store.CopyGuests(ctx, e.ID, later.ID); err != nil {
		return nil, err
	}
	if err := s.Store.CopyZoneMoves(ctx, e.ID, later.ID); err != nil {
		return nil, err
	}
	s.moveDatedRecords(ctx, c, e, &later, key)
	return &later, nil
}
