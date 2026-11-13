package main

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// api.go — every API endpoint in one dispatch table.

func (a *App) dispatch(ctx context.Context, resp *apiResponse, body []byte) error {
	r := resp.r
	path := r.URL.Path
	method := r.Method
	s := a.store

	switch {
	case path == "/api/live":
		return a.handleLive(resp)
	}

	// public endpoints
	switch {
	case path == "/api/health":
		return a.handleHealthRaw(resp)
	case path == "/api/time":
		return a.handleTime(resp)
	case path == "/api/session" && method == http.MethodPost:
		return a.handleSignIn(ctx, resp, body)
	case strings.HasPrefix(path, "/api/share/"):
		// the shared event page is public and read only
		if method != http.MethodGet {
			writeJSONStatus(resp.w, 405, errMap("read_only", "This link is read only."))
			return nil
		}
		return a.handleShareGet(ctx, resp, path[len("/api/share/"):])
	}

	// everything else needs a session
	person, err := requirePerson(ctx, s, r)
	if err != nil {
		return err
	}
	a.LoadOrganiserNames(ctx)
	resp.Person = person
	q := r.URL.Query()

	switch {
	// session
	case path == "/api/session" && method == http.MethodDelete:
		c, _ := r.Cookie("wren_session")
		if c != nil {
			_ = s.DeleteSession(ctx, c.Value)
		}
		clearSessionCookie(resp.w)
		resp.w.WriteHeader(http.StatusNoContent)
		return nil

	// me
	case path == "/api/me" && method == http.MethodGet:
		return writeOkBody(resp, map[string]any{
			"id": person.ID, "name": person.Name, "email": person.Email,
			"zone": person.Zone, "city": person.City, "role": person.Role,
			"week_start": person.WeekStart, "hide_weekends": person.HideWeekends,
			"custom_days": person.CustomDays, "second_zone": person.SecondZone,
		})
	case path == "/api/me" && method == http.MethodPatch:
		return a.handlePatchMe(ctx, resp, person, body)

	// draft
	case path == "/api/draft" && method == http.MethodGet:
		d, err := s.GetDraft(ctx, person.ID)
		if err != nil {
			return err
		}
		if d == nil {
			return writeOkBody(resp, map[string]any{"draft": nil})
		}
		return writeOkBody(resp, map[string]any{"draft": d})
	case path == "/api/draft" && method == http.MethodPut:
		var data map[string]any
		if err := jsonUnmarshal(body, &data); err != nil {
			return apiErr(422, "invalid", "That is not valid JSON.")
		}
		if err := s.PutDraft(ctx, person.ID, data); err != nil {
			return err
		}
		d, _ := s.GetDraft(ctx, person.ID)
		return writeOkBody(resp, map[string]any{"draft": d})
	case path == "/api/draft" && method == http.MethodDelete:
		if err := s.DeleteDraft(ctx, person.ID); err != nil {
			return err
		}
		resp.w.WriteHeader(http.StatusNoContent)
		return nil

	// people
	case path == "/api/people":
		if person.Role == "guest" {
			return apiErr(403, "forbidden", "Guests may not list people.")
		}
		people, err := s.AllPeople(ctx)
		if err != nil {
			return err
		}
		out := []map[string]any{}
		for _, pp := range people {
			out = append(out, map[string]any{"id": pp.ID, "name": pp.Name, "zone": pp.Zone, "city": pp.City})
		}
		return writeOkBody(resp, map[string]any{"people": out})

	// calendars
	case path == "/api/calendars" && method == http.MethodGet:
		return a.handleCalendars(ctx, resp, person)
	case strings.HasPrefix(path, "/api/calendars/") && strings.HasSuffix(path, "/shares"):
		// handled below with :id
	}

	switch {
	case path == "/api/calendars" && method == http.MethodGet:
		return a.handleCalendars(ctx, resp, person)
	}

	// /api/calendars/:id/shares/:person
	if strings.HasPrefix(path, "/api/calendars/") {
		rest := strings.TrimPrefix(path, "/api/calendars/")
		parts := strings.Split(rest, "/")
		if len(parts) >= 1 {
			calID := parts[0]
			if len(parts) == 2 && parts[1] == "shares" {
				switch method {
				case http.MethodGet:
					return a.handleListShares(ctx, resp, person, calID)
				}
			}
			if len(parts) == 2 && parts[1] == "exports" && method == http.MethodPost {
				return a.handleExport(ctx, resp, person, calID)
			}
			if len(parts) == 2 && parts[1] == "imports" && method == http.MethodPost {
				return a.handleImport(ctx, resp, person, calID, body)
			}
			if len(parts) == 3 && parts[1] == "shares" {
				switch method {
				case http.MethodPut:
					return a.handlePutShare(ctx, resp, person, calID, parts[2], body)
				case http.MethodDelete:
					return a.handleDeleteShare(ctx, resp, person, calID, parts[2])
				}
			}
			if len(parts) == 2 && method == http.MethodPatch {
				return a.handlePatchCalendar(ctx, resp, person, calID, body)
			}
		}
	}

	// settings
	if path == "/api/settings" {
		switch method {
		case http.MethodGet:
			return a.handleGetSettings(ctx, resp, person)
		case http.MethodPatch:
			return a.handlePatchSettings(ctx, resp, person, body)
		}
	}

	// zone rules
	if path == "/api/zone-rules" {
		switch method {
		case http.MethodGet:
			if person.Role == "guest" {
				return apiErr(403, "forbidden", "Guests may not read zone rules.")
			}
			rules, err := s.ZoneRules(ctx)
			if err != nil {
				return err
			}
			out := []map[string]any{}
			for _, rl := range rules {
				out = append(out, map[string]any{
					"id": rl.ID, "zone": rl.Zone, "city": rl.City,
					"effective_date": rl.EffectiveDate, "new_offset": rl.NewOffset,
					"note": rl.Note, "recorded_by": rl.RecordedBy,
				})
			}
			return writeOkBody(resp, map[string]any{"rules": out})
		case http.MethodPost:
			return a.handleRecordRule(ctx, resp, person, body)
		}
	}

	// shares listing
	if path == "/api/shares" {
		calID := q.Get("calendar_id")
		return a.handleListShares(ctx, resp, person, calID)
	}

	// occurrences
	if path == "/api/occurrences" && method == http.MethodGet {
		return a.handleOccurrences(ctx, resp, person, q)
	}

	// events
	if path == "/api/events" && method == http.MethodPost {
		return a.handleCreateEvent(ctx, resp, person, body)
	}
	if strings.HasPrefix(path, "/api/events/") {
		rest := strings.TrimPrefix(path, "/api/events/")
		parts := strings.Split(rest, "/")
		id := parts[0]
		switch {
		case len(parts) == 1:
			switch method {
			case http.MethodGet:
				return a.handleGetEvent(ctx, resp, person, id, q.Get("occurrence_id"))
			case http.MethodPatch:
				return a.handlePatchEvent(ctx, resp, person, id, body)
			case http.MethodDelete:
				return a.handleDeleteEvent(ctx, resp, person, id, q.Get("scope"), q.Get("occurrence_id"), r.Header.Get("If-Match"))
			}
		case len(parts) == 2 && parts[1] == "duplicate" && method == http.MethodPost:
			return a.handleDuplicate(ctx, resp, person, id)
		case len(parts) == 2 && parts[1] == "move" && method == http.MethodPost:
			return a.handleMoveCalendar(ctx, resp, person, id, body, r.Header.Get("If-Match"))
		case len(parts) == 2 && parts[1] == "conflicts" && method == http.MethodGet:
			return a.handleConflicts(ctx, resp, person, id)
		case len(parts) == 2 && parts[1] == "guests" && method == http.MethodPost:
			return a.handleAddGuests(ctx, resp, person, id, body)
		case len(parts) == 3 && parts[1] == "guests" && method == http.MethodDelete:
			return a.handleRemoveGuest(ctx, resp, person, id, parts[2])
		case len(parts) == 3 && parts[1] == "replies" && parts[2] == "me" && method == http.MethodPut:
			return a.handleReply(ctx, resp, person, id, body)
		case len(parts) == 2 && parts[1] == "proposals" && method == http.MethodPost:
			return a.handlePropose(ctx, resp, person, id, body)
		case len(parts) == 2 && parts[1] == "share-link" && method == http.MethodPost:
			return a.handleShareLinkCreate(ctx, resp, person, id)
		case len(parts) == 2 && parts[1] == "share-link" && method == http.MethodDelete:
			return a.handleShareLinkDelete(ctx, resp, person, id)
		case len(parts) == 2 && parts[1] == "zone-moves" && method == http.MethodPost:
			return a.handleZoneMove(ctx, resp, person, id, body, r.Header.Get("If-Match"))
		}
	}

	// proposals
	if strings.HasPrefix(path, "/api/proposals/") {
		rest := strings.TrimPrefix(path, "/api/proposals/")
		parts := strings.Split(rest, "/")
		if len(parts) == 2 {
			switch parts[1] {
			case "accept":
				return a.handleProposalDecide(ctx, resp, person, parts[0], true)
			case "decline":
				return a.handleProposalDecide(ctx, resp, person, parts[0], false)
			}
		}
	}

	// trash
	if path == "/api/trash" && method == http.MethodGet {
		return a.handleTrashList(ctx, resp, person)
	}
	if strings.HasPrefix(path, "/api/trash/") {
		rest := strings.TrimPrefix(path, "/api/trash/")
		parts := strings.Split(rest, "/")
		if len(parts) == 2 && parts[1] == "restore" && method == http.MethodPost {
			return a.handleTrashRestore(ctx, resp, person, parts[0])
		}
		if len(parts) == 1 && method == http.MethodDelete {
			return a.handleTrashPurge(ctx, resp, person, parts[0])
		}
	}

	// search
	if path == "/api/search" && method == http.MethodGet {
		return a.handleSearch(ctx, resp, person, q.Get("q"))
	}

	// find a time
	if path == "/api/find-a-time" && method == http.MethodGet {
		return a.handleFindATime(ctx, resp, person, q)
	}

	// notices
	if path == "/api/notices" && method == http.MethodGet {
		notices, err := s.NoticesFor(ctx, person.ID)
		if err != nil {
			return err
		}
		out := []map[string]any{}
		for _, n := range notices {
			out = append(out, map[string]any{"id": n.ID, "kind": n.Kind, "text": n.Text, "created_at": n.CreatedAt.UTC().Format(time.RFC3339)})
		}
		return writeOkBody(resp, map[string]any{"notices": out})
	}

	// reminders
	if path == "/api/reminders" && method == http.MethodGet {
		return a.handleRemindersList(ctx, resp, person, q)
	}
	if strings.HasPrefix(path, "/api/reminders/") && strings.HasSuffix(path, "/snooze") && method == http.MethodPost {
		idStr := strings.TrimSuffix(strings.TrimPrefix(path, "/api/reminders/"), "/snooze")
		return a.handleSnooze(ctx, resp, person, idStr, body)
	}

	// prints
	if path == "/api/prints" {
		switch method {
		case http.MethodGet:
			return a.handlePrintsList(ctx, resp, person)
		case http.MethodPost:
			return a.handlePrintCreate(ctx, resp, person, body, r.Header.Get("Idempotency-Key"))
		}
	}
	if strings.HasPrefix(path, "/api/prints/") {
		rest := strings.TrimPrefix(path, "/api/prints/")
		parts := strings.Split(rest, "/")
		switch {
		case len(parts) == 1 && method == http.MethodGet:
			return a.handlePrintGet(ctx, resp, person, parts[0])
		case len(parts) == 2 && parts[1] == "retry" && method == http.MethodPost:
			return a.handlePrintRetry(ctx, resp, person, parts[0])
		case len(parts) == 2 && parts[1] == "pdf" && method == http.MethodGet:
			return a.handlePrintPDF(ctx, resp, person, parts[0])
		}
	}

	// exports
	if strings.HasPrefix(path, "/api/exports/") && strings.HasSuffix(path, "/file") {
		id := strings.TrimSuffix(strings.TrimPrefix(path, "/api/exports/"), "/file")
		return a.handleExportFile(ctx, resp, person, id)
	}

	// calendars list (again, in case the earlier switch missed)
	if path == "/api/calendars" {
		return a.handleCalendars(ctx, resp, person)
	}

	return apiErr(http.StatusNotFound, "not_found", "Nothing is scheduled at this address.")
}

func writeOkBody(resp *apiResponse, v any) error {
	writeJSON(resp.w, http.StatusOK, v)
	return nil
}

func writeOk(resp *apiResponse, v any) error {
	writeJSON(resp.w, http.StatusOK, v)
	return nil
}

func writeCreated(resp *apiResponse, v any) error {
	writeJSON(resp.w, http.StatusCreated, v)
	return nil
}

// LoadOrganiserNames fills the organiser name lookup from the people table.
func (a *App) LoadOrganiserNames(ctx context.Context) {
	people, err := a.store.AllPeople(ctx)
	if err != nil {
		return
	}
	m := map[string]string{}
	for _, p := range people {
		m[p.ID] = p.Name
	}
	organiserNames = m
}

func (a *App) handleHealthRaw(resp *apiResponse) error {
	if !a.dbReady {
		writeJSONStatus(resp.w, http.StatusServiceUnavailable, map[string]any{"status": "starting"})
		return nil
	}
	ctx, cancel := context.WithTimeout(resp.r.Context(), 2*time.Second)
	defer cancel()
	if err := a.store.Ping(ctx); err != nil {
		writeJSONStatus(resp.w, http.StatusServiceUnavailable, map[string]any{"status": "starting"})
		return nil
	}
	writeJSONStatus(resp.w, http.StatusOK, map[string]any{"status": "ok"})
	return nil
}

func (a *App) handleTime(resp *apiResponse) error {
	person, _ := personFromRequest(resp.r.Context(), a.store, resp.r)
	zone := "UTC"
	if person != nil {
		zone = person.Zone
	}
	writeJSON(resp.w, http.StatusOK, map[string]any{
		"now_utc": a.clock.RFC3339(), "zone": zone,
	})
	return nil
}

func (a *App) handleSignIn(ctx context.Context, resp *apiResponse, body []byte) error {
	var req struct {
		Email    string `json:"email"`
		Passcode string `json:"passcode"`
	}
	if err := jsonUnmarshal(body, &req); err != nil {
		return apiErr(422, "invalid", "That is not valid JSON.")
	}
	p, err := a.store.PersonByEmail(ctx, strings.TrimSpace(req.Email))
	if err != nil {
		return err
	}
	if p == nil || req.Passcode != seedPasscode {
		return apiErr(http.StatusUnauthorized, "bad_credentials", "That email and passcode do not match.")
	}
	token := uuid.NewString()
	if err := a.store.CreateSession(ctx, token, p.ID); err != nil {
		return err
	}
	setSessionCookie(resp.w, token)
	pp, _ := a.store.PersonByID(ctx, p.ID)
	writeJSON(resp.w, http.StatusOK, map[string]any{"person": map[string]any{
		"id": pp.ID, "name": pp.Name, "email": pp.Email, "zone": pp.Zone,
		"city": pp.City, "role": pp.Role, "week_start": pp.WeekStart,
		"hide_weekends": pp.HideWeekends, "custom_days": pp.CustomDays,
		"second_zone": pp.SecondZone,
	}})
	return nil
}

func (a *App) handlePatchMe(ctx context.Context, resp *apiResponse, person *Person, body []byte) error {
	var req map[string]any
	if err := jsonUnmarshal(body, &req); err != nil {
		return apiErr(422, "invalid", "That is not valid JSON.")
	}
	fields := map[string]string{}
	setClause := []string{}
	args := []any{}
	add := func(col string, v any) {
		setClause = append(setClause, col+" = $"+strconv.Itoa(len(args)+1))
		args = append(args, v)
	}
	if v, ok := req["zone"]; ok {
		zs, _ := v.(string)
		if _, ok := ZoneFor(zs); !ok {
			fields["zone"] = "Choose New York, London or Auckland."
		} else {
			add("zone", zs)
		}
	}
	if v, ok := req["week_start"]; ok {
		zs, _ := v.(string)
		switch zs {
		case "monday", "sunday", "saturday":
			add("week_start", zs)
		default:
			fields["week_start"] = "Choose Monday, Sunday or Saturday."
		}
	}
	if v, ok := req["hide_weekends"]; ok {
		b, _ := v.(bool)
		add("hide_weekends", b)
	}
	if v, ok := req["custom_days"]; ok {
		f, _ := v.(float64)
		n := int(f)
		if n < 2 || n > 7 {
			fields["custom_days"] = "Custom days must be from 2 to 7."
		} else {
			add("custom_days", n)
		}
	}
	if v, ok := req["second_zone"]; ok {
		if v == nil {
			add("second_zone", nil)
		} else {
			zs, _ := v.(string)
			if zs == "" {
				add("second_zone", nil)
			} else if _, ok := ZoneFor(zs); ok {
				add("second_zone", zs)
			} else {
				fields["second_zone"] = "Choose New York, London, Auckland or None."
			}
		}
	}
	if len(fields) > 0 {
		return apiFieldErr("Check the fields and try again.", fields)
	}
	if len(setClause) == 0 {
		p, _ := a.store.PersonByID(ctx, person.ID)
		writeJSON(resp.w, http.StatusOK, map[string]any{
			"id": p.ID, "name": p.Name, "email": p.Email, "zone": p.Zone,
			"city": p.City, "role": p.Role, "week_start": p.WeekStart,
			"hide_weekends": p.HideWeekends, "custom_days": p.CustomDays,
			"second_zone": p.SecondZone,
		})
		return nil
	}
	args = append(args, person.ID)
	sql := `INSERT INTO person_settings (person_id, week_start, hide_weekends, custom_days, second_zone)
	  VALUES ($1, 'monday', false, 4, NULL)
	  ON CONFLICT (person_id) DO UPDATE SET ` + strings.Join(setClause, ", ") + " WHERE person_id = $" + strconv.Itoa(len(args))
	if _, err := a.store.Pool().Exec(ctx, sql, args...); err != nil {
		return err
	}
	p, _ := a.store.PersonByID(ctx, person.ID)
	a.broadcaster.PushPersonal(p, p.ID, "settings.changed", map[string]any{
		"week_start": p.WeekStart, "hide_weekends": p.HideWeekends,
		"custom_days": p.CustomDays, "second_zone": p.SecondZone, "zone": p.Zone,
	})
	writeJSON(resp.w, http.StatusOK, map[string]any{
		"id": p.ID, "name": p.Name, "email": p.Email, "zone": p.Zone,
		"city": p.City, "role": p.Role, "week_start": p.WeekStart,
		"hide_weekends": p.HideWeekends, "custom_days": p.CustomDays,
		"second_zone": p.SecondZone,
	})
	return nil
}
