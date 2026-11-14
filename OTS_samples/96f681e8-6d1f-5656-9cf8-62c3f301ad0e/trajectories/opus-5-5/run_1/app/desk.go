package main

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

type deskRow struct {
	ID            string `json:"id"`
	Kind          string `json:"kind"`
	Court         int    `json:"court"`
	Start         string `json:"start"`
	StartUTC      string `json:"start_utc"`
	Minutes       int    `json:"minutes"`
	Status        string `json:"status"`
	OrganiserName string `json:"organiser_name"`
	Players       int    `json:"players"`
	start         time.Time
}

const deskSelect = `SELECT b.id, b.kind, b.court, b.start_utc, b.minutes, b.state, u.name,
	(SELECT count(*)::int FROM share s WHERE s.booking_id = b.id)
	FROM booking_now b JOIN app_user u ON u.username = b.organiser `

func (a *app) scanDeskRows(rows pgx.Rows) ([]deskRow, error) {
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (deskRow, error) {
		var d deskRow
		err := r.Scan(&d.ID, &d.Kind, &d.Court, &d.start, &d.Minutes, &d.Status, &d.OrganiserName, &d.Players)
		d.Start, d.StartUTC = a.cfg.clubOffsetTime(d.start), utcStamp(d.start)
		return d, err
	})
}

func (a *app) getDeskBookings(c *call) (int, any, error) {
	p, err := parsePage(c)
	if err != nil {
		return 0, nil, err
	}
	parts, ok := p.cursorParts(3)
	if !ok {
		return 0, nil, badCursor()
	}
	var after *time.Time
	var afterCourt *int
	var afterID *string
	if parts != nil {
		t, okT := cursorMicros(parts[0])
		court, okC := parts[1].(float64)
		id, okID := parts[2].(string)
		if !okT || !okC || !okID {
			return 0, nil, badCursor()
		}
		n := int(court)
		after, afterCourt, afterID = &t, &n, &id
	}
	now, err := dbNow(c.ctx, a.db)
	if err != nil {
		return 0, nil, err
	}
	today := a.cfg.clubDateOf(now)
	from, to := a.cfg.dayBounds(today)
	rows, err := a.db.Query(c.ctx, deskSelect+`WHERE b.state IN ('paid', 'checked-in', 'no-show')
		AND b.start_utc >= $1 AND b.start_utc < $2
		AND ($3::timestamptz IS NULL OR (b.start_utc, b.court, b.id) > ($3, $4, $5))
		ORDER BY b.start_utc, b.court, b.id LIMIT $6`, from, to, after, afterCourt, afterID, p.Limit+1)
	if err != nil {
		return 0, nil, fmt.Errorf("read desk list: %w", err)
	}
	list, err := a.scanDeskRows(rows)
	if err != nil {
		return 0, nil, fmt.Errorf("read desk list: %w", err)
	}
	var next *string
	if len(list) > p.Limit {
		last := list[p.Limit-1]
		next = encodeCursor(last.start.UnixMicro(), last.Court, last.ID)
		list = list[:p.Limit]
	}
	return 200, map[string]any{"date": today.String(), "items": list, "next_cursor": next}, nil
}

func (a *app) lookupDeskBooking(c *call) error {
	b, err := loadBooking(c.ctx, a.db, pathID(c, "id"))
	if err != nil {
		return err
	}
	if b == nil {
		return fail("NOT_FOUND")
	}
	return nil
}

// markDesk moves a paid booking of today to checked-in or no-show.
func (a *app) markDesk(ctx context.Context, id, to string) (int, any, error) {
	var conflict *apiError
	err := a.tx(ctx, func(t *txn) error {
		var state string
		var start, now time.Time
		var minutes int
		if err := t.QueryRow(ctx, `SELECT b.state, b.start_utc, b.minutes, now() FROM booking_now b
			JOIN booking l ON l.id = b.id WHERE b.id = $1 FOR UPDATE OF l`, id).Scan(&state, &start, &minutes, &now); err != nil {
			return fmt.Errorf("lock booking: %w", err)
		}
		end := start.Add(time.Duration(minutes) * time.Minute)
		switch {
		case !a.cfg.clubDateOf(start).Equal(a.cfg.clubDateOf(now)):
			conflict = fail("NOT_TODAY")
		case state != "paid":
			conflict = fail("INVALID_TRANSITION")
		case to == "no-show" && now.Before(a.cfg.noShowFrom(start)):
			conflict = fail("NOT_STARTED")
		case to == "checked-in" && !now.Before(end):
			conflict = fail("CHECK_IN_CLOSED")
		}
		if conflict != nil {
			return nil
		}
		_, err := t.Exec(ctx, `UPDATE booking SET status = $2 WHERE id = $1`, id, to)
		if err != nil {
			return fmt.Errorf("mark booking: %w", err)
		}
		return nil
	})
	if err != nil {
		return 0, nil, err
	}
	if conflict != nil {
		return 0, nil, conflict
	}
	rows, err := a.db.Query(ctx, deskSelect+`WHERE b.id = $1`, id)
	if err != nil {
		return 0, nil, fmt.Errorf("read desk row: %w", err)
	}
	list, err := a.scanDeskRows(rows)
	if err != nil || len(list) == 0 {
		return 0, nil, fmt.Errorf("read desk row: %w", err)
	}
	return 200, list[0], nil
}

func (a *app) checkIn(c *call) (int, any, error) {
	return a.markDesk(c.ctx, pathID(c, "id"), "checked-in")
}

func (a *app) markNoShow(c *call) (int, any, error) {
	return a.markDesk(c.ctx, pathID(c, "id"), "no-show")
}

func (a *app) getNotices(c *call) (int, any, error) {
	p, err := parsePage(c)
	if err != nil {
		return 0, nil, err
	}
	status := c.r.URL.Query().Get("status")
	if status != "" && status != "pending" && status != "sent" && status != "failed" {
		return 0, nil, invalidField("status", "Use pending, sent or failed.")
	}
	parts, ok := p.cursorParts(1)
	if !ok {
		return 0, nil, badCursor()
	}
	var before *int64
	if parts != nil {
		f, okF := parts[0].(float64)
		if !okF {
			return 0, nil, badCursor()
		}
		n := int64(f)
		before = &n
	}
	rows, err := a.db.Query(c.ctx, `SELECT id, event, channel, recipient, status, attempts, next_attempt_at, created_at
		FROM notice WHERE ($1 = '' OR status = $1) AND ($2::bigint IS NULL OR id < $2) ORDER BY id DESC LIMIT $3`,
		status, before, p.Limit+1)
	if err != nil {
		return 0, nil, fmt.Errorf("read notices: %w", err)
	}
	type noticeRow struct {
		id   int64
		body map[string]any
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (noticeRow, error) {
		var n noticeRow
		var event, channel, recipient, st string
		var attempts int
		var next *time.Time
		var created time.Time
		err := r.Scan(&n.id, &event, &channel, &recipient, &st, &attempts, &next, &created)
		var nextText *string
		if next != nil {
			s := utcStamp(*next)
			nextText = &s
		}
		n.body = map[string]any{"id": strconv.FormatInt(n.id, 10), "event": event, "channel": channel,
			"recipient": recipient, "status": st, "attempts": attempts, "next_attempt_at": nextText, "created_at": utcStamp(created)}
		return n, err
	})
	if err != nil {
		return 0, nil, fmt.Errorf("read notices: %w", err)
	}
	var next *string
	if len(list) > p.Limit {
		next = encodeCursor(list[p.Limit-1].id)
		list = list[:p.Limit]
	}
	items := make([]map[string]any, 0, len(list))
	for _, n := range list {
		items = append(items, n.body)
	}
	return 200, map[string]any{"items": items, "next_cursor": next}, nil
}
