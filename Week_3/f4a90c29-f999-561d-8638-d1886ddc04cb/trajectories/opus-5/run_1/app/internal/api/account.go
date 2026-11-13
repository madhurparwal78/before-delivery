package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"sundialwren/internal/domain"
	"sundialwren/internal/store"
)

func (s *Server) handleSignIn(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Passcode string `json:"passcode"`
	}
	if readJSON(w, r, &body) != nil {
		return
	}
	person, err := s.Store.PersonByCredentials(r.Context(), strings.ToLower(strings.TrimSpace(body.Email)), body.Passcode)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "bad_credentials", badCredentialsMessage, nil)
		return
	}
	token, err := s.Store.CreateSession(r.Context(), person.ID, s.Clock.Now())
	if err != nil {
		s.fail(w, err)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	writeJSON(w, http.StatusOK, map[string]any{"person": publicPerson(person)})
}

func (s *Server) handleSignOut(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(sessionCookie); err == nil {
		_ = s.Store.DeleteSession(r.Context(), cookie.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	writeJSON(w, http.StatusNoContent, nil)
}

// publicPerson writes a person's own record, the only body an email address
// appears in.
func publicPerson(p domain.Person) map[string]any {
	return map[string]any{
		"id": p.ID, "name": p.Name, "email": p.Email, "zone": p.Zone, "city": p.City,
		"role": p.Role, "week_start": p.WeekStart, "hide_weekends": p.HideWeekends,
		"custom_days": p.CustomDays, "second_zone": p.SecondZone,
	}
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	writeJSON(w, http.StatusOK, publicPerson(c.Person))
}

func (s *Server) handlePatchMe(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	var body struct {
		Zone         *string `json:"zone"`
		WeekStart    *string `json:"week_start"`
		HideWeekends *bool   `json:"hide_weekends"`
		CustomDays   *int    `json:"custom_days"`
		SecondZone   *string `json:"second_zone"`
	}
	if readJSON(w, r, &body) != nil {
		return
	}
	person := c.Person
	fields := map[string]string{}
	if body.Zone != nil {
		if !domain.ValidZone(*body.Zone) {
			fields["zone"] = "Choose New York, London or Auckland."
		} else {
			person.Zone = *body.Zone
		}
	}
	if body.WeekStart != nil {
		switch *body.WeekStart {
		case "monday", "sunday", "saturday":
			person.WeekStart = *body.WeekStart
		default:
			fields["week_start"] = "Choose Monday, Sunday or Saturday."
		}
	}
	if body.HideWeekends != nil {
		person.HideWeekends = *body.HideWeekends
	}
	if body.CustomDays != nil {
		if *body.CustomDays < 2 || *body.CustomDays > 7 {
			fields["custom_days"] = "Choose a number of days from 2 to 7."
		} else {
			person.CustomDays = *body.CustomDays
		}
	}
	if body.SecondZone != nil {
		if *body.SecondZone == "" {
			person.SecondZone = nil
		} else if !domain.ValidZone(*body.SecondZone) {
			fields["second_zone"] = "Choose New York, London or Auckland."
		} else {
			zone := *body.SecondZone
			person.SecondZone = &zone
		}
	}
	if len(fields) > 0 {
		unprocessable(w, fields)
		return
	}
	if err := s.Store.UpdatePerson(r.Context(), person); err != nil {
		s.fail(w, err)
		return
	}
	person.City = domain.ZoneCity(person.Zone)
	s.publish(r.Context(), changeShare, changeSpec{PersonID: person.ID, Level: "settings"})
	writeJSON(w, http.StatusOK, publicPerson(person))
}

func (s *Server) handlePeople(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	if c.Person.Role == domain.RoleGuest {
		forbidden(w, "forbidden")
		return
	}
	people, err := s.Store.People(r.Context())
	if err != nil {
		s.fail(w, err)
		return
	}
	rows := make([]map[string]any, 0, len(people))
	for _, p := range people {
		rows = append(rows, map[string]any{"id": p.ID, "name": p.Name, "zone": p.Zone, "city": p.City})
	}
	writeJSON(w, http.StatusOK, map[string]any{"people": rows})
}

func (s *Server) handleCalendars(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	cals, err := s.Store.Calendars(r.Context(), c.Person.ID)
	if err != nil {
		s.fail(w, err)
		return
	}
	if cals == nil {
		cals = []domain.Calendar{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"calendars": cals})
}

func (s *Server) handlePatchCalendar(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	id := pathValue(r, "id")
	cal, err := s.Store.Calendar(r.Context(), id)
	if err != nil {
		notFound(w)
		return
	}
	if !c.Viewer.CanManageCalendar(id) {
		forbidden(w, "forbidden")
		return
	}
	var body struct {
		DefaultReminders []int `json:"default_reminders"`
	}
	if readJSON(w, r, &body) != nil {
		return
	}
	if msg := checkReminderMinutes(body.DefaultReminders); msg != "" {
		unprocessable(w, map[string]string{"default_reminders": msg})
		return
	}
	if err := s.Store.SetDefaultReminders(r.Context(), id, body.DefaultReminders); err != nil {
		s.fail(w, err)
		return
	}
	cal.DefaultReminders = body.DefaultReminders
	cal.Level = c.Viewer.Levels[id]
	writeJSON(w, http.StatusOK, cal)
}

// checkReminderMinutes holds a reminder list to whole minutes from 0 to 10080,
// at most five of them.
func checkReminderMinutes(minutes []int) string {
	if len(minutes) > 5 {
		return "Give at most five reminders."
	}
	for _, m := range minutes {
		if m < 0 || m > 10080 {
			return "Give whole minutes from 0 to 10080."
		}
	}
	return ""
}

func (s *Server) handleGetDraft(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	data, err := s.Store.Draft(r.Context(), c.Person.ID)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"draft": nil})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"draft": json.RawMessage(data)})
}

func (s *Server) handlePutDraft(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	var body map[string]any
	if readJSON(w, r, &body) != nil {
		return
	}
	data, err := json.Marshal(body)
	if err != nil {
		unprocessable(w, map[string]string{"draft": "That draft could not be read."})
		return
	}
	if err := s.Store.SaveDraft(r.Context(), c.Person.ID, data, s.Clock.Now()); err != nil {
		s.fail(w, err)
		return
	}
	s.publish(r.Context(), changeShare, changeSpec{PersonID: c.Person.ID, Level: "draft"})
	writeJSON(w, http.StatusOK, map[string]any{"draft": json.RawMessage(data)})
}

func (s *Server) handleDeleteDraft(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	if err := s.Store.DeleteDraft(r.Context(), c.Person.ID); err != nil {
		s.fail(w, err)
		return
	}
	s.publish(r.Context(), changeShare, changeSpec{PersonID: c.Person.ID, Level: "draft"})
	writeJSON(w, http.StatusNoContent, nil)
}

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	if c.Person.Role == domain.RoleGuest {
		forbidden(w, "forbidden")
		return
	}
	writeJSON(w, http.StatusOK, c.Settings)
}

func (s *Server) handlePatchSettings(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	if c.Person.Role != domain.RoleOfficeManager {
		forbidden(w, "forbidden")
		return
	}
	var body struct {
		GuestDefaults *domain.Switches              `json:"guest_defaults"`
		OfficeHours   map[string]domain.OfficeHours `json:"office_hours"`
	}
	if readJSON(w, r, &body) != nil {
		return
	}
	settings := c.Settings
	if body.GuestDefaults != nil {
		settings.GuestDefaults = *body.GuestDefaults
	}
	fields := map[string]string{}
	for zone, hours := range body.OfficeHours {
		if !domain.ValidZone(zone) {
			fields["office_hours"] = "Choose New York, London or Auckland."
			continue
		}
		open, err := domain.MinutesOfDay(hours.Open)
		if err != nil {
			fields[domain.ZoneCity(zone)+" opens"] = clockFormat
			continue
		}
		closes, err := domain.MinutesOfDay(hours.Close)
		if err != nil {
			fields[domain.ZoneCity(zone)+" closes"] = clockFormat
			continue
		}
		if closes <= open {
			fields[domain.ZoneCity(zone)+" closes"] = "Closing must be after opening."
			continue
		}
		if len(hours.Days) == 0 {
			hours.Days = []int{1, 2, 3, 4, 5}
		}
		settings.OfficeHours[zone] = hours
	}
	if len(fields) > 0 {
		unprocessable(w, fields)
		return
	}
	if err := s.Store.SaveSettings(r.Context(), settings); err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) handleZoneRules(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	if c.Person.Role == domain.RoleGuest {
		forbidden(w, "forbidden")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"rules": c.Rules})
}

func (s *Server) handleRecordZoneRule(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	if c.Person.Role != domain.RoleOfficeManager {
		forbidden(w, "forbidden")
		return
	}
	var body struct {
		Zone          string `json:"zone"`
		EffectiveDate string `json:"effective_date"`
		NewOffset     string `json:"new_offset"`
		Note          string `json:"note"`
	}
	if readJSON(w, r, &body) != nil {
		return
	}
	fields := map[string]string{}
	if !domain.ValidZone(body.Zone) {
		fields["zone"] = "Choose New York, London or Auckland."
	}
	if _, err := domain.ParseDate(body.EffectiveDate); err != nil {
		fields["effective_date"] = dateFormat
	}
	offset, err := domain.ParseOffset(body.NewOffset)
	if err != nil {
		fields["new_offset"] = "Use +HH:MM or -HH:MM, a whole quarter hour from -12:00 to +14:00."
	}
	note := strings.TrimSpace(body.Note)
	if len(note) < 1 || len(note) > 200 {
		fields["note"] = "Write a note of 1 to 200 characters."
	}
	if len(fields) > 0 {
		unprocessable(w, fields)
		return
	}
	exists, err := s.Store.ZoneRuleExists(r.Context(), body.Zone, body.EffectiveDate)
	if err != nil {
		s.fail(w, err)
		return
	}
	if exists {
		writeError(w, http.StatusConflict, "rule_exists", "A rule for that zone and date is already recorded.", nil)
		return
	}
	rule := domain.ZoneRule{
		ID: newID("zrl"), Zone: body.Zone, City: domain.ZoneCity(body.Zone),
		EffectiveDate: body.EffectiveDate, NewOffset: body.NewOffset, Note: note,
		RecordedBy: c.Person.ID, OffsetMinutes: offset,
	}
	if err := s.Store.InsertZoneRule(r.Context(), rule, s.Clock.Now()); err != nil {
		s.fail(w, err)
		return
	}
	s.publish(r.Context(), changeZoneRule, changeSpec{Rule: &rule})
	writeJSON(w, http.StatusCreated, rule)
}

func (s *Server) handleNotices(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	notices, err := s.Store.Notices(r.Context(), c.Person.ID)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"notices": notices})
}

func (s *Server) handleShares(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	id := r.URL.Query().Get("calendar_id")
	if _, err := s.Store.Calendar(r.Context(), id); err != nil {
		notFound(w)
		return
	}
	if !c.Viewer.CanManageCalendar(id) {
		forbidden(w, "forbidden")
		return
	}
	shares, err := s.Store.Shares(r.Context(), id)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"shares": shares})
}

func (s *Server) handlePutShare(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	id, personID := pathValue(r, "id"), pathValue(r, "personID")
	cal, err := s.Store.Calendar(r.Context(), id)
	if err != nil {
		notFound(w)
		return
	}
	if !c.Viewer.CanManageCalendar(id) {
		forbidden(w, "forbidden")
		return
	}
	if _, err := s.Store.Person(r.Context(), personID); err != nil {
		notFound(w)
		return
	}
	var body struct {
		Level string `json:"level"`
	}
	if readJSON(w, r, &body) != nil {
		return
	}
	switch body.Level {
	case domain.LevelFreeBusy, domain.LevelDetails, domain.LevelEdit, domain.LevelManage:
	default:
		unprocessable(w, map[string]string{"level": "Choose a published share level."})
		return
	}
	if err := s.Store.PutShare(r.Context(), id, personID, body.Level); err != nil {
		s.fail(w, err)
		return
	}
	s.publish(r.Context(), changeShare, changeSpec{
		PersonID: personID, CalendarID: id, CalendarName: cal.Name,
		Level: body.Level, Text: accessChanged(cal.Name, LevelLabel(body.Level)),
	})
	writeJSON(w, http.StatusOK, store.Share{PersonID: personID, Level: body.Level})
}

func (s *Server) handleDeleteShare(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	id, personID := pathValue(r, "id"), pathValue(r, "personID")
	cal, err := s.Store.Calendar(r.Context(), id)
	if err != nil {
		notFound(w)
		return
	}
	if !c.Viewer.CanManageCalendar(id) {
		forbidden(w, "forbidden")
		return
	}
	if err := s.Store.DeleteShare(r.Context(), id, personID); err != nil {
		s.fail(w, err)
		return
	}
	s.publish(r.Context(), changeShare, changeSpec{
		PersonID: personID, CalendarID: id, CalendarName: cal.Name,
		Level: "", Text: accessRemoved(cal.Name),
	})
	writeJSON(w, http.StatusNoContent, nil)
}
