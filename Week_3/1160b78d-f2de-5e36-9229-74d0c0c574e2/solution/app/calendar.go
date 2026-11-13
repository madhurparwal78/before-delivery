package main

import (
	"fmt"
	"net/http"
	"strings"
	"time"
)

const (
	calendarLifetime = 365 * 24 * time.Hour
	calendarPast     = 14 * 24 * time.Hour
	calendarAhead    = 60 * 24 * time.Hour
	calendarSuffix   = ".ics"
)

func (a *App) hCreateCalendarToken(rq *Req) error {
	token := newToken(24)
	var expires time.Time
	err := a.Do(rq.Ctx(), func(w *Work) error {
		expires = w.Now.Add(calendarLifetime)
		_, err := w.Tx.Exec(w.Ctx, `insert into calendar_tokens (user_id, token_hash, created_at, expires_at) values ($1, $2, $3, $4)
			on conflict (user_id) do update set token_hash = excluded.token_hash, created_at = excluded.created_at,
			expires_at = excluded.expires_at`, rq.Actor.ID, hashSecret(token), w.Now, expires)
		if err != nil {
			return fmt.Errorf("save calendar token: %w", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("create calendar token: %w", err)
	}
	return rq.JSON(http.StatusCreated, map[string]string{"url": "/calendar/" + token + calendarSuffix, "expires_at": formatInstant(expires)})
}

func (a *App) hRevokeCalendarToken(rq *Req) error {
	err := a.Do(rq.Ctx(), func(w *Work) error {
		if _, err := w.Tx.Exec(w.Ctx, `delete from calendar_tokens where user_id = $1`, rq.Actor.ID); err != nil {
			return fmt.Errorf("revoke calendar token: %w", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("revoke calendar token: %w", err)
	}
	return rq.NoContent()
}

// hCalendarFeed serves a person's shifts as an iCalendar file, by token alone. It never changes anything.
func (a *App) hCalendarFeed(rq *Req) error {
	token, isFeed := strings.CutSuffix(rq.Param("file"), calendarSuffix)
	if !isFeed {
		return errNotFound()
	}
	var userID string
	var expires time.Time
	err := a.db.QueryRow(rq.Ctx(), `select t.user_id, t.expires_at from calendar_tokens t join users u on u.id = t.user_id
		where t.token_hash = $1 and u.removed_at is null`, hashSecret(token)).Scan(&userID, &expires)
	if isNoRows(err) {
		return errNotFound()
	}
	if err != nil {
		return fmt.Errorf("look up calendar token: %w", err)
	}
	now := a.clock.Now()
	if instantReached(now, expires) {
		return errExpired()
	}
	shifts, err := a.personShifts(rq.Ctx(), a.db, userID, now.Add(-calendarPast), now.Add(calendarAhead))
	if err != nil {
		return fmt.Errorf("list shifts for calendar: %w", err)
	}
	rq.W.Header().Set("Content-Type", "text/calendar; charset=utf-8")
	rq.W.WriteHeader(http.StatusOK)
	if _, err := rq.W.Write([]byte(renderCalendar(shifts, now))); err != nil {
		return fmt.Errorf("write calendar: %w", err)
	}
	return nil
}

// renderCalendar is an iCalendar file with one event per shift, in UTC.
func renderCalendar(shifts []shiftRef, stamp time.Time) string {
	const instantForm = "20060102T150405Z"
	lines := []string{"BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Tarecross Software//Switchlamp//EN", "CALSCALE:GREGORIAN"}
	for _, shift := range shifts {
		lines = append(lines, "BEGIN:VEVENT",
			fmt.Sprintf("UID:%s-%d@switchlamp", strings.ReplaceAll(shift.Schedule, " ", "-"), shift.Start.Unix()),
			"DTSTAMP:"+stamp.UTC().Format(instantForm),
			"DTSTART:"+shift.Start.UTC().Format(instantForm),
			"DTEND:"+shift.End.UTC().Format(instantForm),
			"SUMMARY:"+escapeCalendarText("On call: "+shift.Schedule),
			"END:VEVENT")
	}
	lines = append(lines, "END:VCALENDAR")
	var out strings.Builder
	for _, line := range lines {
		out.WriteString(foldCalendarLine(line))
		out.WriteString("\r\n")
	}
	return out.String()
}

var calendarEscaper = strings.NewReplacer(`\`, `\\`, ";", `\;`, ",", `\,`, "\n", `\n`)

func escapeCalendarText(text string) string { return calendarEscaper.Replace(text) }

// foldCalendarLine breaks a line longer than 75 octets, each continuation starting with a space.
func foldCalendarLine(line string) string {
	var out strings.Builder
	size := 0
	for _, r := range line {
		if size+len(string(r)) > 75 {
			out.WriteString("\r\n ")
			size = 1
		}
		out.WriteRune(r)
		size += len(string(r))
	}
	return out.String()
}

func methodNotAllowed(rq *Req) error {
	rq.W.Header().Set("Allow", "GET, HEAD")
	return errMethodNotAllowed()
}

func init() {
	routeSetups = append(routeSetups, func(a *App) {
		a.route(route{Pattern: "POST /api/me/calendar-token", Access: accStaff, Handler: a.hCreateCalendarToken})
		a.route(route{Pattern: "DELETE /api/me/calendar-token", Access: accStaff, Handler: a.hRevokeCalendarToken})
		a.route(route{Pattern: "GET /calendar/{file}", Access: accPublic, Handler: a.hCalendarFeed})
		for _, method := range []string{"POST", "PUT", "PATCH", "DELETE", "OPTIONS"} {
			a.route(route{Pattern: method + " /calendar/{file}", Access: accPublic, Handler: methodNotAllowed})
		}
	})
}
