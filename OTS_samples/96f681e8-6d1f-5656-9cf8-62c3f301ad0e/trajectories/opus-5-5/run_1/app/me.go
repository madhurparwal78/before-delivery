package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

// pageRequest is a parsed limit and cursor of a paged list.
type pageRequest struct {
	Limit  int
	Cursor []any
}

func parsePage(c *call) (pageRequest, error) {
	p := pageRequest{Limit: 20}
	q := c.r.URL.Query()
	errs := map[string]string{}
	if v := q.Get("limit"); v != "" || q.Has("limit") {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 50 {
			errs["limit"] = msgLimit
		}
		p.Limit = n
	}
	if v := q.Get("cursor"); v != "" {
		raw, err := base64.RawURLEncoding.DecodeString(v)
		if err != nil || json.Unmarshal(raw, &p.Cursor) != nil || len(p.Cursor) == 0 {
			errs["cursor"] = msgCursor
		}
	}
	if len(errs) > 0 {
		return p, invalid(errs)
	}
	return p, nil
}

func encodeCursor(parts ...any) *string {
	raw, _ := json.Marshal(parts)
	s := base64.RawURLEncoding.EncodeToString(raw)
	return &s
}

// cursorParts returns the decoded cursor, and whether it has the expected number of parts.
func (p pageRequest) cursorParts(n int) ([]any, bool) {
	if p.Cursor == nil {
		return nil, true
	}
	return p.Cursor, len(p.Cursor) == n
}

func cursorMicros(v any) (time.Time, bool) {
	f, ok := v.(float64)
	if !ok {
		return time.Time{}, false
	}
	return time.UnixMicro(int64(f)), true
}

func badCursor() error { return invalidField("cursor", msgCursor) }

func (a *app) getMe(c *call) (int, any, error) {
	u := c.user
	var topic *string
	switch {
	case u.has("player"):
		topic = u.PushTopic
	case u.has("desk"), u.has("manager"):
		t := deskTopic
		topic = &t
	}
	roles := u.Roles
	if roles == nil {
		roles = []string{}
	}
	return 200, map[string]any{"username": u.Username, "name": u.Name, "email": u.Email, "roles": roles,
		"level": u.Level, "coach_id": u.CoachID, "push_topic": topic}, nil
}

type coachCard struct {
	CoachID  string  `json:"coach_id"`
	Name     string  `json:"name"`
	LevelMin float64 `json:"level_min"`
	LevelMax float64 `json:"level_max"`
	Line     string  `json:"line"`
}

func (a *app) getClub(c *call) (int, any, error) {
	var fee int
	var description string
	if err := a.db.QueryRow(c.ctx, `SELECT late_fee_percent, description FROM cancellation_rule ORDER BY version DESC LIMIT 1`).
		Scan(&fee, &description); err != nil {
		return 0, nil, fmt.Errorf("read rule: %w", err)
	}
	rows, err := a.db.Query(c.ctx, `SELECT coach_id, name, coach_level_min::float8, coach_level_max::float8, coach_line
		FROM app_user WHERE coach_id IS NOT NULL ORDER BY name`)
	if err != nil {
		return 0, nil, fmt.Errorf("read coaches: %w", err)
	}
	coaches, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (coachCard, error) {
		var cc coachCard
		err := r.Scan(&cc.CoachID, &cc.Name, &cc.LevelMin, &cc.LevelMax, &cc.Line)
		return cc, err
	})
	if err != nil {
		return 0, nil, fmt.Errorf("read coaches: %w", err)
	}
	cfg := a.cfg
	return 200, map[string]any{
		"name": "Marlowe Yard Padel Club", "timezone": cfg.Location.String(), "courts": 7,
		"opening_hours": cfg.OpeningHours, "slot_step_minutes": cfg.SlotStepMinutes, "hold_seconds": cfg.HoldSeconds,
		"match_cutoff_seconds": cfg.MatchCutoffSecs, "free_cancel_seconds": cfg.FreeCancelSecs,
		"share_settle_seconds": cfg.ShareSettleSecs, "auth_refresh_seconds": cfg.AuthRefreshSecs,
		"no_show_grace_seconds": cfg.NoShowGraceSecs, "late_fee_percent": fee, "rule_description": description,
		"coaches": coaches,
	}, nil
}

type historyRow struct {
	ID        string  `json:"id"`
	Kind      string  `json:"kind"`
	BookingID *string `json:"booking_id"`
	Status    string  `json:"status"`
	Court     int     `json:"court"`
	Start     string  `json:"start"`
	StartUTC  string  `json:"start_utc"`
	Minutes   int     `json:"minutes"`
	Role      string  `json:"role"`
	Note      *string `json:"note"`
	MyAmount  int     `json:"my_amount_cents"`
	MyPayment string  `json:"my_payment"`
}

func (a *app) getMyBookings(c *call) (int, any, error) {
	p, err := parsePage(c)
	if err != nil {
		return 0, nil, err
	}
	parts, ok := p.cursorParts(2)
	var after *time.Time
	var afterID *string
	if !ok {
		return 0, nil, badCursor()
	}
	if parts != nil {
		t, okT := cursorMicros(parts[0])
		id, okID := parts[1].(string)
		if !okT || !okID {
			return 0, nil, badCursor()
		}
		after, afterID = &t, &id
	}
	rows, err := a.db.Query(c.ctx, `WITH history AS (
		SELECT b.id, 'booking' AS kind, b.id AS booking_id, b.state AS status, b.court, b.start_utc, b.minutes,
			CASE WHEN b.organiser = $1 THEN 'organiser' ELSE 'co-player' END AS role,
			CASE WHEN b.organiser = $1 THEN b.note END AS note,
			s.amount_cents + CASE WHEN b.organiser = $1 THEN COALESCE((SELECT sum(c.amount_cents) FROM share c
				WHERE c.booking_id = b.id AND c.status = 'covered'), 0) ELSE 0 END AS my_amount,
			s.state AS my_payment
		FROM booking_now b JOIN share_now s ON s.booking_id = b.id AND s.player = $1
		WHERE b.kind = 'booking'
		UNION ALL
		SELECT m.id, 'match', m.booking_id, COALESCE(bk.state, m.state), m.court, m.start_utc, m.minutes,
			CASE WHEN m.creator = $1 THEN 'organiser' ELSE 'co-player' END,
			CASE WHEN m.creator = $1 THEN '' END, p.amount_cents, 'paid'
		FROM match_now m JOIN match_place p ON p.match_id = m.id AND p.player = $1 AND p.status = 'paid'
		LEFT JOIN booking_now bk ON bk.id = m.booking_id
	)
	SELECT id, kind, booking_id, status, court, start_utc, minutes, role, note, my_amount::int, my_payment FROM history
	WHERE $2::timestamptz IS NULL OR start_utc < $2 OR (start_utc = $2 AND id > $3)
	ORDER BY start_utc DESC, id LIMIT $4`, c.user.Username, after, afterID, p.Limit+1)
	if err != nil {
		return 0, nil, fmt.Errorf("read history: %w", err)
	}
	type scanned struct {
		row   historyRow
		start time.Time
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (scanned, error) {
		var s scanned
		err := r.Scan(&s.row.ID, &s.row.Kind, &s.row.BookingID, &s.row.Status, &s.row.Court, &s.start, &s.row.Minutes,
			&s.row.Role, &s.row.Note, &s.row.MyAmount, &s.row.MyPayment)
		s.row.Start, s.row.StartUTC = a.cfg.clubOffsetTime(s.start), utcStamp(s.start)
		return s, err
	})
	if err != nil {
		return 0, nil, fmt.Errorf("read history: %w", err)
	}
	var next *string
	if len(list) > p.Limit {
		last := list[p.Limit-1]
		next = encodeCursor(last.start.UnixMicro(), last.row.ID)
		list = list[:p.Limit]
	}
	items := make([]historyRow, 0, len(list))
	for _, s := range list {
		items = append(items, s.row)
	}
	return 200, map[string]any{"items": items, "next_cursor": next}, nil
}

func (a *app) getMyCredits(c *call) (int, any, error) {
	rows, err := a.db.Query(c.ctx, `SELECT id, amount_cents, reason, booking_id, match_id, created_at FROM credit
		WHERE username = $1 ORDER BY created_at DESC, id DESC`, c.user.Username)
	if err != nil {
		return 0, nil, fmt.Errorf("read credits: %w", err)
	}
	balance := 0
	entries, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (map[string]any, error) {
		var id int64
		var amount int
		var reason string
		var booking, match *string
		var created time.Time
		err := r.Scan(&id, &amount, &reason, &booking, &match, &created)
		balance += amount
		return map[string]any{"id": strconv.FormatInt(id, 10), "amount_cents": amount, "reason": reason,
			"booking_id": booking, "match_id": match, "created_at": utcStamp(created)}, err
	})
	if err != nil {
		return 0, nil, fmt.Errorf("read credits: %w", err)
	}
	return 200, map[string]any{"balance_cents": balance, "entries": entries}, nil
}
