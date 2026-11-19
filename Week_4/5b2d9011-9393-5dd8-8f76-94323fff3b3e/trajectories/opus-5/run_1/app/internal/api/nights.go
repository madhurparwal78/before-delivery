package api

import (
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/cinderlatch/holdfast/internal/apierr"
	"github.com/cinderlatch/holdfast/internal/calendar"
	"github.com/cinderlatch/holdfast/internal/mailer"
	"github.com/cinderlatch/holdfast/internal/store"
)

func (s *Server) handleNights(w http.ResponseWriter, r *http.Request) {
	now := s.clock.Now()
	from := calendar.StudioDate(now, s.zone)
	days := 28

	query := r.URL.Query()
	fields := map[string]string{}
	if raw := query.Get("from"); raw != "" {
		parsed, ok := calendar.ParseDate(raw)
		if !ok {
			fields["from"] = "Use YYYY-MM-DD."
		} else {
			from = parsed
		}
	}
	if raw := query.Get("days"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 90 {
			fields["days"] = "Use a whole number from 1 to 90."
		} else {
			days = parsed
		}
	}
	if len(fields) > 0 {
		apierr.Write(w, apierr.Validation(fields))
		return
	}

	rows, err := s.store.NightsBetween(r.Context(), from, from.AddDate(0, 0, days-1))
	if err != nil {
		apierr.Write(w, apierr.StorageUnavailable())
		return
	}
	views := make([]calendar.NightView, 0, len(rows))
	for _, row := range rows {
		views = append(views, calendar.Build(row, s.zone, now))
	}
	sort.SliceStable(views, func(i, j int) bool {
		return views[i].StartsAtTime().Before(views[j].StartsAtTime())
	})
	writeJSON(w, http.StatusOK, map[string]any{"zone": s.zone.String(), "nights": views})
}

func (s *Server) night(r *http.Request) (calendar.NightView, *apierr.Error) {
	row, found, err := s.store.NightByID(r.Context(), r.PathValue("id"))
	if err != nil {
		return calendar.NightView{}, apierr.StorageUnavailable()
	}
	if !found {
		return calendar.NightView{}, apierr.NotFound()
	}
	return calendar.Build(row, s.zone, s.clock.Now()), nil
}

func (s *Server) handleNight(w http.ResponseWriter, r *http.Request) {
	view, failure := s.night(r)
	if failure != nil {
		apierr.Write(w, failure)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

func (s *Server) handleCreateSeries(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title     string `json:"title"`
		Mode      string `json:"mode"`
		Weekday   string `json:"weekday"`
		LocalTime string `json:"local_time"`
		FirstDate string `json:"first_date"`
		Weeks     *int   `json:"weeks"`
		Capacity  *int   `json:"capacity"`
	}
	if failure := decode(r, &body); failure != nil {
		apierr.Write(w, failure)
		return
	}
	if _, failure := s.founder(r); failure != nil {
		apierr.Write(w, failure)
		return
	}

	fields := map[string]string{}
	title := strings.TrimSpace(body.Title)
	if len([]rune(title)) < 1 || len([]rune(title)) > 60 {
		fields["title"] = msgTitle
	}
	if body.Mode != "siege" && body.Mode != "convoy" {
		fields["mode"] = "Pick either siege or convoy."
	}
	weekday, knownWeekday := calendar.Weekdays[strings.ToLower(body.Weekday)]
	if !knownWeekday {
		fields["weekday"] = "Pick a weekday."
	}
	if _, _, ok := calendar.ParseHHMM(body.LocalTime); !ok {
		fields["local_time"] = msgLocalTime
	}
	if body.Weeks == nil || *body.Weeks < 1 || *body.Weeks > 26 {
		fields["weeks"] = msgWeeks
	}
	if body.Capacity == nil || *body.Capacity < 1 || *body.Capacity > 64 {
		fields["capacity"] = msgCapacity
	}

	firstDate, dateOK := calendar.ParseDate(body.FirstDate)
	firstDateMessage := "Must be a " + calendar.WeekdayTitle(strings.ToLower(body.Weekday)) + " after today, studio time."
	switch {
	case !dateOK:
		fields["first_date"] = firstDateMessage
	case knownWeekday && firstDate.Weekday() != weekday:
		fields["first_date"] = firstDateMessage
	}

	if len(fields) == 0 {
		candidate := store.Night{Date: firstDate, ScheduledLocalTime: body.LocalTime}
		starts, _, _ := calendar.Resolve(candidate, s.zone)
		if !starts.After(s.clock.Now()) {
			fields["first_date"] = firstDateMessage
		}
	}
	if len(fields) > 0 {
		apierr.Write(w, apierr.Validation(fields))
		return
	}

	series, nights, err := s.store.CreateSeries(r.Context(), store.Series{
		Title: title, Mode: body.Mode, Weekday: strings.ToLower(body.Weekday),
		LocalTime: body.LocalTime, FirstDate: firstDate,
		Weeks: *body.Weeks, Capacity: *body.Capacity,
	}, calendar.SeriesDates(firstDate, *body.Weeks))
	if err != nil {
		apierr.Write(w, apierr.StorageUnavailable())
		return
	}

	now := s.clock.Now()
	views := make([]calendar.NightView, 0, len(nights))
	for _, night := range nights {
		views = append(views, calendar.Build(night, s.zone, now))
	}
	writeJSON(w, http.StatusCreated, map[string]any{"series": series, "nights": views})
}

func (s *Server) handleCreateSignup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name       string `json:"name"`
		Email      string `json:"email"`
		ViewerZone string `json:"viewer_zone"`
	}
	if failure := decode(r, &body); failure != nil {
		apierr.Write(w, failure)
		return
	}
	night, failure := s.night(r)
	if failure != nil {
		apierr.Write(w, failure)
		return
	}

	fields := map[string]string{}
	name := strings.TrimSpace(body.Name)
	if len([]rune(name)) < 1 || len([]rune(name)) > 40 {
		fields["name"] = msgName
	}
	email := strings.TrimSpace(body.Email)
	emailOK := validEmail(email)
	if !emailOK {
		fields["email"] = msgEmail
	}
	if _, err := time.LoadLocation(body.ViewerZone); err != nil || body.ViewerZone == "" {
		fields["viewer_zone"] = msgViewerZone
	}

	// A repeat is a replay, so it is answered even after sign-ups close.
	if emailOK {
		existing, found, err := s.store.SignupByEmail(r.Context(), night.ID, email)
		if err != nil {
			apierr.Write(w, apierr.StorageUnavailable())
			return
		}
		if found {
			writeJSON(w, http.StatusOK, map[string]any{
				"signup": existing, "email_status": mailer.StatusAlreadySignedUp,
			})
			return
		}
	}

	switch night.Status {
	case calendar.StatusScheduled:
		apierr.Write(w, apierr.New(http.StatusConflict, "signups_not_open",
			"Sign-ups for this night have not opened yet."))
		return
	case calendar.StatusSignupsOpen:
	default:
		apierr.Write(w, apierr.New(http.StatusConflict, "signups_closed",
			"Sign-ups for this night are closed."))
		return
	}
	if night.SeatsLeft <= 0 {
		apierr.Write(w, apierr.New(http.StatusConflict, "night_full", "This night is full."))
		return
	}
	if len(fields) > 0 {
		apierr.Write(w, apierr.Validation(fields))
		return
	}

	signup, created, err := s.store.CreateSignup(r.Context(), night.ID, name, email, body.ViewerZone, s.clock.Now())
	if errors.Is(err, store.ErrNightFull) {
		apierr.Write(w, apierr.New(http.StatusConflict, "night_full", "This night is full."))
		return
	}
	if err != nil {
		apierr.Write(w, apierr.StorageUnavailable())
		return
	}
	if !created {
		writeJSON(w, http.StatusOK, map[string]any{
			"signup": signup, "email_status": mailer.StatusAlreadySignedUp,
		})
		return
	}

	status := s.outbox.QueueAndSend(r.Context(),
		mailer.Confirmation(signup, night, s.zone.String()))
	writeJSON(w, http.StatusCreated, map[string]any{"signup": signup, "email_status": status})
}

func (s *Server) handleListSignups(w http.ResponseWriter, r *http.Request) {
	if _, failure := s.founder(r); failure != nil {
		apierr.Write(w, failure)
		return
	}
	night, failure := s.night(r)
	if failure != nil {
		apierr.Write(w, failure)
		return
	}
	signups, err := s.store.SignupsForNight(r.Context(), night.ID)
	if err != nil {
		apierr.Write(w, apierr.StorageUnavailable())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"signups": signups})
}

// validEmail reports whether an address has one local part, one at sign and a
// dotted domain.
func validEmail(address string) bool {
	at := strings.IndexByte(address, '@')
	if at < 1 || at != strings.LastIndexByte(address, '@') {
		return false
	}
	local, domain := address[:at], address[at+1:]
	if local == "" || strings.ContainsAny(address, " \t\r\n\"") {
		return false
	}
	dot := strings.IndexByte(domain, '.')
	if dot < 1 || dot == len(domain)-1 || strings.Contains(domain, "..") {
		return false
	}
	return !strings.HasPrefix(domain, "-") && !strings.HasSuffix(domain, ".")
}
