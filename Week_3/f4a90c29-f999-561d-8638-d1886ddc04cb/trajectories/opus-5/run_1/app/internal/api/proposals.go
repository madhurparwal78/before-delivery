package api

import (
	"context"
	"net/http"

	"sundialwren/internal/domain"
)

func (s *Server) handleProposal(w http.ResponseWriter, r *http.Request) {
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
		OccurrenceID string `json:"occurrence_id"`
		StartLocal   string `json:"start_local"`
		EndLocal     string `json:"end_local"`
		Note         string `json:"note"`
	}
	if readJSON(w, r, &body) != nil {
		return
	}
	key := domain.OccurrenceKey(e.ID, body.OccurrenceID)
	if e.IsSeries() && key == "" {
		unprocessable(w, map[string]string{"occurrence_id": "Name the occurrence you are proposing for."})
		return
	}
	format := dateTimeFormat
	if e.AllDay {
		format = dateFormat
	}
	start, startErr := domain.ParseLocal(body.StartLocal, e.AllDay)
	end, endErr := domain.ParseLocal(body.EndLocal, e.AllDay)
	fieldErrs := map[string]string{}
	if startErr != nil {
		fieldErrs["start_local"] = format
	}
	if endErr != nil {
		fieldErrs["end_local"] = format
	}
	if startErr == nil && endErr == nil {
		if e.AllDay && end.Before(start) {
			fieldErrs["end_local"] = endAfterStart
		} else if !e.AllDay && !end.After(start) {
			fieldErrs["end_local"] = endAfterStart
		}
	}
	if len(fieldErrs) > 0 {
		unprocessable(w, fieldErrs)
		return
	}
	open, err := s.Store.OpenProposal(r.Context(), e.ID, key, c.Person.ID)
	if err != nil {
		s.fail(w, err)
		return
	}
	if open {
		writeError(w, http.StatusConflict, "proposal_open", proposalOpenMessage, nil)
		return
	}
	proposal := domain.Proposal{
		ID: newID("prp"), EventID: e.ID, Key: key, ProposerID: c.Person.ID, ProposerName: c.Person.Name,
		StartLocal: start.Local(e.AllDay), EndLocal: end.Local(e.AllDay), Note: body.Note,
		Status: domain.ProposalProposed,
	}
	if err := s.Store.InsertProposal(r.Context(), proposal, s.Clock.Now()); err != nil {
		s.fail(w, err)
		return
	}
	if err := s.Store.BumpVersion(r.Context(), e.ID); err != nil {
		s.fail(w, err)
		return
	}
	city := domain.ZoneCity(e.Zone)
	text := proposalMade(c.Person.Name, start.Clock(), city, e.Title)
	for _, personID := range s.editAccessPeople(r.Context(), e) {
		s.notify(r.Context(), personID, noticeDecision, text, e.ID, "")
	}
	s.publish(r.Context(), changeProposal, changeSpec{
		EventID: e.ID, CalendarID: e.CalendarID, OccurrenceID: body.OccurrenceID,
		Text: text, Audience: s.editAccessPeople(r.Context(), e),
	})
	writeJSON(w, http.StatusCreated, map[string]any{"proposal": map[string]any{
		"id": proposal.ID, "occurrence_id": body.OccurrenceID,
		"proposer":    map[string]any{"id": c.Person.ID, "name": c.Person.Name},
		"start_local": proposal.StartLocal, "end_local": proposal.EndLocal,
		"note": proposal.Note, "status": proposal.Status,
	}})
}

// editAccessPeople lists everyone at full access on an event, who are the
// people a proposal reaches.
func (s *Server) editAccessPeople(ctx context.Context, e *domain.Event) []string {
	people, err := s.Store.People(ctx)
	if err != nil {
		return nil
	}
	var out []string
	for _, p := range people {
		levels, err := s.Store.Levels(ctx, p.ID)
		if err != nil {
			continue
		}
		viewer := domain.Viewer{Person: p, Levels: levels}
		if viewer.Access(e) == domain.AccessFull {
			out = append(out, p.ID)
		}
	}
	return out
}

func (s *Server) handleAcceptProposal(w http.ResponseWriter, r *http.Request) {
	s.decideProposal(w, r, domain.ProposalAccepted)
}

func (s *Server) handleDeclineProposal(w http.ResponseWriter, r *http.Request) {
	s.decideProposal(w, r, domain.ProposalDeclined)
}

func (s *Server) decideProposal(w http.ResponseWriter, r *http.Request, status string) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	proposal, err := s.Store.Proposal(r.Context(), pathValue(r, "id"))
	if err != nil {
		notFound(w)
		return
	}
	e, err := s.Store.Event(r.Context(), proposal.EventID)
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
	won, err := s.Store.DecideProposal(r.Context(), proposal.ID, status)
	if err != nil {
		s.fail(w, err)
		return
	}
	if !won {
		writeError(w, http.StatusConflict, "proposal_decided", "That proposal is already decided.", nil)
		return
	}
	proposal.Status = status
	start, _ := domain.ParseLocal(proposal.StartLocal, e.AllDay)
	city := domain.ZoneCity(e.Zone)
	text := proposalDeclined(e.Title)
	if status == domain.ProposalAccepted {
		text = proposalAccepted(e.Title, start.Clock(), city)
		if err := s.moveForProposal(r.Context(), c, e, proposal); err != nil {
			s.fail(w, err)
			return
		}
	} else if err := s.Store.BumpVersion(r.Context(), e.ID); err != nil {
		s.fail(w, err)
		return
	}
	s.decide(r.Context(), e.ID, text, s.decisionAudience(r.Context(), e, proposal.ProposerID, status == domain.ProposalAccepted))
	s.publish(r.Context(), changeProposal, changeSpec{EventID: e.ID, CalendarID: e.CalendarID, OccurrenceID: occurrenceIDOf(e, proposal.Key)})
	fresh, err := s.Store.Event(r.Context(), e.ID)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"proposal": map[string]any{
			"id": proposal.ID, "occurrence_id": occurrenceIDOf(e, proposal.Key),
			"proposer":    map[string]any{"id": proposal.ProposerID, "name": proposal.ProposerName},
			"start_local": proposal.StartLocal, "end_local": proposal.EndLocal,
			"note": proposal.Note, "status": proposal.Status,
		},
		"event": c.Projector.Event(fresh, proposal.Key),
	})
}

// moveForProposal moves the one occurrence a proposal names, leaving the rest
// of the series where it was.
func (s *Server) moveForProposal(ctx context.Context, c *Context, e *domain.Event, proposal domain.Proposal) error {
	if e.IsSeries() {
		if err := s.Store.BumpVersion(ctx, e.ID); err != nil {
			return err
		}
		start, end := proposal.StartLocal, proposal.EndLocal
		if err := s.Store.PutException(ctx, e.ID, domain.Exception{
			Key: proposal.Key, StartLocal: &start, EndLocal: &end,
		}); err != nil {
			return err
		}
	} else {
		moved := *e
		moved.StartLocal = proposal.StartLocal
		moved.EndLocal = proposal.EndLocal
		moved.SavedAt = s.Clock.Now()
		moved.SavedByID = c.Person.ID
		if _, err := s.Store.UpdateEvent(ctx, &moved, e.Version); err != nil {
			return err
		}
	}
	fresh, err := s.Store.Event(ctx, e.ID)
	if err != nil {
		return err
	}
	scope := domain.ScopeThis
	if !fresh.IsSeries() {
		scope = domain.ScopeAll
	}
	s.reopenReplies(ctx, c, fresh, proposal.Key, scope, proposal.ProposerID)
	if fresh.IsSeries() {
		_ = s.Store.SetOccurrenceAnswer(ctx, fresh.ID, proposal.Key, proposal.ProposerID, domain.AnswerYes, "")
	} else {
		_ = s.Store.SetSeriesAnswer(ctx, fresh.ID, proposal.ProposerID, domain.AnswerYes, "")
	}
	reloaded, err := s.Store.Event(ctx, e.ID)
	if err != nil {
		return err
	}
	s.syncReminders(ctx, reloaded)
	s.publish(ctx, changeEvent, changeSpec{EventID: e.ID, CalendarID: e.CalendarID, OccurrenceID: occurrenceIDOf(e, proposal.Key)})
	return nil
}

func occurrenceIDOf(e *domain.Event, key string) string {
	if key == "" {
		return e.ID
	}
	return e.ID + "@" + key
}
