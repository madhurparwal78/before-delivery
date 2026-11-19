package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	signupOpensBefore  = 168 * time.Hour
	signupClosesBefore = 2 * time.Hour
	nightLength        = 3 * time.Hour
)

var weekdays = []string{"sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"}

func weekdayIndex(name string) int {
	for i, d := range weekdays {
		if d == name {
			return i
		}
	}
	return -1
}

// seriesSpec is a weekly series: its weekday and studio wall time, parsed once.
type seriesSpec struct {
	title, mode, weekday string
	localTime            string
	hour, minute         int
	firstDate            string
	first                time.Time
	weeks, capacity      int
}

var localTimePattern = regexp.MustCompile(`^([01]\d|2[0-3]):([0-5]\d)$`)

func parseWallTime(s string) (hour, minute int, err error) {
	m := localTimePattern.FindStringSubmatch(s)
	if m == nil {
		return 0, 0, fmt.Errorf("local time %q is not HH:MM", s)
	}
	if hour, err = strconv.Atoi(m[1]); err != nil {
		return 0, 0, err
	}
	minute, err = strconv.Atoi(m[2])
	return hour, minute, err
}

type nightRow struct {
	ID, SeriesID, Title, Mode, Date, ScheduledLocalTime string
	StartsAt                                            time.Time
	Capacity                                            int
	DstNote                                             string
	SignedUp                                            int
}

// expandSeries makes one night per week from the series' studio wall time, so 20:00 stays 20:00
// on both sides of a daylight-saving change.
func expandSeries(seriesID string, spec seriesSpec, idFor func(i int) string) []nightRow {
	nights := make([]nightRow, 0, spec.weeks)
	for i := 0; i < spec.weeks; i++ {
		day := spec.first.AddDate(0, 0, 7*i)
		at, note := resolveStudioWall(day.Year(), day.Month(), day.Day(), spec.hour, spec.minute, 0)
		nights = append(nights, nightRow{
			ID: idFor(i), SeriesID: seriesID, Title: spec.title, Mode: spec.mode,
			Date: day.Format("2006-01-02"), ScheduledLocalTime: spec.localTime,
			StartsAt: at, Capacity: spec.capacity, DstNote: note,
		})
	}
	return nights
}

func (n nightRow) signupsOpenAt() time.Time  { return n.StartsAt.Add(-signupOpensBefore) }
func (n nightRow) signupsCloseAt() time.Time { return n.StartsAt.Add(-signupClosesBefore) }
func (n nightRow) endsAt() time.Time         { return n.StartsAt.Add(nightLength) }

// status is the one place that decides a night's status from its window instants; each instant
// belongs to the later status.
func (n nightRow) status(now time.Time) (status string, changesIn *int64) {
	var next time.Time
	switch {
	case now.Before(n.signupsOpenAt()):
		status, next = "scheduled", n.signupsOpenAt()
	case now.Before(n.signupsCloseAt()):
		status, next = "signups_open", n.signupsCloseAt()
	case now.Before(n.StartsAt):
		status, next = "closed", n.StartsAt
	case now.Before(n.endsAt()):
		status, next = "live", n.endsAt()
	default:
		return "done", nil
	}
	ms := next.Sub(now).Milliseconds()
	return status, &ms
}

func (n nightRow) json(now time.Time) map[string]any {
	status, changes := n.status(now)
	local := n.StartsAt.In(studioLoc)
	var note any
	if n.DstNote != "" {
		note = n.DstNote
	}
	var changesJSON any
	if changes != nil {
		changesJSON = *changes
	}
	return map[string]any{
		"id": n.ID, "series_id": n.SeriesID, "title": n.Title, "mode": n.Mode, "date": n.Date,
		"scheduled_local_time": n.ScheduledLocalTime, "local_start": local.Format("15:04"),
		"utc_offset": local.Format("-07:00"), "zone_abbr": local.Format("MST"),
		"starts_at": formatInstant(n.StartsAt), "signups_open_at": formatInstant(n.signupsOpenAt()),
		"signups_close_at": formatInstant(n.signupsCloseAt()), "ends_at": formatInstant(n.endsAt()),
		"status": status, "status_changes_in_ms": changesJSON, "capacity": n.Capacity,
		"signed_up": n.SignedUp, "seats_left": n.Capacity - n.SignedUp, "dst_note": note,
	}
}

// ---- store queries for nights

const nightColumns = `n.id, n.series_id, n.title, n.mode, n.night_date, n.scheduled_local_time, n.starts_at, n.capacity, n.dst_note,
  (SELECT count(*) FROM signups s WHERE s.night_id = n.id)`

func scanNight(row interface{ Scan(...any) error }) (nightRow, error) {
	var n nightRow
	err := row.Scan(&n.ID, &n.SeriesID, &n.Title, &n.Mode, &n.Date, &n.ScheduledLocalTime, &n.StartsAt, &n.Capacity, &n.DstNote, &n.SignedUp)
	return n, err
}

func (s *store) nightsBetween(ctx context.Context, from, to string) ([]nightRow, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+nightColumns+` FROM nights n WHERE n.night_date >= $1 AND n.night_date <= $2 ORDER BY n.starts_at, n.id`, from, to)
	if err != nil {
		return nil, storageErr(err)
	}
	defer rows.Close()
	var out []nightRow
	for rows.Next() {
		n, err := scanNight(rows)
		if err != nil {
			return nil, storageErr(err)
		}
		out = append(out, n)
	}
	return out, storageErr(rows.Err())
}

func (s *store) nightByID(ctx context.Context, id string) (nightRow, bool, error) {
	if !storableID(id) {
		return nightRow{}, false, nil
	}
	n, err := scanNight(s.db.QueryRowContext(ctx, `SELECT `+nightColumns+` FROM nights n WHERE n.id = $1`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return n, false, nil
	}
	return n, err == nil, storageErr(err)
}

type signupRow struct {
	ID, NightID, Name, Email, ViewerZone string
	CreatedAt                            time.Time
}

func (g signupRow) json() map[string]any {
	return map[string]any{"id": g.ID, "night_id": g.NightID, "name": g.Name, "email": g.Email,
		"viewer_zone": g.ViewerZone, "created_at": formatInstant(g.CreatedAt)}
}

func (s *store) signupByEmail(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, nightID, emailKey string) (signupRow, bool, error) {
	var g signupRow
	err := q.QueryRowContext(ctx,
		`SELECT id, night_id, name, email, viewer_zone, created_at FROM signups WHERE night_id = $1 AND email_key = $2`,
		nightID, emailKey).Scan(&g.ID, &g.NightID, &g.Name, &g.Email, &g.ViewerZone, &g.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return g, false, nil
	}
	return g, err == nil, storageErr(err)
}

func (s *store) signupsForNight(ctx context.Context, nightID string) ([]signupRow, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, night_id, name, email, viewer_zone, created_at FROM signups WHERE night_id = $1 ORDER BY created_at, id`, nightID)
	if err != nil {
		return nil, storageErr(err)
	}
	defer rows.Close()
	var out []signupRow
	for rows.Next() {
		var g signupRow
		if err := rows.Scan(&g.ID, &g.NightID, &g.Name, &g.Email, &g.ViewerZone, &g.CreatedAt); err != nil {
			return nil, storageErr(err)
		}
		out = append(out, g)
	}
	return out, storageErr(rows.Err())
}

// createSignup stores a sign-up and its confirmation email in one transaction. A repeat of the
// same email returns the stored sign-up with created=false; a full night is night_full.
func (s *store) createSignup(ctx context.Context, night nightRow, g signupRow, confirmation outboxRow) (signupRow, bool, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return g, false, storageErr(err)
	}
	defer tx.Rollback()
	var locked string
	if err := tx.QueryRowContext(ctx, `SELECT id FROM nights WHERE id = $1 FOR UPDATE`, night.ID).Scan(&locked); err != nil {
		return g, false, storageErr(err)
	}
	emailKey := strings.ToLower(g.Email)
	if existing, found, err := s.signupByEmail(ctx, tx, night.ID, emailKey); err != nil || found {
		return existing, false, err
	}
	var taken int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM signups WHERE night_id = $1`, night.ID).Scan(&taken); err != nil {
		return g, false, storageErr(err)
	}
	if taken >= night.Capacity {
		return g, false, fail("night_full")
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO signups (id, night_id, name, email, email_key, viewer_zone, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		g.ID, g.NightID, g.Name, g.Email, emailKey, g.ViewerZone, g.CreatedAt); err != nil {
		return g, false, storageErr(err)
	}
	if err := insertOutbox(ctx, tx, confirmation); err != nil {
		return g, false, storageErr(err)
	}
	return g, true, storageErr(tx.Commit())
}

// ---- handlers

type seriesBody struct {
	Title     string `json:"title"`
	Mode      string `json:"mode"`
	Weekday   string `json:"weekday"`
	LocalTime string `json:"local_time"`
	FirstDate string `json:"first_date"`
	Weeks     int    `json:"weeks"`
	Capacity  int    `json:"capacity"`
}

var datePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

func parseDate(s string) (time.Time, bool) {
	if !datePattern.MatchString(s) {
		return time.Time{}, false
	}
	d, err := time.Parse("2006-01-02", s)
	return d, err == nil
}

func (s *server) listNights(w http.ResponseWriter, r *http.Request) error {
	now := s.clock.Now()
	days := 28
	local := now.In(studioLoc)
	start := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC)
	fields := map[string]string{}
	if v := r.URL.Query().Get("from"); v != "" {
		if date, ok := parseDate(v); ok {
			start = date
		} else {
			fields["from"] = "Use YYYY-MM-DD."
		}
	}
	if v := r.URL.Query().Get("days"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 90 {
			fields["days"] = "Use 1 to 90."
		} else {
			days = n
		}
	}
	if len(fields) > 0 {
		return failFields(fields)
	}
	rows, err := s.store.nightsBetween(r.Context(), start.Format("2006-01-02"), start.AddDate(0, 0, days-1).Format("2006-01-02"))
	if err != nil {
		return err
	}
	nights := make([]map[string]any, 0, len(rows))
	for _, n := range rows {
		nights = append(nights, n.json(now))
	}
	writeJSON(w, http.StatusOK, map[string]any{"zone": studioZone, "nights": nights})
	return nil
}

func (s *server) getNight(w http.ResponseWriter, r *http.Request) error {
	n, found, err := s.store.nightByID(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	if !found {
		return fail("not_found")
	}
	writeJSON(w, http.StatusOK, n.json(s.clock.Now()))
	return nil
}

func (s *server) postSeries(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.requireFounder(r); err != nil {
		return err
	}
	var body seriesBody
	if err := decodeBody(r, &body); err != nil {
		return err
	}
	now := s.clock.Now()
	fields := map[string]string{}
	if n := utf8.RuneCountInString(body.Title); n < 1 || n > 60 {
		fields["title"] = "Use 1 to 60 characters."
	}
	if body.Mode != modeSiege && body.Mode != modeConvoy {
		fields["mode"] = "Pick Siege or Convoy."
	}
	wd := weekdayIndex(body.Weekday)
	if wd < 0 {
		fields["weekday"] = "Pick a weekday."
	}
	hour, minute, timeErr := parseWallTime(body.LocalTime)
	if timeErr != nil {
		fields["local_time"] = "Use HH:MM, 24-hour."
	}
	if body.Weeks < 1 || body.Weeks > 26 {
		fields["weeks"] = "Use 1 to 26."
	}
	if body.Capacity < 1 || body.Capacity > 64 {
		fields["capacity"] = "Use 1 to 64."
	}
	first, dateOK := parseDate(body.FirstDate)
	if wd >= 0 {
		message := "Must be a " + strings.ToUpper(body.Weekday[:1]) + body.Weekday[1:] + " after today, studio time."
		if !dateOK || int(first.Weekday()) != wd {
			fields["first_date"] = message
		} else if timeErr == nil {
			if at, _ := resolveStudioWall(first.Year(), first.Month(), first.Day(), hour, minute, 0); !at.After(now) {
				fields["first_date"] = message
			}
		}
	} else if !dateOK {
		fields["first_date"] = "Use YYYY-MM-DD."
	}
	if len(fields) > 0 {
		return failFields(fields)
	}
	spec := seriesSpec{title: body.Title, mode: body.Mode, weekday: body.Weekday, localTime: body.LocalTime, hour: hour, minute: minute,
		firstDate: body.FirstDate, first: first, weeks: body.Weeks, capacity: body.Capacity}
	seriesID := newID("s_")
	nights := expandSeries(seriesID, spec, func(int) string { return newID("n_") })
	tx, err := s.store.db.BeginTx(r.Context(), nil)
	if err != nil {
		return storageErr(err)
	}
	defer tx.Rollback()
	if err := insertSeries(r.Context(), tx, seriesID, spec, nights, now); err != nil {
		return storageErr(err)
	}
	if err := tx.Commit(); err != nil {
		return storageErr(err)
	}
	out := make([]map[string]any, 0, len(nights))
	for _, n := range nights {
		out = append(out, n.json(now))
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"series": map[string]any{"id": seriesID, "title": spec.title, "mode": spec.mode, "weekday": spec.weekday,
			"local_time": spec.localTime, "first_date": spec.firstDate, "weeks": spec.weeks, "capacity": spec.capacity},
		"nights": out})
	return nil
}

type signupBody struct {
	Name       string `json:"name"`
	Email      string `json:"email"`
	ViewerZone string `json:"viewer_zone"`
}

var emailPattern = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

func (s *server) postSignup(w http.ResponseWriter, r *http.Request) error {
	night, found, err := s.store.nightByID(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	if !found {
		return fail("not_found")
	}
	var body signupBody
	if err := decodeBody(r, &body); err != nil {
		return err
	}
	email := strings.TrimSpace(body.Email)
	if email != "" {
		existing, repeat, err := s.store.signupByEmail(r.Context(), s.store.db, night.ID, strings.ToLower(email))
		if err != nil {
			return err
		}
		if repeat {
			writeJSON(w, http.StatusOK, map[string]any{"signup": existing.json(), "email_status": "already_signed_up"})
			return nil
		}
	}
	now := s.clock.Now()
	switch status, _ := night.status(now); status {
	case "scheduled":
		return fail("signups_not_open")
	case "closed", "live", "done":
		return fail("signups_closed")
	}
	if night.SignedUp >= night.Capacity {
		return fail("night_full")
	}
	fields := map[string]string{}
	name := strings.TrimSpace(body.Name)
	if n := utf8.RuneCountInString(name); n < 1 || n > 40 {
		fields["name"] = "Use 1 to 40 characters."
	}
	if !emailPattern.MatchString(email) || len(email) > 254 {
		fields["email"] = "Enter a valid email address."
	}
	viewerLoc, zoneOK := validZone(body.ViewerZone)
	if !zoneOK {
		fields["viewer_zone"] = "Pick a time zone from the list."
	}
	if len(fields) > 0 {
		return failFields(fields)
	}
	signup := signupRow{ID: newID("su_"), NightID: night.ID, Name: name, Email: email, ViewerZone: body.ViewerZone, CreatedAt: now}
	confirmation := s.mail.confirmation(night, signup, viewerLoc, now)
	stored, created, err := s.store.createSignup(r.Context(), night, signup, confirmation)
	if err != nil {
		return err
	}
	if !created {
		writeJSON(w, http.StatusOK, map[string]any{"signup": stored.json(), "email_status": "already_signed_up"})
		return nil
	}
	status := s.mail.deliver(confirmation.ID)
	s.mail.refreshQueued(r.Context())
	writeJSON(w, http.StatusCreated, map[string]any{"signup": stored.json(), "email_status": status})
	return nil
}

func (s *server) listSignups(w http.ResponseWriter, r *http.Request) error {
	caller, err := s.requirePlayer(r)
	if err != nil {
		return err
	}
	night, found, err := s.store.nightByID(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	if !found {
		return fail("not_found")
	}
	if caller.Role != roleFounder {
		return fail("founder_only")
	}
	rows, err := s.store.signupsForNight(r.Context(), night.ID)
	if err != nil {
		return err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, g := range rows {
		out = append(out, g.json())
	}
	writeJSON(w, http.StatusOK, map[string]any{"signups": out})
	return nil
}
