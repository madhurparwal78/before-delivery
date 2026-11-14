package main

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// DeskRow is a booking on the desk's day list; it carries no payment fields.
type DeskRow struct {
	ID            string `json:"id"`
	Kind          string `json:"kind"`
	Court         int    `json:"court"`
	Start         string `json:"start"`
	StartUTC      string `json:"start_utc"`
	Minutes       int    `json:"minutes"`
	Status        string `json:"status"`
	OrganiserName string `json:"organiser_name"`
	Players       int    `json:"players"`
}

type deskCursor struct {
	Start time.Time `json:"s"`
	Court int       `json:"c"`
	ID    string    `json:"i"`
}

const deskRowColumns = `b.id, b.kind, b.court, b.start_utc, b.minutes, b.status, p.name,
	(SELECT count(*) FROM shares s WHERE s.owner_kind = '` + shareBooking + `' AND s.owner_id = b.id)`

func (a *App) scanDeskRow(row pgx.Row) (DeskRow, time.Time, error) {
	var r DeskRow
	var start time.Time
	if err := row.Scan(&r.ID, &r.Kind, &r.Court, &start, &r.Minutes, &r.Status, &r.OrganiserName, &r.Players); err != nil {
		return DeskRow{}, time.Time{}, err
	}
	r.Start, r.StartUTC = a.clock.formatClub(start), formatUTC(start)
	return r, start, nil
}

// dayBounds is the club date as the instants it starts and ends.
func (a *App) dayBounds(day time.Time) (time.Time, time.Time) {
	from, _ := a.clock.wallInstant(day, 0)
	to, _ := a.clock.wallInstant(day.AddDate(0, 0, 1), 0)
	return from, to
}

func (a *App) getDeskBookings(ctx context.Context, rq *request) (result, error) {
	page, err := parsePage(rq.r.URL.Query())
	if err != nil {
		return result{}, err
	}
	now, err := dbNow(ctx, a.pool)
	if err != nil {
		return result{}, err
	}
	today := a.clock.clubDate(now)
	from, to := a.dayBounds(today)
	args := []any{from, to}
	query := fmt.Sprintf(`SELECT %s FROM bookings b JOIN people p ON p.username = b.organiser
		WHERE b.status IN %s AND b.start_utc >= $1 AND b.start_utc < $2`, deskRowColumns, bookedStatusesSQL)
	if page.cursor != "" {
		var after deskCursor
		if err := decodeCursor(page.cursor, &after); err != nil {
			return result{}, err
		}
		query += " AND (b.start_utc, b.court, b.id) > ($3, $4, $5)"
		args = append(args, after.Start, after.Court, after.ID)
	}
	args = append(args, page.limit+1)
	rows, err := a.pool.Query(ctx, query+fmt.Sprintf(" ORDER BY b.start_utc, b.court, b.id LIMIT $%d", len(args)), args...)
	if err != nil {
		return result{}, fmt.Errorf("list today's bookings: %w", err)
	}
	defer rows.Close()
	items := []DeskRow{}
	var starts []time.Time
	for rows.Next() {
		row, start, err := a.scanDeskRow(rows)
		if err != nil {
			return result{}, fmt.Errorf("read desk row: %w", err)
		}
		items = append(items, row)
		starts = append(starts, start)
	}
	if err := rows.Err(); err != nil {
		return result{}, fmt.Errorf("list today's bookings: %w", err)
	}
	var next *string
	if len(items) > page.limit {
		items, starts = items[:page.limit], starts[:page.limit]
		last := items[len(items)-1]
		token, err := encodeCursor(deskCursor{starts[len(starts)-1], last.Court, last.ID})
		if err != nil {
			return result{}, err
		}
		next = &token
	}
	return ok(map[string]any{"date": today.Format(dateLayout), "items": items, "next_cursor": next}), nil
}

func (a *App) postCheckIn(ctx context.Context, rq *request) (result, error) {
	return a.markToday(ctx, rq, bookingCheckedIn)
}

func (a *App) postNoShow(ctx context.Context, rq *request) (result, error) {
	return a.markToday(ctx, rq, bookingNoShow)
}

// markToday is the one place the desk moves a paid booking to checked-in or no-show: only bookings that start on
// today's club date; a no-show needs the grace time after the start to have passed, and check-in closes at the end.
func (a *App) markToday(ctx context.Context, rq *request, target string) (result, error) {
	var out DeskRow
	err := withTx(ctx, a.pool, func(tx pgx.Tx) error {
		b, err := loadBooking(ctx, tx, rq.r.PathValue("id"), true)
		if err != nil {
			return err
		}
		now, err := dbNow(ctx, tx)
		if err != nil {
			return err
		}
		if a.clock.clubDay(b.Start) != a.clock.clubDay(now) {
			return fail(codeNotToday)
		}
		if b.Status != bookingPaid {
			return fail(codeInvalidTransition)
		}
		if target == bookingNoShow && now.Before(a.noShowFrom(b.Start)) {
			return fail(codeNotStarted)
		}
		if target == bookingCheckedIn && !now.Before(slotEnd(b.Start, b.Minutes)) {
			return fail(codeCheckInClosed)
		}
		if _, err := tx.Exec(ctx, "UPDATE bookings SET status = $2 WHERE id = $1", b.ID, target); err != nil {
			return fmt.Errorf("mark %s %s: %w", b.ID, target, err)
		}
		out, _, err = a.scanDeskRow(tx.QueryRow(ctx, "SELECT "+deskRowColumns+" FROM bookings b JOIN people p ON p.username = b.organiser WHERE b.id = $1", b.ID))
		return err
	})
	if err != nil {
		return result{}, err
	}
	return ok(out), nil
}
