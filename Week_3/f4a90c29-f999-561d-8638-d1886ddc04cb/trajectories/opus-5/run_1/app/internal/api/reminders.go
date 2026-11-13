package api

import (
	"context"
	"net/http"
	"time"

	"sundialwren/internal/domain"
	"sundialwren/internal/store"
)

// reminderHorizon is how far ahead reminders are kept ready.
const reminderHorizon = 400 * 24 * time.Hour

func (s *Server) handleReminders(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	from, to, ok := s.readWindow(w, r, c, maxWindowDays, false)
	if !ok {
		return
	}
	reminders, err := s.Store.Reminders(r.Context(), c.Person.ID, from.Add(-reminderHorizon), to)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"reminders": reminders})
}

func (s *Server) handleSnooze(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	reminder, err := s.Store.Reminder(r.Context(), pathValue(r, "id"))
	if err != nil || reminder.PersonID != c.Person.ID {
		notFound(w)
		return
	}
	var body struct {
		Minutes int `json:"minutes"`
	}
	if readJSON(w, r, &body) != nil {
		return
	}
	switch body.Minutes {
	case 5, 10, 30:
	default:
		unprocessable(w, map[string]string{"minutes": "Snooze for 5, 10 or 30 minutes."})
		return
	}
	if reminder.Status != "fired" {
		writeError(w, http.StatusConflict, "not_fired", "Only a fired reminder can be snoozed.", nil)
		return
	}
	due := s.Clock.Now().Add(time.Duration(body.Minutes) * time.Minute)
	if err := s.Store.SnoozeReminder(r.Context(), reminder.ID, due); err != nil {
		s.fail(w, err)
		return
	}
	fresh, err := s.Store.Reminder(r.Context(), reminder.ID)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, fresh)
}

// syncReminders is the one place an event's reminders are decided: one per
// person among the calendar's owner and the guests not answering no, for each
// occurrence in the horizon.
func (s *Server) syncReminders(ctx context.Context, e *domain.Event) {
	now := s.Clock.Now()
	existing, err := s.Store.RemindersForEvent(ctx, e.ID)
	if err != nil {
		return
	}
	if e.TrashedAt != nil || e.CalendarID == domain.HolidaysCalendarID {
		return
	}
	cal, err := s.Store.Calendar(ctx, e.CalendarID)
	if err != nil {
		return
	}
	rules, err := s.Store.ZoneRules(ctx)
	if err != nil {
		return
	}
	expander := domain.Expander{Rules: rules, Now: now}

	type want struct {
		key      string
		personID string
		minutes  int
		allDay   bool
		due      time.Time
	}
	wanted := map[string]want{}
	horizonEnd := domain.WallFromUTC(now.Add(reminderHorizon))
	for _, o := range expander.Expand(e, &horizonEnd, 0) {
		if o.Deleted {
			continue
		}
		start, _ := o.Instants()
		if start.Before(now.Add(-reminderHorizon)) {
			continue
		}
		for _, personID := range s.reminderPeople(ctx, e, cal, o.Key) {
			person, err := s.Store.Person(ctx, personID)
			if err != nil {
				continue
			}
			if e.AllDay {
				day := o.ShownStart.AddDays(-1)
				due, _, _ := domain.Resolve(domain.Wall{Y: day.Y, M: day.M, D: day.D, H: 17, Min: 0}, person.Zone)
				wanted[o.Key+"|"+personID+"|allday"] = want{o.Key, personID, 0, true, due}
				continue
			}
			for _, minutes := range e.Reminders {
				due := start.Add(-time.Duration(minutes) * time.Minute)
				wanted[o.Key+"|"+personID+"|"+itoa(minutes)] = want{o.Key, personID, minutes, false, due}
			}
		}
	}

	have := map[string]store.Reminder{}
	for _, r := range existing {
		suffix := itoa(r.Minutes)
		if r.AllDay {
			suffix = "allday"
		}
		key := r.Key + "|" + r.PersonID + "|" + suffix
		have[key] = r
		if _, ok := wanted[key]; !ok && r.Status == "scheduled" {
			_ = s.Store.DeleteReminder(ctx, r.ID)
		}
	}
	for key, want := range wanted {
		if r, ok := have[key]; ok {
			if r.Status == "scheduled" && !r.Due.Equal(want.due) {
				_ = s.Store.SetReminderDue(ctx, r.ID, want.due)
			}
			continue
		}
		if !want.due.After(now) && !s.stillAhead(e, want.key, want.personID, want.allDay, now) {
			continue
		}
		_ = s.Store.InsertReminder(ctx, store.Reminder{
			ID: newID("rmd"), EventID: e.ID, Key: want.key, PersonID: want.personID,
			Minutes: want.minutes, AllDay: want.allDay, Due: want.due,
		})
	}
}

// stillAhead reports whether a reminder already past due may still fire: the
// occurrence has not started, or for an all-day one its day is not over.
func (s *Server) stillAhead(e *domain.Event, key, personID string, allDay bool, now time.Time) bool {
	rules, err := s.Store.ZoneRules(context.Background())
	if err != nil {
		return false
	}
	expander := domain.Expander{Rules: rules, Now: now}
	o := expander.One(e, key)
	if o == nil {
		return false
	}
	start, end := o.Instants()
	if allDay {
		return now.Before(end)
	}
	return now.Before(start)
}

// reminderPeople lists who an occurrence reminds: the calendar's owner and the
// guests not answering no.
func (s *Server) reminderPeople(ctx context.Context, e *domain.Event, cal domain.Calendar, key string) []string {
	seen := map[string]bool{}
	var out []string
	if cal.OwnerID != nil {
		out = append(out, *cal.OwnerID)
		seen[*cal.OwnerID] = true
	}
	for _, g := range e.Guests {
		if seen[g.PersonID] {
			continue
		}
		answer, _ := e.ReplyFor(key, g.PersonID)
		if answer == domain.AnswerNo {
			continue
		}
		seen[g.PersonID] = true
		out = append(out, g.PersonID)
	}
	_ = ctx
	return out
}

// RunReminders fires every due reminder once, on the server clock.
func (s *Server) RunReminders(ctx context.Context) {
	ticker := time.NewTicker(300 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.fireDueReminders(ctx)
		}
	}
}

func (s *Server) fireDueReminders(ctx context.Context) {
	now := s.Clock.Now()
	due, err := s.Store.DueReminders(ctx, now)
	if err != nil {
		return
	}
	for _, reminder := range due {
		e, err := s.Store.Event(ctx, reminder.EventID)
		if err != nil || e.TrashedAt != nil {
			continue
		}
		fired, err := s.Store.FireReminder(ctx, reminder.ID, now)
		if err != nil || !fired {
			continue
		}
		person, err := s.Store.Person(ctx, reminder.PersonID)
		if err != nil {
			continue
		}
		text := reminderAllDay(e.Title)
		if !reminder.AllDay {
			rules, _ := s.Store.ZoneRules(ctx)
			expander := domain.Expander{Rules: rules, Now: now}
			o := expander.One(e, reminder.Key)
			at := o.ShownStart.Clock()
			if o.StartUTC != nil {
				at = domain.InZone(*o.StartUTC, person.Zone).Clock()
			}
			text = reminderTimed(e.Title, at, person.City)
		}
		s.notify(ctx, person.ID, noticeReminder, text, e.ID, "")
		fresh, err := s.Store.Reminder(ctx, reminder.ID)
		if err != nil {
			continue
		}
		s.publish(ctx, changeReminder, changeSpec{
			PersonID: person.ID, EventID: e.ID, Reminder: &fresh, Text: text,
		})
	}
}

// RunSweeps keeps the trash purged, within the published five seconds of its
// retention ending, and the reminder horizon filled.
func (s *Server) RunSweeps(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	rounds := 0
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.purgeTrash(ctx)
			if rounds%15 == 0 {
				s.refreshReminders(ctx)
			}
			rounds++
		}
	}
}

func (s *Server) purgeTrash(ctx context.Context) {
	items, err := s.Store.DuePurges(ctx, s.Clock.Now())
	if err != nil {
		return
	}
	for _, item := range items {
		switch item.Kind {
		case "occurrence":
			_ = s.Store.SetTrashState(ctx, item.ID, "purged")
		default:
			_ = s.Store.PurgeEvent(ctx, item.EventID)
		}
		s.publish(ctx, changeDeleted, changeSpec{EventID: item.EventID, CalendarID: item.CalendarID})
	}
}

func (s *Server) refreshReminders(ctx context.Context) {
	events, err := s.Store.AllLiveEvents(ctx)
	if err != nil {
		return
	}
	for _, e := range events {
		if !e.AllDay && len(e.Reminders) == 0 {
			continue
		}
		s.syncReminders(ctx, e)
	}
}
