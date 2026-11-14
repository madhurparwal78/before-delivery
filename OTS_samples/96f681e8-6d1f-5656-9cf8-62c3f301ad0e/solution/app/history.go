package main

import (
	"context"
	"fmt"
	"time"
)

// HistoryRow is one row of a player's booking history.
type HistoryRow struct {
	ID            string  `json:"id"`
	Kind          string  `json:"kind"`
	BookingID     *string `json:"booking_id"`
	Status        string  `json:"status"`
	Court         int     `json:"court"`
	Start         string  `json:"start"`
	StartUTC      string  `json:"start_utc"`
	Minutes       int     `json:"minutes"`
	Role          string  `json:"role"`
	Note          *string `json:"note"`
	MyAmountCents int     `json:"my_amount_cents"`
	MyPayment     string  `json:"my_payment"`
}

type historyCursor struct {
	Start time.Time `json:"s"`
	ID    string    `json:"i"`
}

const (
	roleOrganiser = "organiser"
	roleCoPlayer  = "co-player"
)

// historySQL lists each booking of kind booking the player organises or shares in, whatever its status, and each
// match where they hold a paid place. A match booking is never a row of its own.
var historySQL = fmt.Sprintf(`
SELECT id, kind, booking_id, status, court, start_utc, minutes, role, note, my_amount, my_payment, expires_at FROM (
  SELECT b.id AS id, '%[1]s' AS kind, b.id AS booking_id, b.status AS status, b.court, b.start_utc, b.minutes,
         CASE WHEN b.organiser = $1 THEN '%[2]s' ELSE '%[3]s' END AS role,
         CASE WHEN b.organiser = $1 THEN b.note ELSE NULL END AS note,
         (SELECT COALESCE(sum(CASE WHEN s.username = $1 OR (s.status = '%[4]s' AND b.organiser = $1) THEN s.amount_cents END), 0)
            FROM shares s WHERE s.owner_kind = '%[5]s' AND s.owner_id = b.id) AS my_amount,
         (SELECT s.status FROM shares s WHERE s.owner_kind = '%[5]s' AND s.owner_id = b.id AND s.username = $1) AS my_payment,
         b.expires_at AS expires_at
  FROM bookings b
  WHERE b.kind = '%[1]s' AND (b.organiser = $1
        OR EXISTS (SELECT 1 FROM shares s WHERE s.owner_kind = '%[5]s' AND s.owner_id = b.id AND s.username = $1))
  UNION ALL
  SELECT m.id, '%[6]s', m.booking_id,
         CASE WHEN %[7]s THEN '%[8]s' WHEN m.booking_id IS NOT NULL THEN (SELECT mb.status FROM bookings mb WHERE mb.id = m.booking_id) ELSE '%[9]s' END,
         m.court, m.start_utc, m.minutes,
         CASE WHEN m.creator = $1 THEN '%[2]s' ELSE '%[3]s' END, NULL, pr.amount_cents,
         CASE WHEN %[7]s THEN '%[10]s' ELSE '%[11]s' END, NULL::timestamptz
  FROM matches m JOIN place_reservations pr ON pr.match_id = m.id AND pr.username = $1 AND pr.status = '%[12]s'
) history`,
	kindBooking, roleOrganiser, roleCoPlayer, shareCovered, shareBooking,
	kindMatch, matchCancelledSQL("m"), bookingCancelled, matchOpen, shareVoid, sharePaid, placePaid)

func (a *App) getMyBookings(ctx context.Context, rq *request) (result, error) {
	page, err := parsePage(rq.r.URL.Query())
	if err != nil {
		return result{}, err
	}
	args := []any{rq.me.Username}
	query := historySQL
	if page.cursor != "" {
		var after historyCursor
		if err := decodeCursor(page.cursor, &after); err != nil {
			return result{}, err
		}
		query += " WHERE (start_utc, id) < ($2, $3)"
		args = append(args, after.Start, after.ID)
	}
	args = append(args, page.limit+1)
	rows, err := a.pool.Query(ctx, query+fmt.Sprintf(" ORDER BY start_utc DESC, id DESC LIMIT $%d", len(args)), args...)
	if err != nil {
		return result{}, fmt.Errorf("list booking history: %w", err)
	}
	defer rows.Close()
	now, err := dbNow(ctx, a.pool)
	if err != nil {
		return result{}, err
	}
	items := []HistoryRow{}
	var starts []time.Time
	for rows.Next() {
		var row HistoryRow
		var start time.Time
		var expires *time.Time
		var payment *string
		if err := rows.Scan(&row.ID, &row.Kind, &row.BookingID, &row.Status, &row.Court, &start, &row.Minutes, &row.Role,
			&row.Note, &row.MyAmountCents, &payment, &expires); err != nil {
			return result{}, fmt.Errorf("read history row: %w", err)
		}
		row.Start, row.StartUTC = a.clock.formatClub(start), formatUTC(start)
		row.Status = effectiveBookingStatus(row.Status, expires, now)
		if payment != nil {
			row.MyPayment = effectiveShareStatus(*payment, row.Status, start, now)
		} else {
			row.MyPayment = sharePaid
		}
		items = append(items, row)
		starts = append(starts, start)
	}
	if err := rows.Err(); err != nil {
		return result{}, fmt.Errorf("list booking history: %w", err)
	}
	var next *string
	if len(items) > page.limit {
		items, starts = items[:page.limit], starts[:page.limit]
		token, err := encodeCursor(historyCursor{starts[len(starts)-1], items[len(items)-1].ID})
		if err != nil {
			return result{}, err
		}
		next = &token
	}
	return ok(map[string]any{"items": items, "next_cursor": next}), nil
}

// CreditEntry is a line of the credit ledger.
type CreditEntry struct {
	ID          int64   `json:"id"`
	AmountCents int     `json:"amount_cents"`
	Reason      string  `json:"reason"`
	BookingID   *string `json:"booking_id"`
	MatchID     *string `json:"match_id"`
	CreatedAt   string  `json:"created_at"`
}

func (a *App) getMyCredits(ctx context.Context, rq *request) (result, error) {
	rows, err := a.pool.Query(ctx, "SELECT id, amount_cents, reason, booking_id, match_id, created_at FROM credits WHERE username = $1 ORDER BY id DESC", rq.me.Username)
	if err != nil {
		return result{}, fmt.Errorf("list credits: %w", err)
	}
	defer rows.Close()
	entries := []CreditEntry{}
	balance := 0
	for rows.Next() {
		var e CreditEntry
		var at time.Time
		if err := rows.Scan(&e.ID, &e.AmountCents, &e.Reason, &e.BookingID, &e.MatchID, &at); err != nil {
			return result{}, fmt.Errorf("read credit: %w", err)
		}
		e.CreatedAt = formatUTC(at)
		balance += e.AmountCents
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return result{}, fmt.Errorf("list credits: %w", err)
	}
	return ok(map[string]any{"balance_cents": balance, "entries": entries}), nil
}

// writeCredit adds a line to the credit ledger.
func (a *App) writeCredit(ctx context.Context, q querier, credit CreditAmount, reason string, bookingID, matchID *string) error {
	if _, err := q.Exec(ctx, "INSERT INTO credits (username, amount_cents, reason, booking_id, match_id) VALUES ($1, $2, $3, $4, $5)",
		credit.Username, credit.AmountCents, reason, bookingID, matchID); err != nil {
		return fmt.Errorf("write credit for %s: %w", credit.Username, err)
	}
	return nil
}

// creditLateCapture turns an amount the provider captured after it stopped being due into a late_capture credit
// with its notices: the refunded notices when the booking was cancelled, the credit notices otherwise.
func (a *App) creditLateCapture(ctx context.Context, q querier, payer person, cents int, slot slotRef, bookingID, matchID *string, bookingCancelled bool) error {
	if err := a.writeCredit(ctx, q, CreditAmount{payer.Username, cents}, creditLateCapture, bookingID, matchID); err != nil {
		return err
	}
	event := eventCredited
	if bookingCancelled {
		event = eventRefunded
	}
	return a.queueNotices(ctx, q, a.creditNotices(event, payer, slot, cents))
}
