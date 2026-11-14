package main

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

type matchRow struct {
	ID        string
	Court     int
	Start     time.Time
	Minutes   int
	LevelMin  float64
	LevelMax  float64
	State     string
	Players   int
	Share     int
	Cutoff    time.Time
	BookingID *string
	Joined    bool
	Now       time.Time
}

const matchSelect = `SELECT m.id, m.court, m.start_utc, m.minutes, m.level_min::float8, m.level_max::float8, m.state,
	m.players, m.share_cents, m.cutoff_at, m.booking_id,
	EXISTS (SELECT 1 FROM match_place p WHERE p.match_id = m.id AND p.player = $1 AND p.status = 'paid'), now()
	FROM match_now m `

func scanMatches(rows pgx.Rows) ([]matchRow, error) {
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (matchRow, error) {
		var m matchRow
		err := r.Scan(&m.ID, &m.Court, &m.Start, &m.Minutes, &m.LevelMin, &m.LevelMax, &m.State, &m.Players, &m.Share,
			&m.Cutoff, &m.BookingID, &m.Joined, &m.Now)
		return m, err
	})
}

func loadMatch(ctx context.Context, q querier, id, viewer string) (*matchRow, error) {
	rows, err := q.Query(ctx, matchSelect+`WHERE m.id = $2`, viewer, id)
	if err != nil {
		return nil, fmt.Errorf("load match: %w", err)
	}
	list, err := scanMatches(rows)
	if err != nil {
		return nil, fmt.Errorf("load match: %w", err)
	}
	if len(list) == 0 {
		return nil, nil
	}
	return &list[0], nil
}

func viewerName(c *call) string {
	if c.user == nil {
		return ""
	}
	return c.user.Username
}

func (a *app) matchBody(m *matchRow) map[string]any {
	var booking *string
	if m.Joined {
		booking = m.BookingID
	}
	return map[string]any{
		"id": m.ID, "court": m.Court, "start": a.cfg.clubOffsetTime(m.Start), "start_utc": utcStamp(m.Start),
		"minutes": m.Minutes, "level_min": m.LevelMin, "level_max": m.LevelMax, "status": m.State, "players": m.Players,
		"share_cents": m.Share, "cutoff_at": utcStamp(m.Cutoff), "joined": m.Joined, "booking_id": booking,
		"server_now": utcStamp(m.Now),
	}
}

func (a *app) lookupMatch(c *call) error {
	m, err := loadMatch(c.ctx, a.db, pathID(c, "id"), viewerName(c))
	if err != nil {
		return err
	}
	if m == nil {
		return fail("NOT_FOUND")
	}
	return nil
}

func (a *app) getMatch(c *call) (int, any, error) {
	m, err := loadMatch(c.ctx, a.db, pathID(c, "id"), viewerName(c))
	if err != nil {
		return 0, nil, err
	}
	return 200, a.matchBody(m), nil
}

func (a *app) listMatches(c *call) (int, any, error) {
	q := c.r.URL.Query()
	errs := map[string]string{}
	level := math.NaN()
	if v := q.Get("level"); v != "" {
		f, err := strconv.ParseFloat(v, 64)
		if err != nil || !validLevel(f) {
			errs["level"] = msgLevels
		}
		level = f
	}
	var from, to *time.Time
	if v := q.Get("day"); v != "" {
		d, ok := parseClubDate(v)
		if !ok {
			errs["day"] = msgDate
		} else {
			f, t := a.cfg.dayBounds(d)
			from, to = &f, &t
		}
	}
	if len(errs) > 0 {
		return 0, nil, invalid(errs)
	}
	var levelArg *float64
	if !math.IsNaN(level) {
		levelArg = &level
	}
	rows, err := a.db.Query(c.ctx, matchSelect+`WHERE m.start_utc > now()
		AND ($2::float8 IS NULL OR (m.level_min <= $2 AND m.level_max >= $2))
		AND ($3::timestamptz IS NULL OR (m.start_utc >= $3 AND m.start_utc < $4))
		ORDER BY m.start_utc, m.court, m.id`, viewerName(c), levelArg, from, to)
	if err != nil {
		return 0, nil, fmt.Errorf("list matches: %w", err)
	}
	list, err := scanMatches(rows)
	if err != nil {
		return 0, nil, fmt.Errorf("list matches: %w", err)
	}
	items := make([]map[string]any, 0, len(list))
	for i := range list {
		items = append(items, a.matchBody(&list[i]))
	}
	return 200, map[string]any{"items": items}, nil
}

func levelInRange(level *float64, lo, hi float64) bool {
	return level != nil && *level >= lo && *level <= hi
}

func (a *app) createMatch(c *call) (int, any, error) {
	f, err := c.fields()
	if err != nil {
		return 0, nil, err
	}
	now, err := dbNow(c.ctx, a.db)
	if err != nil {
		return 0, nil, err
	}
	errs := map[string]string{}
	slot := a.parseSlot(f, now, errs)
	if _, bad := errs["start"]; !bad && !a.cfg.cutoffAt(slot.Start).After(now) {
		errs["start"] = msgMatchTooLate
	}
	lo, okLo := f.floatField("level_min")
	hi, okHi := f.floatField("level_max")
	if !okLo || !validLevel(lo) {
		errs["level_min"] = msgLevels
	}
	if !okHi || !validLevel(hi) || (okLo && hi < lo) {
		errs["level_max"] = msgLevels
	}
	if len(errs) == 0 && !levelInRange(c.user.Level, lo, hi) {
		errs["level"] = msgLevel
	}
	if len(errs) > 0 {
		return 0, nil, invalid(errs)
	}
	free, err := a.slotFree(c.ctx, slot)
	if err != nil {
		return 0, nil, err
	}
	if !free {
		return 0, nil, fail("SLOT_TAKEN")
	}
	price, err := a.cfg.priceFor(c.ctx, a.db, slot.Start, slot.Minutes)
	if err != nil {
		return 0, nil, err
	}
	shares := splitShares(price.Total, 4)
	id := newID("mt")
	res := a.courtpay.charge(c.ctx, shares[0], id, c.user.Email)
	if res.Outcome != payAccepted {
		return 0, nil, res.asError(false)
	}
	lost := false
	err = a.tx(c.ctx, func(t *txn) error {
		won, err := a.claimSlot(c.ctx, t, id, slot)
		if err != nil {
			return err
		}
		creator, err := recipientOf(c.ctx, t, c.user.Username)
		if err != nil {
			return err
		}
		ref := slotRef{slot.Court, slot.Start}
		if !won {
			lost = true
			if err := addCredit(c.ctx, t, creator.Username, shares[0], "late_capture", nil, &id); err != nil {
				return err
			}
			t.notify(a.creditedNotices(creator, ref, shares[0])...)
			return nil
		}
		if _, err := t.Exec(c.ctx, `INSERT INTO match (id, court, start_utc, minutes, level_min, level_max, status,
			total_cents, share_cents, creator, cutoff_at, pricing_version)
			VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $9, $10, $11)`, id, slot.Court, slot.Start, slot.Minutes,
			lo, hi, price.Total, shares[1], creator.Username, a.cfg.cutoffAt(slot.Start), price.Version); err != nil {
			return fmt.Errorf("write match: %w", err)
		}
		if _, err := t.Exec(c.ctx, `INSERT INTO match_place (match_id, player, status, amount_cents, provider_id)
			VALUES ($1, $2, 'paid', $3, $4)`, id, creator.Username, shares[0], res.ID); err != nil {
			return fmt.Errorf("write place: %w", err)
		}
		t.notify(a.joinedNotices(creator, ref)...)
		return nil
	})
	if err != nil {
		return 0, nil, err
	}
	if lost {
		return 0, nil, fail("SLOT_TAKEN")
	}
	m, err := loadMatch(c.ctx, a.db, id, c.user.Username)
	if err != nil {
		return 0, nil, err
	}
	return 201, a.matchBody(m), nil
}

// joinConflict is the 409 for a join that cannot take a place now.
func joinConflict(m *matchRow, alreadyIn bool) *apiError {
	switch {
	case m.Players >= 4 || m.State == "full":
		return fail("MATCH_FULL")
	case m.State == "cancelled" || !m.Now.Before(m.Cutoff):
		return fail("MATCH_CLOSED")
	case alreadyIn:
		return fail("ALREADY_JOINED")
	}
	return nil
}

func hasPlace(ctx context.Context, q querier, matchID, username string) (bool, error) {
	var in bool
	err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM match_place WHERE match_id = $1 AND player = $2)`, matchID, username).Scan(&in)
	if err != nil {
		return false, fmt.Errorf("read place: %w", err)
	}
	return in, nil
}

func (a *app) joinMatch(c *call) (int, any, error) {
	id, me := pathID(c, "id"), c.user.Username
	m, err := loadMatch(c.ctx, a.db, id, me)
	if err != nil {
		return 0, nil, err
	}
	in, err := hasPlace(c.ctx, a.db, id, me)
	if err != nil {
		return 0, nil, err
	}
	if conflict := joinConflict(m, in); conflict != nil {
		return 0, nil, conflict
	}
	if !levelInRange(c.user.Level, m.LevelMin, m.LevelMax) {
		return 0, nil, invalidField("level", msgLevel)
	}
	var conflict *apiError
	err = a.tx(c.ctx, func(t *txn) error {
		if _, err := t.Exec(c.ctx, `SELECT 1 FROM match WHERE id = $1 FOR UPDATE`, id); err != nil {
			return fmt.Errorf("lock match: %w", err)
		}
		locked, err := loadMatch(c.ctx, t, id, me)
		if err != nil {
			return err
		}
		in, err := hasPlace(c.ctx, t, id, me)
		if err != nil {
			return err
		}
		if conflict = joinConflict(locked, in); conflict != nil {
			return nil
		}
		_, err = t.Exec(c.ctx, `INSERT INTO match_place (match_id, player, status, amount_cents) VALUES ($1, $2, 'reserved', $3)`,
			id, me, locked.Share)
		if err != nil {
			return fmt.Errorf("reserve place: %w", err)
		}
		return nil
	})
	if err != nil {
		return 0, nil, err
	}
	if conflict != nil {
		return 0, nil, conflict
	}
	res := a.courtpay.charge(c.ctx, m.Share, id, c.user.Email)
	if res.Outcome != payAccepted {
		err := a.tx(c.ctx, func(t *txn) error {
			if _, err := t.Exec(c.ctx, `SELECT 1 FROM match WHERE id = $1 FOR UPDATE`, id); err != nil {
				return fmt.Errorf("lock match: %w", err)
			}
			if _, err := t.Exec(c.ctx, `DELETE FROM match_place WHERE match_id = $1 AND player = $2 AND status = 'reserved'`, id, me); err != nil {
				return fmt.Errorf("drop reservation: %w", err)
			}
			return a.cancelMatchesAtCutoff(c.ctx, t, m.Court)
		})
		if err != nil {
			return 0, nil, err
		}
		return 0, nil, res.asError(false)
	}
	err = a.tx(c.ctx, func(t *txn) error {
		var status string
		if err := t.QueryRow(c.ctx, `SELECT status FROM match WHERE id = $1 FOR UPDATE`, id).Scan(&status); err != nil {
			return fmt.Errorf("lock match: %w", err)
		}
		joiner, err := recipientOf(c.ctx, t, me)
		if err != nil {
			return err
		}
		ref := slotRef{m.Court, m.Start}
		if status != "open" {
			conflict = fail("MATCH_CLOSED")
			if _, err := t.Exec(c.ctx, `DELETE FROM match_place WHERE match_id = $1 AND player = $2 AND status = 'reserved'`, id, me); err != nil {
				return fmt.Errorf("drop reservation: %w", err)
			}
			if err := addCredit(c.ctx, t, me, m.Share, "late_capture", nil, &id); err != nil {
				return err
			}
			t.notify(a.creditedNotices(joiner, ref, m.Share)...)
			return nil
		}
		if _, err := t.Exec(c.ctx, `UPDATE match_place SET status = 'paid', provider_id = $3 WHERE match_id = $1 AND player = $2`,
			id, me, res.ID); err != nil {
			return fmt.Errorf("pay place: %w", err)
		}
		t.notify(a.joinedNotices(joiner, ref)...)
		return a.fillMatchIfComplete(c.ctx, t, id)
	})
	if err != nil {
		return 0, nil, err
	}
	if conflict != nil {
		return 0, nil, conflict
	}
	m, err = loadMatch(c.ctx, a.db, id, me)
	if err != nil {
		return 0, nil, err
	}
	return 200, a.matchBody(m), nil
}

// fillMatchIfComplete is the open to full transition, writing the paid match booking.
func (a *app) fillMatchIfComplete(ctx context.Context, t *txn, matchID string) error {
	rows, err := t.Query(ctx, `SELECT player, amount_cents FROM match_place WHERE match_id = $1 AND status = 'paid' ORDER BY seq`, matchID)
	if err != nil {
		return fmt.Errorf("read places: %w", err)
	}
	type place struct {
		player string
		amount int
	}
	places, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (place, error) {
		var p place
		err := r.Scan(&p.player, &p.amount)
		return p, err
	})
	if err != nil {
		return fmt.Errorf("read places: %w", err)
	}
	if len(places) < 4 {
		return nil
	}
	bookingID := newID("bk")
	var s slotRef
	if err := t.QueryRow(ctx, `UPDATE match SET status = 'full', booking_id = $2 WHERE id = $1 AND status = 'open'
		RETURNING court, start_utc`, matchID, bookingID).Scan(&s.Court, &s.Start); err != nil {
		return fmt.Errorf("fill match: %w", err)
	}
	if _, err := t.Exec(ctx, `INSERT INTO booking (id, kind, status, court, start_utc, minutes, total_cents, organiser,
		pricing_version, split, match_id, paid_at)
		SELECT $2, 'match', 'paid', court, start_utc, minutes, total_cents, creator, pricing_version, false, id, now()
		FROM match WHERE id = $1`, matchID, bookingID); err != nil {
		return fmt.Errorf("write match booking: %w", err)
	}
	for i, p := range places {
		if _, err := t.Exec(ctx, `INSERT INTO share (booking_id, position, player, amount_cents, status, token)
			VALUES ($1, $2, $3, $4, 'paid', $5)`, bookingID, i+1, p.player, p.amount, randomString(32)); err != nil {
			return fmt.Errorf("write match share: %w", err)
		}
		r, err := recipientOf(ctx, t, p.player)
		if err != nil {
			return err
		}
		t.notify(a.fullNotices(r, s)...)
	}
	t.notify(a.deskFullNotice(s))
	return nil
}

// cancelMatchesAtCutoff cancels open matches past their cut-off with fewer
// than four players, reserved places included, on one court or (court 0) all.
func (a *app) cancelMatchesAtCutoff(ctx context.Context, t *txn, court int) error {
	rows, err := t.Query(ctx, `SELECT id FROM match WHERE status = 'open' AND cutoff_at <= now()
		AND ($1 = 0 OR court = $1) ORDER BY id FOR UPDATE`, court)
	if err != nil {
		return fmt.Errorf("find cut-off matches: %w", err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return fmt.Errorf("find cut-off matches: %w", err)
	}
	for _, id := range ids {
		var s slotRef
		err := t.QueryRow(ctx, `UPDATE match m SET status = 'cancelled' WHERE m.id = $1
			AND (SELECT count(*) FROM match_place WHERE match_id = m.id) < 4 RETURNING court, start_utc`, id).Scan(&s.Court, &s.Start)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return fmt.Errorf("cancel match: %w", err)
		}
		if _, err := t.Exec(ctx, `DELETE FROM court_claim WHERE owner = $1`, id); err != nil {
			return fmt.Errorf("free court: %w", err)
		}
		places, err := t.Query(ctx, `SELECT player, amount_cents FROM match_place WHERE match_id = $1 AND status = 'paid' ORDER BY seq`, id)
		if err != nil {
			return fmt.Errorf("read places: %w", err)
		}
		type paid struct {
			player string
			amount int
		}
		list, err := pgx.CollectRows(places, func(r pgx.CollectableRow) (paid, error) {
			var p paid
			err := r.Scan(&p.player, &p.amount)
			return p, err
		})
		if err != nil {
			return fmt.Errorf("read places: %w", err)
		}
		for _, p := range list {
			matchID := id
			if err := addCredit(ctx, t, p.player, p.amount, "match_cancelled", nil, &matchID); err != nil {
				return err
			}
			r, err := recipientOf(ctx, t, p.player)
			if err != nil {
				return err
			}
			t.notify(a.cancelledNotices(r, s, p.amount)...)
		}
	}
	return nil
}

// countJoinAttempt allows 6 join attempts per player in any rolling 60 seconds.
func (a *app) countJoinAttempt(ctx context.Context, username string) error {
	var limited *apiError
	err := a.tx(ctx, func(t *txn) error {
		if _, err := t.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "join:"+username); err != nil {
			return fmt.Errorf("lock join attempts: %w", err)
		}
		var count int
		var wait float64
		if err := t.QueryRow(ctx, `SELECT count(*), COALESCE(EXTRACT(EPOCH FROM min(at) + interval '60 seconds' - clock_timestamp()), 0)
			FROM join_attempt WHERE username = $1 AND at > clock_timestamp() - interval '60 seconds'`, username).Scan(&count, &wait); err != nil {
			return fmt.Errorf("count join attempts: %w", err)
		}
		if count >= 6 {
			limited = fail("RATE_LIMITED")
			limited.RetryAfter = min(max(int(math.Ceil(wait)), 1), 60)
			return nil
		}
		if _, err := t.Exec(ctx, `INSERT INTO join_attempt (username) VALUES ($1)`, username); err != nil {
			return fmt.Errorf("count join attempt: %w", err)
		}
		return nil
	})
	if err != nil {
		return err
	}
	if limited != nil {
		return limited
	}
	return nil
}
