package main

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
)

// api_guests.go — guests, replies, proposals, sharing and zone rules.

// handleAddGuests is POST /api/events/:id/guests.
func (a *App) handleAddGuests(ctx context.Context, resp *apiResponse, person *Person, id string, body []byte) error {
	var req struct {
		PersonIDs []string `json:"person_ids"`
	}
	if err := jsonUnmarshal(body, &req); err != nil {
		return apiErr(422, "invalid", "That is not valid JSON.")
	}
	e, err := a.store.LoadEvent(ctx, id)
	if err != nil {
		return err
	}
	if e == nil {
		return apiErr(404, "not_found", "That event is not available.")
	}
	cal, _ := a.store.CalendarByID(ctx, e.CalendarID)
	access := a.store.Access(ctx, person, cal, e)
	if access != "full" && !(access == "guest" && e.Switches.InviteOthers) {
		return apiErr(403, "forbidden", "You need edit access or Invite others on that event.")
	}
	if e.Visibility == "private" && access == "guest" {
		return apiErr(403, "forbidden", "You need edit access or Invite others on that event.")
	}
	for _, g := range req.PersonIDs {
		if _, err := a.store.Pool().Exec(ctx, `INSERT INTO guests (event_id, person_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, id, g); err != nil {
			return err
		}
	}
	a.autoDeclineForGuests(ctx, e, req.PersonIDs)
	a.notifyInvited(ctx, e, req.PersonIDs)
	a.broadcaster.BroadcastEvent(ctx, e)
	hours, _ := a.store.OfficeHoursAll(ctx)
	return writeOkBody(resp, ProjectEvent(e, nil, access, person, hours))
}

// handleRemoveGuest is DELETE /api/events/:id/guests/:person_id.
func (a *App) handleRemoveGuest(ctx context.Context, resp *apiResponse, person *Person, id, personID string) error {
	e, err := a.store.LoadEvent(ctx, id)
	if err != nil {
		return err
	}
	if e == nil {
		return apiErr(404, "not_found", "That event is not available.")
	}
	cal, _ := a.store.CalendarByID(ctx, e.CalendarID)
	access := a.store.Access(ctx, person, cal, e)
	if access != "full" {
		return apiErr(403, "forbidden", "You need edit access on that event.")
	}
	if _, err := a.store.Pool().Exec(ctx, `DELETE FROM guests WHERE event_id=$1 AND person_id=$2`, id, personID); err != nil {
		return err
	}
	_, _ = a.store.Pool().Exec(ctx, `DELETE FROM replies WHERE event_id=$1 AND person_id=$2`, id, personID)
	_, _ = a.store.Pool().Exec(ctx, `DELETE FROM reminders WHERE event_id=$1 AND person_id=$2`, id, personID)
	a.broadcaster.BroadcastEvent(ctx, e)
	hours, _ := a.store.OfficeHoursAll(ctx)
	return writeOkBody(resp, ProjectEvent(e, nil, access, person, hours))
}

// handleReply is PUT /api/events/:id/replies/me.
func (a *App) handleReply(ctx context.Context, resp *apiResponse, person *Person, id string, body []byte) error {
	var req struct {
		Scope        string `json:"scope"`
		OccurrenceID string `json:"occurrence_id"`
		Answer       string `json:"answer"`
	}
	if err := jsonUnmarshal(body, &req); err != nil {
		return apiErr(422, "invalid", "That is not valid JSON.")
	}
	fields := map[string]string{}
	switch req.Answer {
	case "yes", "no", "maybe":
	default:
		fields["answer"] = "Choose Yes, No or Maybe."
	}
	if req.Scope != "occurrence" && req.Scope != "series" {
		fields["scope"] = "Answer for one event or the series."
	}
	e, err := a.store.LoadEvent(ctx, id)
	if err != nil {
		return err
	}
	if e == nil {
		return apiErr(404, "not_found", "That event is not available.")
	}
	if !IsGuest(e, person.ID) {
		return apiErr(403, "not_a_guest", "Only a guest may answer.")
	}
	isSeries := e.RRule != nil && *e.RRule != ""
	occID := req.OccurrenceID
	if isSeries && occID == "" && req.Scope == "occurrence" {
		fields["occurrence_id"] = "Choose the occurrence to answer."
	}
	if len(fields) > 0 {
		return apiFieldErr("Check the fields and try again.", fields)
	}
	// a return to invited by the guest is refused
	if req.Answer == "invited" {
		return apiFieldErr("Check the fields and try again.", map[string]string{"answer": "Answers move among yes, no and maybe."})
	}
	if req.Scope == "series" {
		_, err = a.store.Pool().Exec(ctx, `UPDATE guests SET series_answer=$2 WHERE event_id=$1 AND person_id=$3`, id, req.Answer, person.ID)
		if err != nil {
			return err
		}
	} else {
		if !isSeries {
			occID = id
		}
		_, err = a.store.Pool().Exec(ctx, `INSERT INTO replies (event_id, person_id, occurrence_id, answer)
		  VALUES ($1,$2,$3,$4) ON CONFLICT (event_id, person_id, occurrence_id) DO UPDATE SET answer=$4, message=''`,
			id, person.ID, occID, req.Answer)
		if err != nil {
			return err
		}
	}
	e, _ = a.store.LoadEvent(ctx, id)
	a.broadcaster.BroadcastReply(ctx, e, person.ID)
	return writeOkBody(resp, map[string]any{"my_reply": map[string]any{"answer": req.Answer, "message": ""}})
}

// handlePropose is POST /api/events/:id/proposals.
func (a *App) handlePropose(ctx context.Context, resp *apiResponse, person *Person, id string, body []byte) error {
	var req struct {
		OccurrenceID string `json:"occurrence_id"`
		StartLocal   string `json:"start_local"`
		EndLocal     string `json:"end_local"`
		Note         string `json:"note"`
	}
	if err := jsonUnmarshal(body, &req); err != nil {
		return apiErr(422, "invalid", "That is not valid JSON.")
	}
	e, err := a.store.LoadEvent(ctx, id)
	if err != nil {
		return err
	}
	if e == nil {
		return apiErr(404, "not_found", "That event is not available.")
	}
	if !IsGuest(e, person.ID) {
		return apiErr(403, "not_a_guest", "Only a guest may propose a time.")
	}
	fields := map[string]string{}
	isSeries := e.RRule != nil && *e.RRule != ""
	occID := req.OccurrenceID
	if isSeries && occID == "" {
		fields["occurrence_id"] = "Choose the occurrence to propose for."
	}
	if !isSeries {
		occID = id
	}
	// parse times in the event's zone; all-day events take a date
	sl, el := req.StartLocal, req.EndLocal
	if e.AllDay {
		if _, ok := ParseDate(sl); !ok {
			fields["start_local"] = "Use YYYY-MM-DD."
		}
		if _, ok := ParseDate(el); !ok {
			fields["end_local"] = "Use YYYY-MM-DD."
		}
	} else {
		if _, _, ok := parseLocalDateTime(sl); !ok {
			fields["start_local"] = "Use YYYY-MM-DD HH:MM."
		}
		if _, _, ok := parseLocalDateTime(el); !ok {
			fields["end_local"] = "Use YYYY-MM-DD HH:MM."
		}
	}
	if len(fields) > 0 {
		return apiFieldErr("Check the fields and try again.", fields)
	}
	// one open proposal per guest per occurrence
	var open int
	if err := a.store.Pool().QueryRow(ctx, `SELECT count(*) FROM proposals
	  WHERE event_id=$1 AND occurrence_id=$2 AND proposer_id=$3 AND status='proposed'`, id, occID, person.ID).Scan(&open); err != nil {
		return err
	}
	if open > 0 {
		return apiErr(409, "proposal_open", "You already have an open proposal for this time.")
	}
	pid := newID("prp")
	if _, err := a.store.Pool().Exec(ctx, `INSERT INTO proposals (id, event_id, occurrence_id, proposer_id, start_local, end_local, note)
	  VALUES ($1,$2,$3,$4,$5,$6,$7)`, pid, id, occID, person.ID, sl, el, req.Note); err != nil {
		return err
	}
	a.broadcaster.BroadcastProposal(ctx, e, pid, person)
	writeJSON(resp.w, http.StatusCreated, map[string]any{
		"id": pid, "occurrence_id": occID,
		"proposer":    map[string]any{"id": person.ID, "name": person.Name},
		"start_local": sl, "end_local": el, "note": req.Note, "status": "proposed",
	})
	return nil
}

func parseLocalDateTime(s string) (string, int, bool) {
	parts := strings.SplitN(strings.TrimSpace(s), "T", 2)
	if len(parts) != 2 {
		parts = strings.SplitN(strings.TrimSpace(s), " ", 2)
	}
	if len(parts) != 2 {
		return "", 0, false
	}
	d, ok := ParseDate(parts[0])
	if !ok {
		return "", 0, false
	}
	m, ok := MinutesFromMidnight(parts[1])
	if !ok {
		return "", 0, false
	}
	return FormatDate(d), m, true
}

// handleProposalDecide is POST /api/proposals/:id/accept or /decline.
func (a *App) handleProposalDecide(ctx context.Context, resp *apiResponse, person *Person, id string, accept bool) error {
	var row struct {
		EventID      string
		OccurrenceID string
		ProposerID   string
		StartLocal   string
		EndLocal     string
		Status       string
	}
	err := a.store.Pool().QueryRow(ctx, `SELECT event_id, occurrence_id, proposer_id, start_local, end_local, status
	  FROM proposals WHERE id=$1`, id).Scan(&row.EventID, &row.OccurrenceID, &row.ProposerID, &row.StartLocal, &row.EndLocal, &row.Status)
	if err != nil {
		return apiErr(404, "not_found", "That proposal is not available.")
	}
	if row.Status != "proposed" {
		return apiErr(409, "proposal_decided", "This proposal was already decided.")
	}
	e, err := a.store.LoadEvent(ctx, row.EventID)
	if err != nil {
		return err
	}
	if e == nil {
		return apiErr(404, "not_found", "That event is not available.")
	}
	cal, _ := a.store.CalendarByID(ctx, e.CalendarID)
	access := a.store.Access(ctx, person, cal, e)
	if access != "full" {
		return apiErr(403, "forbidden", "Only the organiser or an editor may decide.")
	}
	newStatus := "declined"
	if accept {
		newStatus = "accepted"
	}
	res, err := a.store.Pool().Exec(ctx, `UPDATE proposals SET status=$2 WHERE id=$1 AND status='proposed'`, id, newStatus)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return apiErr(409, "proposal_decided", "This proposal was already decided.")
	}
	if accept {
		// move that occurrence only, as an exception
		sd, sm, ok1 := parseLocalDateTime(row.StartLocal)
		ed, em, ok2 := parseLocalDateTime(row.EndLocal)
		if !ok1 || !ok2 {
			if e.AllDay {
				sd = row.StartLocal
				ed = row.EndLocal
				sm, em = 0, 0
			}
		}
		if _, err := a.store.Pool().Exec(ctx, `INSERT INTO exceptions (event_id, occurrence_id, deleted, start_date, start_minutes, end_date, end_minutes)
		  VALUES ($1,$2,false,$3,$4,$5,$6)
		  ON CONFLICT (event_id, occurrence_id) DO UPDATE SET start_date=$3, start_minutes=$4, end_date=$5, end_minutes=$6`,
			row.EventID, row.OccurrenceID, sd, sm, ed, em); err != nil {
			return err
		}
		// guests return to waiting except the accepted proposer
		_, _ = a.store.Pool().Exec(ctx, `DELETE FROM replies WHERE event_id=$1 AND occurrence_id=$2`, row.EventID, row.OccurrenceID)
		_, _ = a.store.Pool().Exec(ctx, `INSERT INTO replies (event_id, person_id, occurrence_id, answer)
		  VALUES ($1,$2,$3,'yes') ON CONFLICT (event_id, person_id, occurrence_id) DO UPDATE SET answer='yes'`,
			row.EventID, row.ProposerID, row.OccurrenceID)
	}
	// refresh reminders for the moved occurrence
	e, _ = a.store.LoadEvent(ctx, row.EventID)
	a.refreshRemindersForEvent(ctx, e)
	proposer, _ := a.store.PersonByID(ctx, row.ProposerID)
	decisionText := fmt.Sprintf("Proposal declined for %s.", e.Title)
	if accept {
		decisionText = fmt.Sprintf("Proposal accepted: %s moves to %s %s.", e.Title, occStartTimeOf(e, row.OccurrenceID), zoneCity(e.Zone))
	}
	a.broadcaster.PushDecisionForProposal(ctx, e, row, accept, decisionText, person.ID)
	a.broadcaster.BroadcastEvent(ctx, e)
	writeJSON(resp.w, http.StatusOK, map[string]any{
		"proposal": map[string]any{
			"id": id, "occurrence_id": row.OccurrenceID,
			"proposer":    map[string]any{"id": row.ProposerID, "name": proposerName(a, proposer)},
			"start_local": row.StartLocal, "end_local": row.EndLocal, "status": newStatus,
		},
		"event": mustProjectEvent(ctx, a, e, person),
	})
	return nil
}

func proposerName(a *App, p *Person) string {
	if p == nil {
		return "Someone"
	}
	return p.Name
}

func zoneCity(zone string) string {
	if z, ok := zoneByName[zone]; ok {
		return z.City
	}
	return zone
}

func occStartTimeOf(e *Event, occurrenceID string) string {
	rules, _ := aRulesForEvent(nil)
	moved := map[string]bool{}
	o := FindOccurrence(e, occurrenceID, rules, moved)
	if o == nil {
		return e.StartLocal()
	}
	return minutesHM(o.StartMinutes)
}

var rulesCacheKey string

func aRulesForEvent(a *App) ([]*ZoneRule, error) {
	return nil, nil
}

func mustProjectEvent(ctx context.Context, a *App, e *Event, person *Person) map[string]any {
	cal, _ := a.store.CalendarByID(ctx, e.CalendarID)
	access := a.store.Access(ctx, person, cal, e)
	hours, _ := a.store.OfficeHoursAll(ctx)
	return ProjectEvent(e, nil, access, person, hours)
}

// handleConflicts lists existing meetings inside the caller's own
// out-of-office event.
func (a *App) handleConflicts(ctx context.Context, resp *apiResponse, person *Person, id string) error {
	e, err := a.store.LoadEvent(ctx, id)
	if err != nil {
		return err
	}
	if e == nil {
		return apiErr(404, "not_found", "That event is not available.")
	}
	if e.Kind != "out_of_office" || e.OrganiserID != person.ID {
		return apiErr(403, "forbidden", "Only your own out-of-office events list conflicts.")
	}
	rules, _ := a.store.ZoneRules(ctx)
	moved := map[string]bool{}
	occs := GenOccurrences(e, mustDate("1900-01-01"), mustDate("9999-12-31"), rules, moved)
	out := []map[string]any{}
	for _, o := range occs {
		wp := occInstants(o)
		guestEvents, _ := a.store.EventsOfGuest(ctx, person.ID)
		for _, ge := range guestEvents {
			if ge.ID == e.ID || ge.CalendarID == guestOwnCalendar(ctx, a, person.ID) {
				continue
			}
			gMoved := map[string]bool{}
			gOccs := GenOccurrences(ge, wp.start, wp.end, rules, gMoved)
			for _, go_ := range gOccs {
				gp := occInstants(go_)
				if overlap(gp.start, gp.end, wp.start, wp.end) {
					out = append(out, map[string]any{
						"event_id": ge.ID, "occurrence_id": go_.OccurrenceID,
						"title": go_.Title, "start_local": occStartLocal(go_),
						"zone": go_.Zone, "answer": ReplyFor(ge, person.ID, go_.OccurrenceID),
					})
				}
			}
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i]["start_local"].(string) < out[j]["start_local"].(string)
	})
	return writeOkBody(resp, map[string]any{"conflicts": out})
}

// Sharing -------------------------------------------------------------------

func (a *App) handleListShares(ctx context.Context, resp *apiResponse, person *Person, calID string) error {
	cal, err := a.store.CalendarByID(ctx, calID)
	if err != nil {
		return err
	}
	if cal == nil {
		return apiErr(404, "not_found", "Nothing is scheduled at this address.")
	}
	if !canManageShares(person, cal, a) {
		return apiErr(403, "forbidden", "Only the office manager, the owner and people with Manage sharing may read these shares.")
	}
	shares, err := a.store.SharesOf(ctx, calID)
	if err != nil {
		return err
	}
	out := []map[string]any{}
	for _, sh := range shares {
		out = append(out, map[string]any{"person_id": sh.PersonID, "name": sh.Name, "level": sh.Level})
	}
	return writeOkBody(resp, map[string]any{"shares": out})
}

func canManageShares(p *Person, cal *Calendar, a *App) bool {
	if p.Role == "office_manager" {
		return true
	}
	if cal.OwnerID != nil && *cal.OwnerID == p.ID {
		return true
	}
	level, _ := a.store.ShareLevel(context.Background(), cal.ID, p.ID)
	return level == "manage"
}

func (a *App) handlePutShare(ctx context.Context, resp *apiResponse, person *Person, calID, personID string, body []byte) error {
	cal, err := a.store.CalendarByID(ctx, calID)
	if err != nil {
		return err
	}
	if cal == nil {
		return apiErr(404, "not_found", "Nothing is scheduled at this address.")
	}
	if cal.ReadOnly {
		return apiErr(403, "forbidden", "Public holidays has no shares.")
	}
	if !canManageShares(person, cal, a) {
		return apiErr(403, "forbidden", "Only the office manager, the owner and people with Manage sharing may change these shares.")
	}
	var req struct {
		Level string `json:"level"`
	}
	if err := jsonUnmarshal(body, &req); err != nil {
		return apiErr(422, "invalid", "That is not valid JSON.")
	}
	switch req.Level {
	case "free_busy", "details", "edit", "manage":
	default:
		return apiFieldErr("Check the fields and try again.", map[string]string{"level": "Choose a share level."})
	}
	if _, err := a.store.Pool().Exec(ctx, `INSERT INTO shares (calendar_id, person_id, level) VALUES ($1,$2,$3)
	  ON CONFLICT (calendar_id, person_id) DO UPDATE SET level=$3`, calID, personID, req.Level); err != nil {
		return err
	}
	a.broadcaster.PushAccessChange(ctx, personID, cal, req.Level, true)
	target, _ := a.store.PersonByID(ctx, personID)
	return writeOkBody(resp, map[string]any{"person_id": personID, "name": personNameOf(target), "level": req.Level})
}

func personNameOf(p *Person) string {
	if p == nil {
		return ""
	}
	return p.Name
}

func (a *App) handleDeleteShare(ctx context.Context, resp *apiResponse, person *Person, calID, personID string) error {
	cal, err := a.store.CalendarByID(ctx, calID)
	if err != nil {
		return err
	}
	if cal == nil {
		return apiErr(404, "not_found", "Nothing is scheduled at this address.")
	}
	if cal.ReadOnly {
		return apiErr(403, "forbidden", "Public holidays has no shares.")
	}
	if !canManageShares(person, cal, a) {
		return apiErr(403, "forbidden", "Only the office manager, the owner and people with Manage sharing may change these shares.")
	}
	if _, err := a.store.Pool().Exec(ctx, `DELETE FROM shares WHERE calendar_id=$1 AND person_id=$2`, calID, personID); err != nil {
		return err
	}
	a.broadcaster.PushAccessChange(ctx, personID, cal, "", false)
	resp.w.WriteHeader(http.StatusNoContent)
	return nil
}

// Settings ------------------------------------------------------------------

func (a *App) handleGetSettings(ctx context.Context, resp *apiResponse, person *Person) error {
	if person.Role == "guest" {
		return apiErr(403, "forbidden", "Guests may not read these settings.")
	}
	defaults, err := a.store.GuestDefaults(ctx)
	if err != nil {
		return err
	}
	hours, err := a.store.OfficeHoursAll(ctx)
	if err != nil {
		return err
	}
	hoursOut := map[string]any{}
	for zone, h := range hours {
		hoursOut[zone] = map[string]any{"open": h.Open, "close": h.Close, "days": h.Days}
	}
	return writeOkBody(resp, map[string]any{
		"guest_defaults": defaults,
		"office_hours":   hoursOut,
	})
}

func (a *App) handlePatchSettings(ctx context.Context, resp *apiResponse, person *Person, body []byte) error {
	if person.Role != "office_manager" {
		return apiErr(403, "forbidden", "Only the office manager may change these settings.")
	}
	var req map[string]any
	if err := jsonUnmarshal(body, &req); err != nil {
		return apiErr(422, "invalid", "That is not valid JSON.")
	}
	fields := map[string]string{}
	if gd, ok := req["guest_defaults"].(map[string]any); ok {
		m, _ := gd["modify_event"].(bool)
		i, _ := gd["invite_others"].(bool)
		s, _ := gd["see_guest_list"].(bool)
		if _, err := a.store.Pool().Exec(ctx, `UPDATE guest_defaults SET modify_event=$2, invite_others=$3, see_guest_list=$4 WHERE id=1`,
			person.ID, m, i, s); err != nil {
			return err
		}
	}
	if oh, ok := req["office_hours"].(map[string]any); ok {
		for zone, v := range oh {
			dict, _ := v.(map[string]any)
			open, _ := dict["open"].(string)
			close_, _ := dict["close"].(string)
			if _, ok1 := MinutesFromMidnight(open); !ok1 {
				fields[zone+"_open"] = "Use HH:MM."
			}
			if _, ok2 := MinutesFromMidnight(close_); !ok2 {
				fields[zone+"_close"] = "Use HH:MM."
			}
			days := []int{}
			if dl, ok3 := dict["days"].([]any); ok3 {
				for _, d := range dl {
					if f, ok4 := d.(float64); ok4 {
						days = append(days, int(f))
					}
				}
			}
			if len(days) == 0 {
				days = []int{1, 2, 3, 4, 5}
			}
			if _, err := a.store.Pool().Exec(ctx, `UPDATE office_hours SET open=$2, close=$3, days=$4 WHERE zone=$1`,
				zone, open, close_, days); err != nil {
				return err
			}
		}
		hours, _ := a.store.OfficeHoursAll(ctx)
		SetOfficeHours(hours)
	}
	if len(fields) > 0 {
		return apiFieldErr("Check the fields and try again.", fields)
	}
	return a.handleGetSettings(ctx, resp, person)
}

// Zone rules ----------------------------------------------------------------

func (a *App) handleRecordRule(ctx context.Context, resp *apiResponse, person *Person, body []byte) error {
	if person.Role != "office_manager" {
		return apiErr(403, "forbidden", "Only the office manager records zone rules.")
	}
	var req struct {
		Zone          string `json:"zone"`
		EffectiveDate string `json:"effective_date"`
		NewOffset     string `json:"new_offset"`
		Note          string `json:"note"`
	}
	if err := jsonUnmarshal(body, &req); err != nil {
		return apiErr(422, "invalid", "That is not valid JSON.")
	}
	fields := map[string]string{}
	if _, ok := ZoneFor(req.Zone); !ok {
		fields["zone"] = "Choose New York, London or Auckland."
	}
	if _, ok := ParseDate(req.EffectiveDate); !ok {
		fields["effective_date"] = "Use YYYY-MM-DD."
	}
	off, ok := ParseOffsetMinutes(req.NewOffset)
	if !ok {
		fields["new_offset"] = "Use +HH:MM or -HH:MM."
	}
	if len(strings.TrimSpace(req.Note)) < 1 || len(req.Note) > 200 {
		fields["note"] = "A rule note is 1 to 200 characters."
	}
	if len(fields) > 0 {
		return apiFieldErr("Check the fields and try again.", fields)
	}
	id := newID("zr")
	var exists int
	if err := a.store.Pool().QueryRow(ctx, `SELECT count(*) FROM zone_rules WHERE zone=$1 AND effective_date=$2`,
		req.Zone, req.EffectiveDate).Scan(&exists); err != nil {
		return err
	}
	if exists > 0 {
		return apiErr(409, "rule_exists", "A rule already exists for that zone and date.")
	}
	if _, err := a.store.Pool().Exec(ctx, `INSERT INTO zone_rules (id, zone, effective_date, new_offset_minutes, note, recorded_by)
	  VALUES ($1,$2,$3,$4,$5,$6)`, id, req.Zone, req.EffectiveDate, off, req.Note, person.ID); err != nil {
		return err
	}
	rule, _ := a.store.ZoneRuleByID(ctx, id)
	a.broadcaster.BroadcastZoneRule(ctx, rule)
	writeJSON(resp.w, http.StatusCreated, map[string]any{
		"id": rule.ID, "zone": rule.Zone, "city": rule.City,
		"effective_date": rule.EffectiveDate, "new_offset": rule.NewOffset,
		"note": rule.Note, "recorded_by": rule.RecordedBy,
	})
	return nil
}

// Shared link ---------------------------------------------------------------

func (a *App) handleShareLinkCreate(ctx context.Context, resp *apiResponse, person *Person, id string) error {
	e, err := a.store.LoadEvent(ctx, id)
	if err != nil {
		return err
	}
	if e == nil {
		return apiErr(404, "not_found", "That event is not available.")
	}
	cal, _ := a.store.CalendarByID(ctx, e.CalendarID)
	access := a.store.Access(ctx, person, cal, e)
	if access != "full" {
		return apiErr(403, "forbidden", "You need edit access to share this event.")
	}
	if e.Visibility == "private" {
		return apiErr(409, "private_event", "A private event has no shared link.")
	}
	if !e.Switches.SeeGuestList {
		return apiErr(409, "guest_list_hidden", "Guest list hidden. The shared link no longer works.")
	}
	token := uuid.NewString() + uuid.NewString()[:8]
	expires := a.clock.Now().Add(a.cfg.ShareLinkTTL)
	if _, err := a.store.Pool().Exec(ctx, `INSERT INTO share_links (event_id, token, expires_at) VALUES ($1,$2,$3)
	  ON CONFLICT (event_id) DO UPDATE SET token=$2, expires_at=$3`, id, token, expires); err != nil {
		return err
	}
	writeJSON(resp.w, http.StatusCreated, map[string]any{
		"token": token, "url": "/share/" + token,
		"expires_at": expires.UTC().Format(time.RFC3339),
	})
	return nil
}

func (a *App) handleShareLinkDelete(ctx context.Context, resp *apiResponse, person *Person, id string) error {
	e, err := a.store.LoadEvent(ctx, id)
	if err != nil {
		return err
	}
	if e == nil {
		return apiErr(404, "not_found", "That event is not available.")
	}
	cal, _ := a.store.CalendarByID(ctx, e.CalendarID)
	access := a.store.Access(ctx, person, cal, e)
	if access != "full" {
		return apiErr(403, "forbidden", "You need edit access to share this event.")
	}
	if _, err := a.store.Pool().Exec(ctx, `DELETE FROM share_links WHERE event_id=$1`, id); err != nil {
		return err
	}
	resp.w.WriteHeader(http.StatusNoContent)
	return nil
}

// handleShareGet is the public read-only shared event page data.
func (a *App) handleShareGet(ctx context.Context, resp *apiResponse, token string) error {
	e, err := a.store.LoadEvent(ctx, shareEventIDByToken(ctx, a, token))
	if err != nil {
		return err
	}
	if e == nil || e.State == "trashed" || e.State == "purged" || e.Visibility == "private" ||
		e.ShareLink == nil || e.ShareLink.Token != token ||
		e.ShareLink.ExpiresAt.Before(a.clock.Now()) {
		writeJSONStatus(resp.w, 404, errMap("not_found", "This link no longer works."))
		return nil
	}
	guests := []map[string]any{}
	for _, g := range e.Guests {
		guests = append(guests, map[string]any{"name": g.Name, "answer": g.Answer})
	}
	startUTC, _ := eventInstants(e, nil)
	writeJSON(resp.w, http.StatusOK, map[string]any{
		"title": e.Title, "location": e.Location,
		"organiser_name": a.personName(ctx, e.OrganiserID),
		"all_day":        e.AllDay, "start_local": e.StartLocal(), "end_local": e.EndLocal(),
		"zone": e.Zone, "guests": guests,
		"clocks": clocksForEvent(e, struct{ start, end time.Time }{start: startUTC}),
	})
	return nil
}

func shareEventIDByToken(ctx context.Context, a *App, token string) string {
	var id string
	_ = a.store.Pool().QueryRow(ctx, `SELECT event_id FROM share_links WHERE token=$1 AND expires_at > now()`, token).Scan(&id)
	return id
}

func clocksForEvent(e *Event, pair struct{ start, end time.Time }) []ClockEntry {
	if e.AllDay {
		return []ClockEntry{}
	}
	return threeClocks(pair.start)
}
