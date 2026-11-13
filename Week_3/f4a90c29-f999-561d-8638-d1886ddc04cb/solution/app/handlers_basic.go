package main

import (
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/lib/pq"
)

func (s *Server) registerRoutes() {
	s.mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if !s.ready.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			w.Write([]byte(`{"status":"starting"}`))
			return
		}
		w.Write([]byte(`{"status":"ok"}`))
	})
	s.route("GET /api/time", true, s.handleTime)
	s.route("POST /api/session", true, s.handleSignIn)
	s.route("DELETE /api/session", true, s.handleSignOut)
	s.route("GET /api/me", false, s.handleMe)
	s.route("PATCH /api/me", false, s.handlePatchMe)
	s.route("GET /api/draft", false, s.handleGetDraft)
	s.route("PUT /api/draft", false, s.handlePutDraft)
	s.route("DELETE /api/draft", false, s.handleDeleteDraft)
	s.route("GET /api/people", false, s.handlePeople)
	s.route("GET /api/calendars", false, s.handleCalendars)
	s.route("PATCH /api/calendars/{id}", false, s.handlePatchCalendar)
	s.route("GET /api/settings", false, s.handleGetSettings)
	s.route("PATCH /api/settings", false, s.handlePatchSettings)
	s.route("GET /api/zone-rules", false, s.handleZoneRules)
	s.route("POST /api/zone-rules", false, s.handleRecordZoneRule)
	s.route("GET /api/notices", false, s.handleNotices)
	s.route("GET /api/live", false, s.handleLive)
	s.registerEventRoutes()
	s.registerSharingRoutes()
	s.registerFileRoutes()
	s.mux.HandleFunc("/", s.handlePage)
}

func (s *Server) handleTime(rq *Req) error {
	zone := "UTC"
	if me, err := s.sessionPerson(rq.R); err == nil {
		zone = me.Zone
	}
	return rq.json(200, map[string]any{"now_utc": s.clock.Now().Format(time.RFC3339), "zone": zone})
}

func (s *Server) handleSignIn(rq *Req) error {
	var body struct{ Email, Passcode string }
	if err := rq.decode(&body); err != nil {
		return err
	}
	var id, hash string
	err := s.db.QueryRowContext(rq.ctx(), `SELECT id, passcode_hash FROM people WHERE email = $1`, strings.ToLower(strings.TrimSpace(body.Email))).Scan(&id, &hash)
	given := passcodeHash(id, body.Passcode)
	if err == sql.ErrNoRows || subtle.ConstantTimeCompare([]byte(hash), []byte(given)) != 1 {
		return apiErr(401, "bad_credentials", "That email and passcode do not match.")
	}
	if err != nil {
		return err
	}
	token := newToken()
	if _, err := s.db.ExecContext(rq.ctx(), `INSERT INTO sessions VALUES ($1,$2,$3)`, token, id, s.clock.Now()); err != nil {
		return err
	}
	http.SetCookie(rq.W, &http.Cookie{Name: cookieName, Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode})
	w, err := rq.World()
	if err != nil {
		return err
	}
	return rq.json(200, map[string]any{"person": meJSON(w.People[id])})
}

func (s *Server) handleSignOut(rq *Req) error {
	if c, err := rq.R.Cookie(cookieName); err == nil {
		s.db.ExecContext(rq.ctx(), `DELETE FROM sessions WHERE token = $1`, c.Value)
	}
	http.SetCookie(rq.W, &http.Cookie{Name: cookieName, Value: "", Path: "/", HttpOnly: true, MaxAge: -1})
	return rq.noContent()
}

func meJSON(p *Person) map[string]any {
	var second any
	if p.SecondZone != nil {
		second = *p.SecondZone
	}
	return map[string]any{"id": p.ID, "name": p.Name, "email": p.Email, "zone": p.Zone, "city": p.City(), "role": p.Role,
		"week_start": p.WeekStart, "hide_weekends": p.HideWeekends, "custom_days": p.CustomDays, "second_zone": second}
}

func (s *Server) handleMe(rq *Req) error { return rq.json(200, meJSON(rq.Me)) }

func (s *Server) handlePatchMe(rq *Req) error {
	fields, err := rq.fields()
	if err != nil {
		return err
	}
	errs := map[string]string{}
	var columns []string
	args := []any{rq.Me.ID}
	set := func(column string, value any) {
		args = append(args, value)
		columns = append(columns, fmt.Sprintf("%s = $%d", column, len(args)))
	}
	for name, raw := range fields {
		switch name {
		case "zone":
			var v string
			if json.Unmarshal(raw, &v) != nil || !validZone(v) {
				errs[name] = "Choose New York, London or Auckland."
			}
			set("zone", v)
		case "week_start":
			var v string
			if json.Unmarshal(raw, &v) != nil || (v != "monday" && v != "sunday" && v != "saturday") {
				errs[name] = "Choose Monday, Sunday or Saturday."
			}
			set("week_start", v)
		case "hide_weekends":
			var v bool
			if json.Unmarshal(raw, &v) != nil {
				errs[name] = "Choose on or off."
			}
			set("hide_weekends", v)
		case "custom_days":
			var v int
			if json.Unmarshal(raw, &v) != nil || v < 2 || v > 7 {
				errs[name] = "Use a whole number from 2 to 7."
			}
			set("custom_days", v)
		case "second_zone":
			var v *string
			if json.Unmarshal(raw, &v) != nil || (v != nil && !validZone(*v)) {
				errs[name] = "Choose None, New York, London or Auckland."
			}
			set("second_zone", v)
		}
	}
	if len(errs) > 0 {
		return fieldErrors(errs)
	}
	if len(columns) > 0 {
		err = s.tx(rq.ctx(), func(tx *sql.Tx) error {
			if _, err := tx.ExecContext(rq.ctx(), "UPDATE people SET "+strings.Join(columns, ", ")+" WHERE id = $1", args...); err != nil {
				return err
			}
			return logChange(rq.ctx(), tx, s.clock.Now(), ChangeRow{Type: "event.changed", PersonID: rq.Me.ID, Data: map[string]any{"me": true}})
		})
		if err != nil {
			return err
		}
	}
	w, err := loadWorld(rq.ctx(), s.db, s.clock.Now())
	if err != nil {
		return err
	}
	return rq.json(200, meJSON(w.People[rq.Me.ID]))
}

func (s *Server) readDraft(rq *Req) (map[string]any, error) {
	var raw []byte
	err := s.db.QueryRowContext(rq.ctx(), `SELECT data FROM drafts WHERE person_id = $1`, rq.Me.ID).Scan(&raw)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	var draft map[string]any
	json.Unmarshal(raw, &draft)
	return draft, err
}

func (s *Server) handleGetDraft(rq *Req) error {
	draft, err := s.readDraft(rq)
	if err != nil {
		return err
	}
	return rq.json(200, map[string]any{"draft": draft})
}

var draftTypes = map[string]string{
	"calendar_id": "string", "title": "string", "kind": "string", "all_day": "bool", "start_local": "string", "end_local": "string",
	"zone": "string", "location": "string", "notes": "string", "colour": "string", "visibility": "string", "rrule": "string",
	"decline_mode": "string", "decline_message": "string", "reminders": "array", "switches": "object", "guest_ids": "array",
}

func (s *Server) handlePutDraft(rq *Req) error {
	var body map[string]any
	if err := rq.decode(&body); err != nil {
		return err
	}
	draft := map[string]any{}
	errs := map[string]string{}
	for name, kind := range draftTypes {
		v, ok := body[name]
		if !ok || v == nil {
			continue
		}
		var good bool
		switch kind {
		case "string":
			_, good = v.(string)
		case "bool":
			_, good = v.(bool)
		case "array":
			_, good = v.([]any)
		default:
			_, good = v.(map[string]any)
		}
		if !good {
			errs[name] = "Wrong type for " + name + "."
			continue
		}
		draft[name] = v
	}
	if len(errs) > 0 {
		return fieldErrors(errs)
	}
	raw, _ := json.Marshal(draft)
	err := s.tx(rq.ctx(), func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(rq.ctx(), `INSERT INTO drafts VALUES ($1,$2) ON CONFLICT (person_id) DO UPDATE SET data = $2`, rq.Me.ID, raw); err != nil {
			return err
		}
		return logChange(rq.ctx(), tx, s.clock.Now(), ChangeRow{Type: "event.changed", PersonID: rq.Me.ID, Data: map[string]any{"draft": draft}})
	})
	if err != nil {
		return err
	}
	return rq.json(200, map[string]any{"draft": draft})
}

func (s *Server) handleDeleteDraft(rq *Req) error {
	err := s.tx(rq.ctx(), func(tx *sql.Tx) error {
		res, err := tx.ExecContext(rq.ctx(), `DELETE FROM drafts WHERE person_id = $1`, rq.Me.ID)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return nil
		}
		return logChange(rq.ctx(), tx, s.clock.Now(), ChangeRow{Type: "event.changed", PersonID: rq.Me.ID, Data: map[string]any{"draft": nil}})
	})
	if err != nil {
		return err
	}
	return rq.noContent()
}

func (s *Server) handlePeople(rq *Req) error {
	if rq.Me.Role == "guest" {
		return errForbidden
	}
	w, err := rq.World()
	if err != nil {
		return err
	}
	people := []map[string]any{}
	for _, p := range w.peopleSorted() {
		people = append(people, map[string]any{"id": p.ID, "name": p.Name, "zone": p.Zone, "city": p.City()})
	}
	return rq.json(200, map[string]any{"people": people})
}

func (s *Server) handleCalendars(rq *Req) error {
	w, err := rq.World()
	if err != nil {
		return err
	}
	var list []*Calendar
	for _, c := range w.Calendars {
		if w.canRead(c, rq.Me) {
			list = append(list, c)
		}
	}
	rank := func(c *Calendar) int {
		switch {
		case c.OwnerID != nil && *c.OwnerID == rq.Me.ID:
			return 0
		case c.ID == holidaysCalendar:
			return 2
		}
		return 1
	}
	sort.Slice(list, func(i, j int) bool {
		if rank(list[i]) != rank(list[j]) {
			return rank(list[i]) < rank(list[j])
		}
		return list[i].Name < list[j].Name
	})
	out := []map[string]any{}
	for _, c := range list {
		out = append(out, calendarJSON(w, c, rq.Me))
	}
	return rq.json(200, map[string]any{"calendars": out})
}

func validReminders(list []int) bool {
	if len(list) > 5 {
		return false
	}
	for _, m := range list {
		if m < 0 || m > 10080 {
			return false
		}
	}
	return true
}

func (s *Server) handlePatchCalendar(rq *Req) error {
	w, err := rq.World()
	if err != nil {
		return err
	}
	c := w.Calendars[rq.R.PathValue("id")]
	if c == nil || !w.canRead(c, rq.Me) {
		return errNotFound
	}
	if !w.canManage(c, rq.Me) {
		return errForbidden
	}
	var body struct {
		DefaultReminders *[]int `json:"default_reminders"`
	}
	if err := rq.decode(&body); err != nil {
		return err
	}
	if body.DefaultReminders == nil || !validReminders(*body.DefaultReminders) {
		return fieldErr("default_reminders", "Use up to 5 whole minutes from 0 to 10080.")
	}
	if _, err := s.db.ExecContext(rq.ctx(), `UPDATE calendars SET default_reminders = $2 WHERE id = $1`, c.ID, pq.Array(*body.DefaultReminders)); err != nil {
		return err
	}
	c.DefaultReminders = *body.DefaultReminders
	return rq.json(200, calendarJSON(w, c, rq.Me))
}

// calendarJSON is the published shape of a calendar for one person.
func calendarJSON(w *World, c *Calendar, me *Person) map[string]any {
	return map[string]any{"id": c.ID, "name": c.Name, "owner_id": nilIfEmpty(c.OwnerID), "colour": c.Colour,
		"level": w.shareLevel(c, me), "default_reminders": c.DefaultReminders}
}

func settingsJSON(w *World) map[string]any {
	return map[string]any{"guest_defaults": w.Defaults, "office_hours": w.Hours}
}

func (s *Server) handleGetSettings(rq *Req) error {
	if rq.Me.Role == "guest" {
		return errForbidden
	}
	w, err := rq.World()
	if err != nil {
		return err
	}
	return rq.json(200, settingsJSON(w))
}

var clockPattern = regexp.MustCompile(`^([01][0-9]|2[0-3]):[0-5][0-9]$`)

func (s *Server) handlePatchSettings(rq *Req) error {
	if rq.Me.Role != "office_manager" {
		return errForbidden
	}
	var body struct {
		GuestDefaults map[string]bool           `json:"guest_defaults"`
		OfficeHours   map[string]map[string]any `json:"office_hours"`
	}
	if err := rq.decode(&body); err != nil {
		return err
	}
	var settings map[string]any
	err := s.edit(rq.ctx(), rq.Me, func(ed *Edit) error {
		w := ed.W
		errs := map[string]string{}
		for name, v := range body.GuestDefaults {
			switch name {
			case "modify_event":
				w.Defaults.ModifyEvent = v
			case "invite_others":
				w.Defaults.InviteOthers = v
			case "see_guest_list":
				w.Defaults.SeeGuestList = v
			default:
				errs["guest_defaults"] = "Use modify_event, invite_others and see_guest_list."
			}
		}
		for zone, patch := range body.OfficeHours {
			h, ok := w.Hours[zone]
			if !ok {
				errs["office_hours"] = "Use New York, London or Auckland zones."
				continue
			}
			for name, v := range patch {
				switch name {
				case "open", "close":
					text, _ := v.(string)
					if !clockPattern.MatchString(text) {
						errs["office_hours"] = "Use HH:MM."
					} else if name == "open" {
						h.Open = text
					} else {
						h.Close = text
					}
				case "days":
					days, good := intList(v)
					if !good || len(days) == 0 {
						errs["office_hours"] = "Use days 1 to 7."
					}
					h.Days = days
				}
			}
			if h.Open >= h.Close {
				errs["office_hours"] = "Opening must be before closing."
			}
			w.Hours[zone] = h
		}
		if len(errs) > 0 {
			return fieldErrors(errs)
		}
		changed := map[string]any{}
		if body.GuestDefaults != nil {
			changed["guest_defaults"] = w.Defaults
		}
		if body.OfficeHours != nil {
			changed["office_hours"] = w.Hours
		}
		for key, value := range changed {
			raw, _ := json.Marshal(value)
			if _, err := ed.Tx.ExecContext(ed.Ctx, `UPDATE settings SET value = $2 WHERE key = $1`, key, raw); err != nil {
				return err
			}
		}
		settings = settingsJSON(w)
		return nil
	})
	if err != nil {
		return err
	}
	return rq.json(200, settings)
}

func intList(v any) ([]int, bool) {
	list, ok := v.([]any)
	if !ok {
		return nil, false
	}
	out := make([]int, 0, len(list))
	for _, item := range list {
		f, ok := item.(float64)
		if !ok || f < 1 || f > 7 || f != float64(int(f)) {
			return nil, false
		}
		out = append(out, int(f))
	}
	return out, true
}

func ruleJSON(r ZoneRule) map[string]any {
	return map[string]any{"id": r.ID, "zone": r.Zone, "city": zoneCity[r.Zone], "effective_date": r.EffectiveDate,
		"new_offset": r.NewOffset, "note": r.Note, "recorded_by": r.RecordedBy}
}

func (s *Server) handleZoneRules(rq *Req) error {
	if rq.Me.Role == "guest" {
		return errForbidden
	}
	w, err := rq.World()
	if err != nil {
		return err
	}
	rules := []map[string]any{}
	for i := len(w.Rules) - 1; i >= 0; i-- {
		rules = append(rules, ruleJSON(w.Rules[i]))
	}
	return rq.json(200, map[string]any{"rules": rules})
}

var offsetPattern = regexp.MustCompile(`^[+-](0[0-9]|1[0-4]):[0-5][0-9]$`)

func validOffset(s string) bool {
	if !offsetPattern.MatchString(s) {
		return false
	}
	secs := offsetToSeconds(s)
	return secs%900 == 0 && secs >= -12*3600 && secs <= 14*3600
}

func (s *Server) handleRecordZoneRule(rq *Req) error {
	if rq.Me.Role != "office_manager" {
		return errForbidden
	}
	var body struct{ Zone, EffectiveDate, NewOffset, Note string }
	var raw map[string]string
	if err := rq.decode(&raw); err != nil {
		return err
	}
	body.Zone, body.EffectiveDate, body.NewOffset, body.Note = raw["zone"], raw["effective_date"], raw["new_offset"], strings.TrimSpace(raw["note"])
	errs := map[string]string{}
	if !validZone(body.Zone) {
		errs["zone"] = "Choose New York, London or Auckland."
	}
	if _, err := parseDate(body.EffectiveDate); err != nil {
		errs["effective_date"] = "Use YYYY-MM-DD."
	}
	if !validOffset(body.NewOffset) {
		errs["new_offset"] = "Use +HH:MM or -HH:MM in 15-minute steps from -12:00 to +14:00."
	}
	if n := len([]rune(body.Note)); n < 1 || n > 200 {
		errs["note"] = "Enter a note of 1 to 200 characters."
	}
	if len(errs) > 0 {
		return fieldErrors(errs)
	}
	rule := ZoneRule{ID: newID("zr-"), Zone: body.Zone, EffectiveDate: body.EffectiveDate, NewOffset: body.NewOffset, Note: body.Note, RecordedBy: rq.Me.ID}
	err := s.tx(rq.ctx(), func(tx *sql.Tx) error {
		_, err := tx.ExecContext(rq.ctx(), `INSERT INTO zone_rules VALUES ($1,$2,$3,$4,$5,$6)`, rule.ID, rule.Zone, rule.EffectiveDate, rule.NewOffset, rule.Note, rule.RecordedBy)
		if pe, ok := err.(*pq.Error); ok && pe.Code == "23505" {
			return apiErr(409, "rule_exists", "A rule is already recorded for that zone and date.")
		}
		if err != nil {
			return err
		}
		return logChange(rq.ctx(), tx, s.clock.Now(), ChangeRow{Type: "zone_rule.recorded", Data: map[string]any{"rule": ruleJSON(rule)}})
	})
	if err != nil {
		return err
	}
	return rq.json(201, ruleJSON(rule))
}

func (s *Server) handleNotices(rq *Req) error {
	rows, err := s.db.QueryContext(rq.ctx(), `SELECT id, kind, text, created_at FROM notices WHERE person_id = $1 ORDER BY id DESC LIMIT 200`, rq.Me.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	notices := []map[string]any{}
	for rows.Next() {
		var id int64
		var kind, text string
		var at time.Time
		if err := rows.Scan(&id, &kind, &text, &at); err != nil {
			return err
		}
		notices = append(notices, map[string]any{"id": itoa(id), "kind": kind, "text": text, "created_at": at.UTC().Format(time.RFC3339)})
	}
	return rq.json(200, map[string]any{"notices": notices})
}
