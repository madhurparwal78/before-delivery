package api

import (
	"errors"
	"io"
	"net/http"

	"sundialwren/internal/domain"
	"sundialwren/internal/ics"
	"sundialwren/internal/objstore"
)

func (s *Server) handleExport(w http.ResponseWriter, r *http.Request) {
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
	level, ok := c.Viewer.Levels[id]
	if !ok {
		notFound(w)
		return
	}
	if level == domain.LevelFreeBusy {
		forbidden(w, "forbidden")
		return
	}
	events, err := s.Store.EventsOnCalendar(r.Context(), id)
	if err != nil {
		s.fail(w, err)
		return
	}
	var readable []*domain.Event
	for _, e := range events {
		if c.Viewer.CanRead(e) {
			readable = append(readable, e)
		}
	}
	text := ics.Write(cal.Name, readable)
	exportID := newID("exp")
	key := "exports/" + exportID + ".ics"
	if err := s.Objects.Put(key, "text/calendar", []byte(text)); err != nil {
		s.storageError(w, err)
		return
	}
	size := int64(len(text))
	if _, err := s.Objects.Size(key); err != nil {
		s.storageError(w, err)
		return
	}
	if err := s.Store.InsertICSFile(r.Context(), exportID, "export", id, key, size, s.Clock.Now()); err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id": exportID, "object_key": key, "size_bytes": size,
		"url": "/api/exports/" + exportID + "/file",
	})
}

func (s *Server) handleExportFile(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	key, calendarID, err := s.Store.ICSFile(r.Context(), pathValue(r, "id"))
	if err != nil {
		notFound(w)
		return
	}
	if _, ok := c.Viewer.Levels[calendarID]; !ok {
		notFound(w)
		return
	}
	data, err := s.Objects.Get(key)
	if err != nil {
		s.storageError(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/calendar")
	w.Header().Set("Content-Disposition", `attachment; filename="wren-calendar.ics"`)
	_, _ = w.Write(data)
}

func (s *Server) handleImport(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	id := pathValue(r, "id")
	if _, err := s.Store.Calendar(r.Context(), id); err != nil {
		notFound(w)
		return
	}
	if !c.Viewer.CanEditCalendar(id) {
		forbidden(w, "forbidden")
		return
	}
	data, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "unreadable", "That file could not be read.", nil)
		return
	}
	if len(data) > maxUploadBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "too_large", "That file is larger than this endpoint takes.", nil)
		return
	}
	components, err := ics.Parse(string(data))
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_icalendar", "That file is not a readable iCalendar file.", nil)
		return
	}
	// The file is stored and confirmed before any event is created.
	importID := newID("imp")
	key := "imports/" + importID + ".ics"
	if err := s.Objects.Put(key, "text/calendar", data); err != nil {
		s.storageError(w, err)
		return
	}
	if _, err := s.Objects.Size(key); err != nil {
		s.storageError(w, err)
		return
	}
	if err := s.Store.InsertICSFile(r.Context(), importID, "import", id, key, int64(len(data)), s.Clock.Now()); err != nil {
		s.fail(w, err)
		return
	}

	created, updated := 0, 0
	skipped := []map[string]string{}
	byUID := map[string][]ics.Component{}
	var order []string
	for _, component := range components {
		if _, ok := byUID[component.UID]; !ok {
			order = append(order, component.UID)
		}
		byUID[component.UID] = append(byUID[component.UID], component)
	}
	for _, uid := range order {
		parts := byUID[uid]
		var master *ics.Component
		for i := range parts {
			if parts[i].RecurrenceID == "" {
				master = &parts[i]
				break
			}
		}
		if master == nil {
			skipped = append(skipped, map[string]string{"uid": uid, "reason": "No main event in the file."})
			continue
		}
		zone := master.Zone
		if !domain.ValidZone(zone) {
			zone = c.Person.Zone
		}
		endLocal := master.End
		if master.AllDay {
			endLocal = master.End.AddDays(-1)
		}
		if master.RRule != "" {
			if _, err := domain.ParseRRule(master.RRule, master.Start); err != nil {
				skipped = append(skipped, map[string]string{"uid": uid, "reason": domain.RRuleError})
				continue
			}
		}
		eventID := newID("evt")
		existingID, known := s.Store.ImportedEventID(r.Context(), id, uid)
		if known == nil {
			// Importing a UID this calendar already holds replaces that event,
			// so nothing doubles.
			if err := s.Store.PurgeEvent(r.Context(), existingID); err != nil {
				s.fail(w, err)
				return
			}
			updated++
		} else {
			created++
		}
		e := &domain.Event{
			ID: eventID, CalendarID: id, SeriesID: eventID, OrganiserID: c.Person.ID,
			Title: master.Summary, Location: master.Location, Notes: master.Description,
			Kind: master.Kind, Colour: "Calendar colour", Reminders: []int{},
			AllDay: master.AllDay, StartLocal: master.Start.Local(master.AllDay),
			EndLocal: endLocal.Local(master.AllDay), Zone: zone,
			Visibility: domain.VisibilityDefault, RRule: master.RRule,
			Switches: c.Settings.GuestDefaults, Version: 1,
			SavedAt: s.Clock.Now(), SavedByID: c.Person.ID,
		}
		if master.Private {
			e.Visibility = domain.VisibilityPrivate
		}
		cal, err := s.Store.Calendar(r.Context(), id)
		if err == nil && cal.OwnerID != nil {
			e.OrganiserID = *cal.OwnerID
		}
		if err := s.Store.InsertEvent(r.Context(), e); err != nil {
			skipped = append(skipped, map[string]string{"uid": uid, "reason": "That event could not be stored."})
			if created > 0 {
				created--
			}
			continue
		}
		if err := s.Store.RememberImportedUID(r.Context(), id, uid, e.ID); err != nil {
			s.fail(w, err)
			return
		}
		for _, deleted := range master.ExDates {
			_ = s.Store.PutException(r.Context(), e.ID, domain.Exception{Key: deleted, Deleted: true})
		}
		for _, part := range parts {
			if part.RecurrenceID == "" {
				continue
			}
			start := part.Start.Local(part.AllDay)
			partEnd := part.End
			if part.AllDay {
				partEnd = part.End.AddDays(-1)
			}
			end := partEnd.Local(part.AllDay)
			title, location, notes := part.Summary, part.Location, part.Description
			_ = s.Store.PutException(r.Context(), e.ID, domain.Exception{
				Key: part.RecurrenceID, StartLocal: &start, EndLocal: &end,
				Title: &title, Location: &location, Notes: &notes,
			})
		}
		fresh, err := s.Store.Event(r.Context(), e.ID)
		if err == nil {
			s.syncReminders(r.Context(), fresh)
			s.publish(r.Context(), changeEvent, changeSpec{EventID: fresh.ID, CalendarID: fresh.CalendarID})
		}
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id": importID, "object_key": key, "created": created, "updated": updated, "skipped": skipped,
	})
}

func (s *Server) storageError(w http.ResponseWriter, err error) {
	var unavailable objstore.Unavailable
	if errors.As(err, &unavailable) {
		writeError(w, http.StatusServiceUnavailable, "file_storage_unavailable", fileStorageMessage, nil)
		return
	}
	writeError(w, http.StatusServiceUnavailable, "file_storage_unavailable", fileStorageMessage, nil)
}
