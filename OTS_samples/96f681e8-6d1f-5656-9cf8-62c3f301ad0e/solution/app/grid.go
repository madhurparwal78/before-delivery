package main

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// cellRank orders what can overlap a cell: the lowest rank decides the cell's state.
var cellRank = map[string]int{cellHeld: 1, cellBook: 2, cellMatch: 3, cellLesson: 4}

const (
	maxGridDays   = 7
	maxGridCourts = 8
	courtCount    = 7

	cellFree   = "free"
	cellHeld   = "held"
	cellBook   = "booked"
	cellMatch  = "match"
	cellLesson = "lesson"
	cellPast   = "past"
)

// ClubInfo is GET /api/club.
type ClubInfo struct {
	Name               string `json:"name"`
	Timezone           string `json:"timezone"`
	Courts             int    `json:"courts"`
	OpeningHours       string `json:"opening_hours"`
	SlotStepMinutes    int    `json:"slot_step_minutes"`
	HoldSeconds        int    `json:"hold_seconds"`
	MatchCutoffSeconds int    `json:"match_cutoff_seconds"`
	FreeCancelSeconds  int    `json:"free_cancel_seconds"`
	ShareSettleSeconds int    `json:"share_settle_seconds"`
	AuthRefreshSeconds int    `json:"auth_refresh_seconds"`
	NoShowGraceSeconds int    `json:"no_show_grace_seconds"`
	LateFeePercent     int    `json:"late_fee_percent"`
	RuleDescription    string `json:"rule_description"`
}

func (a *App) getClub(ctx context.Context, _ *request) (result, error) {
	rule, err := latestRule(ctx, a.pool)
	if err != nil {
		return result{}, err
	}
	t := a.cfg.Timing
	return ok(ClubInfo{Name: clubName, Timezone: a.clock.zoneName, Courts: courtCount, OpeningHours: t.OpeningHours,
		SlotStepMinutes: t.SlotStepMinutes, HoldSeconds: t.HoldSeconds, MatchCutoffSeconds: t.MatchCutoffSeconds,
		FreeCancelSeconds: t.FreeCancelSeconds, ShareSettleSeconds: t.ShareSettleSeconds, AuthRefreshSeconds: t.AuthRefreshSeconds,
		NoShowGraceSeconds: t.NoShowGraceSeconds,
		LateFeePercent:     rule.LateFeePercent, RuleDescription: rule.Description}), nil
}

// GridCell is one half-hour cell of one court.
type GridCell struct {
	Court     int     `json:"court"`
	Start     string  `json:"start"`
	StartUTC  string  `json:"start_utc"`
	State     string  `json:"state"`
	Mine      bool    `json:"mine"`
	BookingID *string `json:"booking_id"`
	MatchID   *string `json:"match_id"`
	Players   *int    `json:"players"`
}

type gridDay struct {
	Date  string     `json:"date"`
	Cells []GridCell `json:"cells"`
}

// courtClaim is something that takes court time, for the grid.
type courtClaim struct {
	court      int
	start, end time.Time
	state      string
	organiser  string
	bookingID  string
	matchID    string
	players    int
}

func (a *App) getGrid(ctx context.Context, rq *request) (result, error) {
	query := rq.r.URL.Query()
	problems := fieldErrors{}
	from, fromOK := parseDay(query.Get("from"))
	if !fromOK {
		problems["from"] = msgDate
	}
	to, toOK := from, fromOK
	if raw := query.Get("to"); raw != "" {
		to, toOK = parseDay(raw)
		if !toOK {
			problems["to"] = msgDate
		}
	}
	if fromOK && toOK {
		switch span := int(to.Sub(from).Hours() / 24); {
		case span < 0:
			problems["to"] = msgToBeforeFrom
		case span > maxGridDays-1:
			problems["to"] = msgTooManyDays
		}
	}
	courts, courtMessage := parseCourts(query.Get("courts"))
	if courtMessage != "" {
		problems["courts"] = courtMessage
	}
	if err := problems.err(); err != nil {
		return result{}, err
	}
	now, err := dbNow(ctx, a.pool)
	if err != nil {
		return result{}, err
	}
	windowStart, _ := a.dayBounds(from)
	_, windowEnd := a.dayBounds(to)
	claims, err := a.courtClaimsBetween(ctx, courts, windowStart, windowEnd, now)
	if err != nil {
		return result{}, err
	}
	days := []gridDay{}
	for day := from; !day.After(to); day = day.AddDate(0, 0, 1) {
		cells := []GridCell{}
		for _, start := range a.clock.gridStarts(day) {
			for _, court := range courts {
				cells = append(cells, a.cellFor(court, start, now, claims, rq.me))
			}
		}
		days = append(days, gridDay{Date: day.Format(dateLayout), Cells: cells})
	}
	return ok(map[string]any{"timezone": a.clock.zoneName, "server_now": formatUTC(now), "days": days}), nil
}

// parseCourts reads a courts list: none means all seven, at most eight entries, each a court from 1 to 7 once.
func parseCourts(raw string) ([]int, string) {
	if raw == "" {
		all := make([]int, courtCount)
		for i := range all {
			all[i] = i + 1
		}
		return all, ""
	}
	parts := strings.Split(raw, ",")
	if len(parts) > maxGridCourts {
		return nil, msgTooManyCourt
	}
	seen := map[int]bool{}
	courts := make([]int, 0, len(parts))
	for _, part := range parts {
		court, err := strconv.Atoi(strings.TrimSpace(part))
		if err != nil || court < 1 || court > courtCount || seen[court] {
			return nil, msgCourtList
		}
		seen[court] = true
		courts = append(courts, court)
	}
	return courts, ""
}

func (a *App) courtClaimsBetween(ctx context.Context, courts []int, from, to time.Time, now time.Time) ([]courtClaim, error) {
	var claims []courtClaim
	rows, err := a.pool.Query(ctx, fmt.Sprintf(`SELECT court, start_utc, start_utc + make_interval(mins => minutes), status, organiser, id
		FROM bookings WHERE court = ANY($1) AND start_utc < $3 AND start_utc + make_interval(mins => minutes) > $2 AND %s`,
		bookingTakesSlotSQL), courts, from, to)
	if err != nil {
		return nil, fmt.Errorf("read booking claims: %w", err)
	}
	for rows.Next() {
		c := courtClaim{state: cellBook}
		var status string
		if err := rows.Scan(&c.court, &c.start, &c.end, &status, &c.organiser, &c.bookingID); err != nil {
			rows.Close()
			return nil, fmt.Errorf("read booking claim: %w", err)
		}
		if status == bookingHeld {
			c.state = cellHeld
		}
		claims = append(claims, c)
	}
	rows.Close()
	matchRows, err := a.pool.Query(ctx, fmt.Sprintf(`SELECT m.court, m.start_utc, m.start_utc + make_interval(mins => m.minutes), m.id, %s
		FROM matches m WHERE m.court = ANY($1) AND m.start_utc < $3 AND m.start_utc + make_interval(mins => m.minutes) > $2 AND %s`,
		placesSQL("m"), matchLiveSQL("m")), courts, from, to)
	if err != nil {
		return nil, fmt.Errorf("read match claims: %w", err)
	}
	for matchRows.Next() {
		c := courtClaim{state: cellMatch}
		if err := matchRows.Scan(&c.court, &c.start, &c.end, &c.matchID, &c.players); err != nil {
			matchRows.Close()
			return nil, fmt.Errorf("read match claim: %w", err)
		}
		claims = append(claims, c)
	}
	matchRows.Close()
	lessonRows, err := a.pool.Query(ctx, `SELECT court, start_utc, start_utc + make_interval(mins => minutes)
		FROM lessons WHERE court = ANY($1) AND start_utc < $3 AND start_utc + make_interval(mins => minutes) > $2`, courts, from, to)
	if err != nil {
		return nil, fmt.Errorf("read lesson claims: %w", err)
	}
	for lessonRows.Next() {
		c := courtClaim{state: cellLesson}
		if err := lessonRows.Scan(&c.court, &c.start, &c.end); err != nil {
			lessonRows.Close()
			return nil, fmt.Errorf("read lesson claim: %w", err)
		}
		claims = append(claims, c)
	}
	lessonRows.Close()
	return claims, nil
}

// cellFor is the one place a cell's state is decided, from what overlaps its half hour: a live hold, then a
// booking, then an open match, then a lesson, then past, then free.
func (a *App) cellFor(court int, start, now time.Time, claims []courtClaim, me *Identity) GridCell {
	end := start.Add(gridCellMinutes * time.Minute)
	cell := GridCell{Court: court, Start: a.clock.formatClub(start), StartUTC: formatUTC(start), State: cellFree}
	best := 0
	for _, c := range claims {
		if c.court != court || !c.start.Before(end) || !c.end.After(start) {
			continue
		}
		if c.matchID != "" {
			id, players := c.matchID, c.players
			cell.MatchID, cell.Players = &id, &players
		}
		if best == 0 || cellRank[c.state] < best {
			best = cellRank[c.state]
			cell.State = c.state
			if c.bookingID != "" && me != nil && c.organiser == me.Username {
				id := c.bookingID
				cell.Mine, cell.BookingID = true, &id
			} else {
				cell.Mine, cell.BookingID = false, nil
			}
		}
	}
	if best == 0 && !start.After(now) {
		cell.State = cellPast
	}
	return cell
}

func (a *App) getQuote(ctx context.Context, rq *request) (result, error) {
	query := rq.r.URL.Query()
	problems := fieldErrors{}
	court, err := strconv.Atoi(query.Get("court"))
	if err != nil || court < 1 || court > courtCount {
		problems["court"] = msgCourt
	}
	minutes, err := strconv.Atoi(query.Get("minutes"))
	if err != nil || !allowedLength(minutes) {
		problems["minutes"] = msgMinutes
		minutes = defaultMinutes
	}
	start, valid := a.clock.slotStart(query.Get("start"), minutes)
	if !valid {
		problems["start"] = msgStart
	}
	if err := problems.err(); err != nil {
		return result{}, err
	}
	quote, err := a.quoteSlot(ctx, a.pool, court, start, minutes)
	if err != nil {
		return result{}, err
	}
	return ok(quote), nil
}
