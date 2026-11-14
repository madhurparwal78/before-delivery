package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// MatchView is the match body.
type MatchView struct {
	ID         string  `json:"id"`
	Court      int     `json:"court"`
	Start      string  `json:"start"`
	StartUTC   string  `json:"start_utc"`
	Minutes    int     `json:"minutes"`
	LevelMin   float64 `json:"level_min"`
	LevelMax   float64 `json:"level_max"`
	Status     string  `json:"status"`
	Players    int     `json:"players"`
	ShareCents int     `json:"share_cents"`
	CutoffAt   string  `json:"cutoff_at"`
	Joined     bool    `json:"joined"`
	BookingID  *string `json:"booking_id"`
	ServerNow  string  `json:"server_now"`
}

type matchRow struct {
	ID         string
	Court      int
	Start      time.Time
	Minutes    int
	LevelMin   float64
	LevelMax   float64
	Status     string
	CutoffAt   time.Time
	TotalCents int
	Creator    string
	BookingID  *string
	Players    int
	Joined     bool
	Reserved   bool
}

// matchSelect reads a match with its player count and what the caller holds in it ($1 is the caller's username).
const matchSelect = `SELECT m.id, m.court, m.start_utc, m.minutes, m.level_min::float8, m.level_max::float8, m.status, m.cutoff_at,
	m.total_cents, m.creator, m.booking_id,
	(SELECT count(*) FROM place_reservations pr WHERE pr.match_id = m.id),
	EXISTS (SELECT 1 FROM place_reservations pr WHERE pr.match_id = m.id AND pr.username = $1 AND pr.status = '` + placePaid + `'),
	EXISTS (SELECT 1 FROM place_reservations pr WHERE pr.match_id = m.id AND pr.username = $1)
	FROM matches m`

func scanMatch(row pgx.Row) (matchRow, error) {
	var m matchRow
	err := row.Scan(&m.ID, &m.Court, &m.Start, &m.Minutes, &m.LevelMin, &m.LevelMax, &m.Status, &m.CutoffAt, &m.TotalCents,
		&m.Creator, &m.BookingID, &m.Players, &m.Joined, &m.Reserved)
	return m, err
}

// loadMatch reads a match. When asked it first locks the match row in a statement of its own, so the player count it
// then reads is taken after any competing reservation has committed.
func loadMatch(ctx context.Context, q querier, id, username string, lock bool) (matchRow, error) {
	if lock {
		if _, err := q.Exec(ctx, "SELECT 1 FROM matches WHERE id = $1 FOR UPDATE", id); err != nil {
			return matchRow{}, fmt.Errorf("lock match %s: %w", id, err)
		}
	}
	m, err := scanMatch(q.QueryRow(ctx, matchSelect+" WHERE m.id = $2", username, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return matchRow{}, fail(codeNotFound)
	}
	if err != nil {
		return matchRow{}, fmt.Errorf("load match %s: %w", id, err)
	}
	return m, nil
}

func (m matchRow) status(now time.Time) string {
	return effectiveMatchStatus(m.Status, m.CutoffAt, m.Players, now)
}

func (a *App) matchView(m matchRow, now time.Time) MatchView {
	view := MatchView{ID: m.ID, Court: m.Court, Start: a.clock.formatClub(m.Start), StartUTC: formatUTC(m.Start), Minutes: m.Minutes,
		LevelMin: m.LevelMin, LevelMax: m.LevelMax, Status: m.status(now), Players: m.Players,
		ShareCents: joinerShare(m.TotalCents), CutoffAt: formatUTC(m.CutoffAt), Joined: m.Joined, ServerNow: formatUTC(now)}
	if m.Joined {
		view.BookingID = m.BookingID
	}
	return view
}

func callerName(me *Identity) string {
	if me == nil {
		return ""
	}
	return me.Username
}

func (a *App) getMatch(ctx context.Context, rq *request) (result, error) {
	m, err := loadMatch(ctx, a.pool, rq.r.PathValue("id"), callerName(rq.me), false)
	if err != nil {
		return result{}, err
	}
	now, err := dbNow(ctx, a.pool)
	if err != nil {
		return result{}, err
	}
	return ok(a.matchView(m, now)), nil
}

func (a *App) getMatches(ctx context.Context, rq *request) (result, error) {
	query := rq.r.URL.Query()
	problems := fieldErrors{}
	args := []any{callerName(rq.me)}
	sql := matchSelect + " WHERE m.start_utc > clock_timestamp()"
	if raw := query.Get("level"); raw != "" {
		value, err := strconv.ParseFloat(raw, 64)
		if err != nil || !validLevel(value) {
			problems["level"] = msgLevels
		} else {
			args = append(args, value)
			sql += fmt.Sprintf(" AND m.level_min <= $%d AND m.level_max >= $%d", len(args), len(args))
		}
	}
	if raw := query.Get("day"); raw != "" {
		day, valid := parseDay(raw)
		if !valid {
			problems["day"] = msgDate
		} else {
			from, to := a.dayBounds(day)
			args = append(args, from, to)
			sql += fmt.Sprintf(" AND m.start_utc >= $%d AND m.start_utc < $%d", len(args)-1, len(args))
		}
	}
	if err := problems.err(); err != nil {
		return result{}, err
	}
	rows, err := a.pool.Query(ctx, sql+" ORDER BY m.start_utc, m.court, m.id", args...)
	if err != nil {
		return result{}, fmt.Errorf("list matches: %w", err)
	}
	defer rows.Close()
	now, err := dbNow(ctx, a.pool)
	if err != nil {
		return result{}, err
	}
	items := []MatchView{}
	for rows.Next() {
		m, err := scanMatch(rows)
		if err != nil {
			return result{}, fmt.Errorf("read match: %w", err)
		}
		items = append(items, a.matchView(m, now))
	}
	if err := rows.Err(); err != nil {
		return result{}, fmt.Errorf("list matches: %w", err)
	}
	return ok(map[string]any{"items": items}), nil
}

// ---- creating ----

type matchInput struct {
	court              int
	start              time.Time
	minutes            int
	levelMin, levelMax float64
}

func (a *App) parseMatch(rq *request, now time.Time) (matchInput, error) {
	var body struct {
		Court    json.RawMessage `json:"court"`
		Start    json.RawMessage `json:"start"`
		Minutes  json.RawMessage `json:"minutes"`
		LevelMin json.RawMessage `json:"level_min"`
		LevelMax json.RawMessage `json:"level_max"`
	}
	if err := decodeJSON(rq, &body); err != nil {
		return matchInput{}, err
	}
	var in matchInput
	problems := fieldErrors{}
	if court, valid := rawInt(body.Court); valid && court >= 1 && court <= courtCount {
		in.court = court
	} else {
		problems["court"] = msgCourt
	}
	if minutes, valid := rawInt(body.Minutes); valid && allowedLength(minutes) {
		in.minutes = minutes
	} else {
		problems["minutes"] = msgMinutes
	}
	if text, valid := rawString(body.Start); valid {
		length := in.minutes
		if length == 0 {
			length = defaultMinutes
		}
		if start, ok := a.clock.slotStart(text, length); !ok {
			problems["start"] = msgStart
		} else if !start.After(now) {
			problems["start"] = msgStartFuture
		} else if !a.matchCutoff(start).After(now) {
			problems["start"] = msgMatchLate
		} else {
			in.start = start
		}
	} else {
		problems["start"] = msgStart
	}
	lowest, lowOK := rawFloat(body.LevelMin)
	highest, highOK := rawFloat(body.LevelMax)
	if lowOK && highOK && validLevel(lowest) && validLevel(highest) && lowest <= highest {
		in.levelMin, in.levelMax = lowest, highest
	} else {
		problems["level_min"], problems["level_max"] = msgLevels, msgLevels
	}
	if err := problems.err(); err != nil {
		return matchInput{}, err
	}
	return in, nil
}

func levelInside(level *float64, low, high float64) bool {
	return level != nil && *level >= low && *level <= high
}

func (a *App) postMatch(ctx context.Context, rq *request) (result, error) {
	return a.withIdempotency(ctx, rq, func() (result, error) {
		now, err := dbNow(ctx, a.pool)
		if err != nil {
			return result{}, err
		}
		in, err := a.parseMatch(rq, now)
		if err != nil {
			return result{}, err
		}
		if !levelInside(rq.me.Level, in.levelMin, in.levelMax) {
			return result{}, failValidation(map[string]string{"level": msgLevel})
		}
		end := slotEnd(in.start, in.minutes)
		if taken, err := slotTaken(ctx, a.pool, in.court, in.start, end); err != nil {
			return result{}, err
		} else if taken {
			return result{}, fail(codeSlotTaken)
		}
		quote, err := a.quoteSlot(ctx, a.pool, in.court, in.start, in.minutes)
		if err != nil {
			return result{}, err
		}
		id := newID("mt_")
		answer := a.courtpay.charge(ctx, creatorShare(quote.TotalCents), id, rq.me.Email)
		if answer.outcome != providerAccepted {
			return result{}, paymentFailure(answer, false)
		}
		view, err := a.writeMatch(ctx, rq.me, id, in, quote)
		if err != nil {
			return result{}, err
		}
		return created(view), nil
	})
}

// writeMatch opens a match once its creator's charge is captured. A creator whose slot was taken while the charge
// ran is credited the captured amount as a late capture.
func (a *App) writeMatch(ctx context.Context, me *Identity, id string, in matchInput, quote Quote) (MatchView, error) {
	var view MatchView
	var lost bool
	err := withTx(ctx, a.pool, func(tx pgx.Tx) error {
		if err := lockCourt(ctx, tx, in.court); err != nil {
			return err
		}
		end := slotEnd(in.start, in.minutes)
		taken, err := slotTaken(ctx, tx, in.court, in.start, end)
		if err != nil {
			return err
		}
		slot := slotRef{in.court, in.start}
		if taken {
			lost = true
			return a.creditLateCapture(ctx, tx, me.asPerson(), creatorShare(quote.TotalCents), slot, nil, &id, false)
		}
		now, err := dbNow(ctx, tx)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO matches (id, court, start_utc, minutes, level_min, level_max, total_cents, creator, status, created_at, cutoff_at, pricing_version)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, id, in.court, in.start, in.minutes, in.levelMin, in.levelMax,
			quote.TotalCents, me.Username, matchOpen, now, a.matchCutoff(in.start), quote.PricingVersion); err != nil {
			return fmt.Errorf("insert match: %w", err)
		}
		if _, err := tx.Exec(ctx, "INSERT INTO place_reservations (match_id, username, amount_cents, status) VALUES ($1, $2, $3, $4)",
			id, me.Username, creatorShare(quote.TotalCents), placePaid); err != nil {
			return fmt.Errorf("insert creator place: %w", err)
		}
		if err := a.queueNotices(ctx, tx, a.joinedNotices(me.asPerson(), slot)); err != nil {
			return err
		}
		m, err := loadMatch(ctx, tx, id, me.Username, false)
		if err != nil {
			return err
		}
		view = a.matchView(m, now)
		return nil
	})
	if err != nil {
		return MatchView{}, err
	}
	if lost {
		return MatchView{}, fail(codeSlotTaken)
	}
	return view, nil
}

// ---- joining ----

// limitJoins counts a player's join attempts in a rolling minute: the seventh answers 429 with the seconds until the
// oldest counted attempt leaves the window.
func (a *App) limitJoins(ctx context.Context, me *Identity) error {
	return withTx(ctx, a.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext($1))", "joins:"+me.Username); err != nil {
			return fmt.Errorf("lock join attempts: %w", err)
		}
		var count int
		var oldest *time.Time
		var now time.Time
		err := tx.QueryRow(ctx, `SELECT count(*), min(attempted_at), clock_timestamp() FROM join_attempts
			WHERE username = $1 AND attempted_at > clock_timestamp() - $2::interval`, me.Username,
			fmt.Sprintf("%d seconds", int(joinAttemptWindow.Seconds()))).Scan(&count, &oldest, &now)
		if err != nil {
			return fmt.Errorf("count join attempts: %w", err)
		}
		if count >= joinAttemptLimit {
			wait := int(math.Ceil(oldest.Add(joinAttemptWindow).Sub(now).Seconds()))
			return failRateLimited(min(max(wait, 1), int(joinAttemptWindow.Seconds())))
		}
		if _, err := tx.Exec(ctx, "INSERT INTO join_attempts (username) VALUES ($1)", me.Username); err != nil {
			return fmt.Errorf("record join attempt: %w", err)
		}
		if _, err := tx.Exec(ctx, "DELETE FROM join_attempts WHERE username = $1 AND attempted_at <= clock_timestamp() - $2::interval", me.Username,
			fmt.Sprintf("%d seconds", int(joinAttemptWindow.Seconds()))); err != nil {
			return fmt.Errorf("prune join attempts: %w", err)
		}
		return nil
	})
}

// joinConflict is the one place a join's state conflicts are decided: a full match first, then a closed one, then
// a place the player already holds.
func joinConflict(m matchRow, now time.Time) *apiError {
	switch {
	case m.Players >= placesPerMatch:
		return fail(codeMatchFull)
	case m.status(now) == matchCancelled:
		return fail(codeMatchClosed)
	case m.Reserved:
		return fail(codeAlreadyJoined)
	}
	return nil
}

func (a *App) postJoin(ctx context.Context, rq *request) (result, error) {
	m, err := loadMatch(ctx, a.pool, rq.r.PathValue("id"), rq.me.Username, false)
	if err != nil {
		return result{}, err
	}
	return a.withIdempotency(ctx, rq, func() (result, error) {
		now, err := dbNow(ctx, a.pool)
		if err != nil {
			return result{}, err
		}
		m, err = loadMatch(ctx, a.pool, m.ID, rq.me.Username, false)
		if err != nil {
			return result{}, err
		}
		if conflict := joinConflict(m, now); conflict != nil {
			return result{}, conflict
		}
		if !levelInside(rq.me.Level, m.LevelMin, m.LevelMax) {
			return result{}, failValidation(map[string]string{"level": msgLevel})
		}
		if err := a.reservePlace(ctx, rq.me, m.ID, joinerShare(m.TotalCents)); err != nil {
			return result{}, err
		}
		answer := a.courtpay.charge(ctx, joinerShare(m.TotalCents), m.ID, rq.me.Email)
		if answer.outcome != providerAccepted {
			if err := a.dropReservation(ctx, m.ID, rq.me.Username); err != nil {
				return result{}, err
			}
			return result{}, paymentFailure(answer, false)
		}
		return a.confirmPlace(ctx, rq.me, m.ID)
	})
}

// reservePlace commits a place reservation under a lock on the match row; it counts toward the match's players
// from this commit, and of simultaneous joins for the last place exactly one wins.
func (a *App) reservePlace(ctx context.Context, me *Identity, matchID string, amount int) error {
	return withTx(ctx, a.pool, func(tx pgx.Tx) error {
		m, err := loadMatch(ctx, tx, matchID, me.Username, true)
		if err != nil {
			return err
		}
		now, err := dbNow(ctx, tx)
		if err != nil {
			return err
		}
		if conflict := joinConflict(m, now); conflict != nil {
			return conflict
		}
		if _, err := tx.Exec(ctx, "INSERT INTO place_reservations (match_id, username, amount_cents, status) VALUES ($1, $2, $3, $4)",
			matchID, me.Username, amount, placeReserved); err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation {
				return fail(codeAlreadyJoined)
			}
			return fmt.Errorf("reserve place: %w", err)
		}
		return nil
	})
}

// dropReservation removes a reservation at the moment its charge fails; the joiner gets no ledger entry.
func (a *App) dropReservation(ctx context.Context, matchID, username string) error {
	if _, err := a.pool.Exec(ctx, "DELETE FROM place_reservations WHERE match_id = $1 AND username = $2 AND status = $3",
		matchID, username, placeReserved); err != nil {
		return fmt.Errorf("drop reservation: %w", err)
	}
	return nil
}

// confirmPlace turns a reservation into a paid place once its charge is captured, and fills the match when it is the
// fourth. A place whose match was cancelled while the charge ran is credited as a late capture instead.
func (a *App) confirmPlace(ctx context.Context, me *Identity, matchID string) (result, error) {
	var res result
	var closed bool
	err := withTx(ctx, a.pool, func(tx pgx.Tx) error {
		m, err := loadMatch(ctx, tx, matchID, me.Username, true)
		if err != nil {
			return err
		}
		now, err := dbNow(ctx, tx)
		if err != nil {
			return err
		}
		slot := slotRef{m.Court, m.Start}
		if m.status(now) == matchCancelled {
			closed = true
			if _, err := tx.Exec(ctx, "DELETE FROM place_reservations WHERE match_id = $1 AND username = $2", matchID, me.Username); err != nil {
				return fmt.Errorf("drop closed place: %w", err)
			}
			return a.creditLateCapture(ctx, tx, me.asPerson(), joinerShare(m.TotalCents), slot, nil, &m.ID, false)
		}
		if _, err := tx.Exec(ctx, "UPDATE place_reservations SET status = $3 WHERE match_id = $1 AND username = $2",
			matchID, me.Username, placePaid); err != nil {
			return fmt.Errorf("pay place: %w", err)
		}
		if err := a.queueNotices(ctx, tx, a.joinedNotices(me.asPerson(), slot)); err != nil {
			return err
		}
		var paid int
		if err := tx.QueryRow(ctx, "SELECT count(*) FROM place_reservations WHERE match_id = $1 AND status = $2", matchID, placePaid).Scan(&paid); err != nil {
			return fmt.Errorf("count paid places: %w", err)
		}
		if paid == placesPerMatch {
			if err := a.fillMatch(ctx, tx, m, now); err != nil {
				return err
			}
		}
		m, err = loadMatch(ctx, tx, matchID, me.Username, false)
		if err != nil {
			return err
		}
		res = ok(a.matchView(m, now))
		return nil
	})
	if err != nil {
		return result{}, err
	}
	if closed {
		return result{}, fail(codeMatchClosed)
	}
	return res, nil
}

// fillMatch is the one place a match becomes full: in the same step a paid booking of kind match is written with
// the four paid shares in join order, and the full notices are queued.
func (a *App) fillMatch(ctx context.Context, tx pgx.Tx, m matchRow, now time.Time) error {
	rows, err := tx.Query(ctx, "SELECT username, amount_cents FROM place_reservations WHERE match_id = $1 ORDER BY id", m.ID)
	if err != nil {
		return fmt.Errorf("list places: %w", err)
	}
	type place struct {
		username string
		amount   int
	}
	var places []place
	for rows.Next() {
		var p place
		if err := rows.Scan(&p.username, &p.amount); err != nil {
			rows.Close()
			return fmt.Errorf("read place: %w", err)
		}
		places = append(places, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("list places: %w", err)
	}
	bookingID := newID("bk_")
	if _, err := tx.Exec(ctx, `INSERT INTO bookings (id, kind, court, start_utc, minutes, total_cents, organiser, status, created_at, pricing_version, match_id, split)
		SELECT $1, $2, court, start_utc, minutes, total_cents, creator, $3, $4, pricing_version, id, true FROM matches WHERE id = $5`,
		bookingID, kindMatch, bookingPaid, now, m.ID); err != nil {
		return fmt.Errorf("write match booking: %w", err)
	}
	slot := slotRef{m.Court, m.Start}
	notices := []notice{a.deskFullNotice(slot)}
	for i, p := range places {
		if _, err := insertShare(ctx, tx, shareBooking, bookingID, i+1, p.username, p.amount, sharePaid); err != nil {
			return err
		}
		person, err := loadPerson(ctx, tx, p.username)
		if err != nil {
			return err
		}
		notices = append(notices, a.fullNotices(person, slot)...)
	}
	if _, err := tx.Exec(ctx, "UPDATE matches SET status = $2, booking_id = $3 WHERE id = $1", m.ID, matchFull, bookingID); err != nil {
		return fmt.Errorf("mark match full: %w", err)
	}
	return a.queueNotices(ctx, tx, notices)
}

// cancelStalledMatch cancels one open match the cut-off has caught with fewer than four players, credits each paid
// player their full paid share and queues the cancellation notices. It reports whether a match was due.
func (a *App) cancelStalledMatch(ctx context.Context) (bool, error) {
	var found bool
	err := withTx(ctx, a.pool, func(tx pgx.Tx) error {
		var id string
		err := tx.QueryRow(ctx, fmt.Sprintf("SELECT m.id FROM matches m WHERE %s ORDER BY m.cutoff_at LIMIT 1 FOR UPDATE OF m SKIP LOCKED",
			matchStalledSQL("m"))).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("find stalled match: %w", err)
		}
		found = true
		m, err := loadMatch(ctx, tx, id, "", false)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "UPDATE matches SET status = $2 WHERE id = $1", id, matchCancelled); err != nil {
			return fmt.Errorf("cancel match: %w", err)
		}
		rows, err := tx.Query(ctx, "SELECT username, amount_cents FROM place_reservations WHERE match_id = $1 AND status = $2 ORDER BY id", id, placePaid)
		if err != nil {
			return fmt.Errorf("list paid places: %w", err)
		}
		var credits []CreditAmount
		for rows.Next() {
			var c CreditAmount
			if err := rows.Scan(&c.Username, &c.AmountCents); err != nil {
				rows.Close()
				return fmt.Errorf("read paid place: %w", err)
			}
			credits = append(credits, c)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return fmt.Errorf("list paid places: %w", err)
		}
		for _, credit := range credits {
			if err := a.writeCredit(ctx, tx, credit, creditMatchCancelled, nil, &id); err != nil {
				return err
			}
			p, err := loadPerson(ctx, tx, credit.Username)
			if err != nil {
				return err
			}
			if err := a.queueNotices(ctx, tx, a.creditNotices(eventCancelled, p, slotRef{m.Court, m.Start}, credit.AmountCents)); err != nil {
				return err
			}
		}
		return nil
	})
	return found, err
}
