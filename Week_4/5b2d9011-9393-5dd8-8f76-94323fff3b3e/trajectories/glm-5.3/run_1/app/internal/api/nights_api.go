package api

import (
	"net/http"
	"strings"
	"time"

	"holdfast/internal/apperr"
	"holdfast/internal/httpx"
	"holdfast/internal/store"
	"holdfast/internal/studio"
	"holdfast/internal/zoneinfo"
)

func (a *App) handleNights(w http.ResponseWriter, r *http.Request, rest string) {
	rest = strings.TrimPrefix(rest, "/")
	switch {
	case rest == "" && r.Method == http.MethodGet:
		a.handleNightsList(w, r)
	case rest == "series" && r.Method == http.MethodPost:
		a.handleNightsSeries(w, r)
	case strings.HasSuffix(rest, "/signups") && r.Method == http.MethodPost:
		a.handleSignup(w, r, strings.TrimSuffix(rest, "/signups"))
	case strings.HasSuffix(rest, "/signups") && r.Method == http.MethodGet:
		a.handleSignupList(w, r, strings.TrimSuffix(rest, "/signups"))
	case rest != "" && !strings.Contains(rest, "/"):
		if r.Method != http.MethodGet {
			httpx.WriteError(w, apperr.NotFound)
			return
		}
		a.handleNightGet(w, rest)
	default:
		httpx.WriteError(w, apperr.NotFound)
	}
}

// nightView renders one night with its server-decided status.
func (a *App) nightView(n store.Night, now time.Time) map[string]any {
	status, nextIn := nightStatus(n, now)
	signedUp := a.signedUpCount(n.ID)
	seatsLeft := n.Capacity - signedUp
	if seatsLeft < 0 {
		seatsLeft = 0
	}
	var statusIn any
	if nextIn != nil {
		statusIn = *nextIn
	}
	var dst any
	if n.DstNote != nil {
		dst = n.DstNote
	}
	return map[string]any{
		"id": n.ID, "series_id": n.SeriesID, "title": n.Title, "mode": n.Mode,
		"date": n.Date, "scheduled_local_time": n.LocalTime, "local_start": n.LocalStart,
		"utc_offset": n.UTCOffset, "zone_abbr": n.ZoneAbbr,
		"starts_at": clockInstant(n.StartsAt),
		"signups_open_at": clockInstant(n.SignupsOpenAt),
		"signups_close_at": clockInstant(n.SignupsCloseAt),
		"ends_at": clockInstant(n.EndsAt),
		"status": status, "status_changes_in_ms": statusIn,
		"capacity": n.Capacity, "signed_up": signedUp, "seats_left": seatsLeft,
		"dst_note": dst,
	}
}

// nightStatus decides a night's status from the server clock.
func nightStatus(n store.Night, now time.Time) (string, *int64) {
	switch {
	case now.Before(n.SignupsOpenAt):
		d := n.SignupsOpenAt.Sub(now).Milliseconds()
		return "scheduled", &d
	case now.Before(n.SignupsCloseAt):
		d := n.SignupsCloseAt.Sub(now).Milliseconds()
		return "signups_open", &d
	case now.Before(n.StartsAt):
		d := n.StartsAt.Sub(now).Milliseconds()
		return "closed", &d
	case now.Before(n.EndsAt):
		d := n.EndsAt.Sub(now).Milliseconds()
		return "live", &d
	default:
		return "done", nil
	}
}

func (a *App) signedUpCount(nightID string) int {
	ctx, cancel := ctxWithTimeout()
	defer cancel()
	n, err := a.Store.CountSignups(ctx, nightID)
	if err != nil {
		return 0
	}
	return n
}

func (a *App) handleNightsList(w http.ResponseWriter, r *http.Request) {
	if err := a.requireStorage(); err != nil {
		httpx.WriteError(w, err)
		return
	}
	from := a.Clock.Now().In(a.Studio.Loc).Format("2006-01-02")
	if f := r.URL.Query().Get("from"); f != "" {
		if !validDate(f) {
			httpx.WriteError(w, apperr.SingleValidation("from", "Use YYYY-MM-DD."))
			return
		}
		from = f
	}
	days := 28
	if s := r.URL.Query().Get("days"); s != "" {
		n, ok := atoiSafe(s)
		if !ok || n < 1 || n > 90 {
			httpx.WriteError(w, apperr.SingleValidation("days", "Use 1 to 90."))
			return
		}
		days = n
	}
	ctx, cancel := ctxWithTimeout()
	defer cancel()
	nights, err := a.Store.NightsWindow(ctx, from, days)
	if err != nil {
		httpx.WriteError(w, apperr.StorageUnavailable)
		return
	}
	now := a.Clock.Now().UTC()
	views := make([]map[string]any, 0, len(nights))
	for _, n := range nights {
		views = append(views, a.nightView(n, now))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"zone": a.Studio.Name, "nights": views})
}

func validDate(s string) bool {
	if len(s) != 10 || s[4] != '-' || s[7] != '-' {
		return false
	}
	_, err := time.Parse("2006-01-02", s)
	return err == nil
}

func (a *App) handleNightGet(w http.ResponseWriter, id string) {
	if err := a.requireStorage(); err != nil {
		httpx.WriteError(w, err)
		return
	}
	ctx, cancel := ctxWithTimeout()
	defer cancel()
	n, err := a.Store.NightByID(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			httpx.WriteError(w, apperr.NotFound)
			return
		}
		httpx.WriteError(w, apperr.StorageUnavailable)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, a.nightView(n, a.Clock.Now().UTC()))
}

// seriesBody is the series creation request.
type seriesBody struct {
	Title     string `json:"title"`
	Mode      string `json:"mode"`
	Weekday   string `json:"weekday"`
	LocalTime string `json:"local_time"`
	FirstDate string `json:"first_date"`
	Weeks     *int   `json:"weeks"`
	Capacity  *int   `json:"capacity"`
}

var weekdays = map[string]time.Weekday{
	"monday": time.Monday, "tuesday": time.Tuesday, "wednesday": time.Wednesday,
	"thursday": time.Thursday, "friday": time.Friday, "saturday": time.Saturday,
	"sunday": time.Sunday,
}

func (a *App) handleNightsSeries(w http.ResponseWriter, r *http.Request) {
	player, aerr := a.authenticate(r)
	if aerr != nil {
		httpx.WriteError(w, aerr)
		return
	}
	if err := a.requireStorage(); err != nil {
		httpx.WriteError(w, err)
		return
	}
	if player.Role != "founder" {
		httpx.WriteError(w, apperr.ForbiddenRole())
		return
	}
	var body seriesBody
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteError(w, err)
		return
	}
	fields := map[string]string{}
	title := strings.TrimSpace(body.Title)
	if len(title) < 1 || len(title) > 60 {
		fields["title"] = "Use 1 to 60 characters."
	}
	if body.Mode != "siege" && body.Mode != "convoy" {
		fields["mode"] = "Pick siege or convoy."
	}
	wd, wdOK := weekdays[strings.ToLower(body.Weekday)]
	if !wdOK {
		fields["weekday"] = "Pick a weekday."
	}
	hh, mm, timeOK := parseHHMM(body.LocalTime)
	if !timeOK {
		fields["local_time"] = "Use HH:MM, 24-hour."
	}
	firstDate, dateOK := parseDateOnly(body.FirstDate)
	if !dateOK {
		fields["first_date"] = "Must be a " + capitalize(strings.ToLower(body.Weekday)) + " after today, studio time."
	} else if int(firstDate.Weekday()) != int(wd) {
		fields["first_date"] = "Must be a " + capitalize(strings.ToLower(body.Weekday)) + " after today, studio time."
	}
	if body.Weeks == nil || *body.Weeks < 1 || *body.Weeks > 26 {
		fields["weeks"] = "Use 1 to 26."
	}
	if body.Capacity == nil || *body.Capacity < 1 || *body.Capacity > 64 {
		fields["capacity"] = "Use 1 to 64."
	}
	if len(fields) > 0 {
		httpx.WriteError(w, apperr.Validation(fields))
		return
	}

	// Expand the series: each week's night from that wall time in the studio
	// zone, so the wall-clock time holds across daylight-saving changes.
	var nights []store.Night
	seriesID := store.NewID()
	for i := 0; i < *body.Weeks; i++ {
		date := firstDate.AddDate(0, 0, 7*i)
		startsAt, rule := studio.ExpandInZone(date.Year(), int(date.Month()), date.Day(), hh, mm, a.Studio.Loc)
		if i == 0 && !startsAt.After(a.Clock.Now()) {
			httpx.WriteError(w, apperr.SingleValidation("first_date",
				"Must be a "+capitalize(strings.ToLower(body.Weekday))+" after today, studio time."))
			return
		}
		localStart := date.Format("2006-01-02") + "T" + pad2(hh) + ":" + pad2(mm)
		if rule == studio.ShiftedForward {
			// The wall time moved forward by the length of the gap.
			ls := startsAt.In(a.Studio.Loc)
			localStart = ls.Format("2006-01-02") + "T" + ls.Format("15:04")
		}
		n := store.Night{
			ID: store.NewID(), SeriesID: seriesID, Title: title, Mode: body.Mode,
			Date: date.Format("2006-01-02"), LocalTime: body.LocalTime,
			LocalStart: localStart,
			UTCOffset: zoneinfo.UTCOffset(startsAt, a.Studio.Loc),
			ZoneAbbr: zoneinfo.Abbr(startsAt, a.Studio.Loc),
			StartsAt: startsAt,
			SignupsOpenAt: startsAt.Add(-studio.SignupsLeadHours * time.Hour),
			SignupsCloseAt: startsAt.Add(-studio.SignupsCloseLead),
			EndsAt: startsAt.Add(studio.NightDuration),
			DstNote: rule.Note(),
			Capacity: *body.Capacity,
		}
		nights = append(nights, n)
	}
	ctx, cancel := ctxWithTimeout()
	defer cancel()
	if err := a.Store.CreateSeries(ctx, seriesID, title, body.Mode, strings.ToLower(body.Weekday),
		body.LocalTime, body.FirstDate, *body.Weeks, *body.Capacity, nights); err != nil {
		httpx.WriteError(w, apperr.StorageUnavailable)
		return
	}
	views := make([]map[string]any, 0, len(nights))
	now := a.Clock.Now().UTC()
	for _, n := range nights {
		views = append(views, a.nightView(n, now))
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{
		"series": map[string]any{
			"id": seriesID, "title": title, "mode": body.Mode,
			"weekday": strings.ToLower(body.Weekday), "local_time": body.LocalTime,
			"first_date": body.FirstDate, "weeks": *body.Weeks, "capacity": *body.Capacity,
		},
		"nights": views,
	})
}

func capitalize(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

func pad2(n int) string {
	if n < 10 {
		return "0" + string(rune('0'+n))
	}
	return string(rune('0'+n/10)) + string(rune('0'+n%10))
}

func parseHHMM(s string) (int, int, bool) {
	parts := strings.Split(s, ":")
	if len(parts) != 2 || len(parts[0]) != 2 || len(parts[1]) != 2 {
		return 0, 0, false
	}
	hh, ok1 := atoiSafe(parts[0])
	mm, ok2 := atoiSafe(parts[1])
	if !ok1 || !ok2 || hh < 0 || hh > 23 || mm < 0 || mm > 59 {
		return 0, 0, false
	}
	return hh, mm, true
}

func parseDateOnly(s string) (time.Time, bool) {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}
