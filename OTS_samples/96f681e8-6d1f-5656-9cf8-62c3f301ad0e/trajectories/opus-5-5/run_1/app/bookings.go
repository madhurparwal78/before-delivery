package main

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type shareRow struct {
	ID       int64
	Position int
	Player   person
	Email    string
	Amount   int
	State    string
	Token    string
}

type bookingRow struct {
	ID        string
	Kind      string
	State     string
	Court     int
	Start     time.Time
	Minutes   int
	Note      string
	Total     int
	Organiser person
	Split     bool
	SettleAt  *time.Time
	MatchID   *string
	CreatedAt time.Time
	ExpiresAt *time.Time
	Now       time.Time
	Shares    []shareRow
}

func (b *bookingRow) slot() slotRef { return slotRef{Court: b.Court, Start: b.Start} }

// loadBooking reads a booking as it stands now, or nil when there is none.
func loadBooking(ctx context.Context, q querier, id string) (*bookingRow, error) {
	b := &bookingRow{}
	err := q.QueryRow(ctx, `SELECT b.id, b.kind, b.state, b.court, b.start_utc, b.minutes, b.note, b.total_cents,
		b.organiser, u.name, b.split, b.settle_at, b.match_id, b.created_at, b.expires_at, now()
		FROM booking_now b JOIN app_user u ON u.username = b.organiser WHERE b.id = $1`, id).
		Scan(&b.ID, &b.Kind, &b.State, &b.Court, &b.Start, &b.Minutes, &b.Note, &b.Total, &b.Organiser.Username,
			&b.Organiser.Name, &b.Split, &b.SettleAt, &b.MatchID, &b.CreatedAt, &b.ExpiresAt, &b.Now)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load booking: %w", err)
	}
	rows, err := q.Query(ctx, `SELECT s.id, s.position, s.player, u.name, u.email, s.amount_cents, s.state, s.token
		FROM share_now s JOIN app_user u ON u.username = s.player WHERE s.booking_id = $1 ORDER BY s.position`, id)
	if err != nil {
		return nil, fmt.Errorf("load shares: %w", err)
	}
	b.Shares, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (shareRow, error) {
		var s shareRow
		err := r.Scan(&s.ID, &s.Position, &s.Player.Username, &s.Player.Name, &s.Email, &s.Amount, &s.State, &s.Token)
		return s, err
	})
	if err != nil {
		return nil, fmt.Errorf("load shares: %w", err)
	}
	return b, nil
}

type shareJSON struct {
	Position int    `json:"position"`
	Player   person `json:"player"`
	Amount   int    `json:"amount_cents"`
	Status   string `json:"status"`
}

type bookingJSON struct {
	ID          string      `json:"id"`
	Kind        string      `json:"kind"`
	Status      string      `json:"status"`
	Court       int         `json:"court"`
	Start       string      `json:"start"`
	StartUTC    string      `json:"start_utc"`
	Minutes     int         `json:"minutes"`
	Note        string      `json:"note"`
	Total       int         `json:"total_cents"`
	Organiser   person      `json:"organiser"`
	Shares      []shareJSON `json:"shares"`
	SettleAt    *string     `json:"settle_at"`
	CreatedAt   string      `json:"created_at"`
	ExpiresAt   *string     `json:"expires_at"`
	RemainingMs *int64      `json:"remaining_ms"`
	ServerNow   string      `json:"server_now"`
}

func (a *app) bookingBody(b *bookingRow) bookingJSON {
	out := bookingJSON{
		ID: b.ID, Kind: b.Kind, Status: b.State, Court: b.Court, Start: a.cfg.clubOffsetTime(b.Start),
		StartUTC: utcStamp(b.Start), Minutes: b.Minutes, Note: b.Note, Total: b.Total, Organiser: b.Organiser,
		Shares: []shareJSON{}, CreatedAt: utcStamp(b.CreatedAt), ServerNow: utcStamp(b.Now),
	}
	for _, s := range b.Shares {
		out.Shares = append(out.Shares, shareJSON{Position: s.Position, Player: s.Player, Amount: s.Amount, Status: s.State})
	}
	if b.SettleAt != nil && b.Kind == "booking" {
		s := utcStamp(*b.SettleAt)
		out.SettleAt = &s
	}
	if b.ExpiresAt != nil {
		s := utcStamp(*b.ExpiresAt)
		out.ExpiresAt = &s
		if b.State == "held" {
			ms := max(b.ExpiresAt.Sub(b.Now).Milliseconds(), 0)
			out.RemainingMs = &ms
		}
	}
	return out
}

func (a *app) lookupBookingReader(c *call) error {
	b, err := loadBooking(c.ctx, a.db, pathID(c, "id"))
	if err != nil {
		return err
	}
	if b == nil || (b.Organiser.Username != c.user.Username && !c.user.has("manager")) {
		return fail("NOT_FOUND")
	}
	return nil
}

func (a *app) lookupOwnBooking(c *call) error {
	b, err := loadBooking(c.ctx, a.db, pathID(c, "id"))
	if err != nil {
		return err
	}
	if b == nil || b.Organiser.Username != c.user.Username {
		return fail("NOT_FOUND")
	}
	return nil
}

func (a *app) bookingAnswer(ctx context.Context, status int, id string) (int, any, error) {
	b, err := loadBooking(ctx, a.db, id)
	if err != nil {
		return 0, nil, err
	}
	return status, a.bookingBody(b), nil
}

func (a *app) getBooking(c *call) (int, any, error) {
	return a.bookingAnswer(c.ctx, 200, pathID(c, "id"))
}

type slotRequest struct {
	Court   int
	Start   time.Time
	Minutes int
}

// parseSlot validates court, start and minutes, adding field messages to errs.
func (a *app) parseSlot(f jsonFields, now time.Time, errs map[string]string) slotRequest {
	var s slotRequest
	court, ok := f.intField("court")
	if !ok || court < 1 || court > 7 {
		errs["court"] = msgCourt
	}
	s.Court = court
	minutes, ok := f.intField("minutes")
	if !ok || (minutes != 60 && minutes != 90 && minutes != 120) {
		errs["minutes"] = msgMinutes
		minutes = 60
	}
	s.Minutes = minutes
	raw, _ := f.stringField("start")
	d, minute, ok := parseWallStart(raw)
	if ok {
		s.Start, ok = a.cfg.slotStart(d, minute, minutes)
	}
	switch {
	case !ok:
		errs["start"] = msgStart
	case !s.Start.After(now):
		errs["start"] = msgStartFuture
	}
	return s
}

func dbNow(ctx context.Context, q querier) (time.Time, error) {
	var now time.Time
	if err := q.QueryRow(ctx, `SELECT now()`).Scan(&now); err != nil {
		return now, fmt.Errorf("read database clock: %w", err)
	}
	return now, nil
}

// registeredPlayers resolves player emails to usernames, in the order given.
func registeredPlayers(ctx context.Context, q querier, emails []string) ([]string, bool, error) {
	var out []string
	for _, e := range emails {
		var username string
		err := q.QueryRow(ctx, `SELECT username FROM app_user WHERE lower(email) = lower($1) AND 'player' = ANY(roles)
			ORDER BY username LIMIT 1`, strings.TrimSpace(e)).Scan(&username)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, false, nil
		}
		if err != nil {
			return nil, false, fmt.Errorf("find player: %w", err)
		}
		out = append(out, username)
	}
	return out, true, nil
}

func distinct(items []string) bool {
	seen := map[string]bool{}
	for _, s := range items {
		if seen[s] {
			return false
		}
		seen[s] = true
	}
	return true
}

func (a *app) postHold(c *call) (int, any, error) {
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
	note := ""
	if f.has("note") {
		var ok bool
		if note, ok = f.stringField("note"); !ok || !withinTextLimit(note) {
			errs["note"] = msgNote
		}
	}
	var coPlayers []string
	if f.has("co_players") {
		emails, ok := f.stringList("co_players")
		switch {
		case !ok:
			errs["co_players"] = msgCoPlayers
		case len(emails) == 0:
		case len(emails) != 3:
			errs["co_players"] = msgCoPlayers
		default:
			names, found, err := registeredPlayers(c.ctx, a.db, emails)
			if err != nil {
				return 0, nil, err
			}
			if !found || !distinct(append([]string{c.user.Username}, names...)) {
				errs["co_players"] = msgCoPlayers
			} else if _, bad := errs["start"]; !bad && !a.cfg.settleAt(slot.Start).After(now) {
				errs["co_players"] = msgSplitTooLate
			}
			coPlayers = names
		}
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
	id := newID("bk")
	auth := a.courtpay.authorize(c.ctx, price.Total, id, c.user.Email)
	if auth.Outcome != payAccepted {
		return 0, nil, auth.asError(true)
	}
	var lostGuarantee int64
	err = a.tx(c.ctx, func(t *txn) error {
		won, err := a.claimSlot(c.ctx, t, id, slot)
		if err != nil {
			return err
		}
		if !won {
			return t.QueryRow(c.ctx, `INSERT INTO guarantee (booking_id, seq, reference, provider_id, amount_cents, status,
				void_state, void_next_at) VALUES ($1, 1, $1, $2, $3, 'voided', 'owed', now() + interval '30 seconds')
				RETURNING id`, id, auth.ID, price.Total).Scan(&lostGuarantee)
		}
		var settle *time.Time
		if len(coPlayers) > 0 {
			s := a.cfg.settleAt(slot.Start)
			settle = &s
		}
		var expiresAt time.Time
		if err := t.QueryRow(c.ctx, `INSERT INTO booking (id, kind, status, court, start_utc, minutes, note, total_cents,
			organiser, pricing_version, split, settle_at, expires_at)
			VALUES ($1, 'booking', 'held', $2, $3, $4, $5, $6, $7, $8, $9, $10, now() + make_interval(secs => $11))
			RETURNING expires_at`, id, slot.Court, slot.Start, slot.Minutes, note, price.Total, c.user.Username,
			price.Version, len(coPlayers) > 0, settle, a.cfg.HoldSeconds).Scan(&expiresAt); err != nil {
			return fmt.Errorf("write hold: %w", err)
		}
		payers := append([]string{c.user.Username}, coPlayers...)
		for i, amount := range splitShares(price.Total, len(payers)) {
			if _, err := t.Exec(c.ctx, `INSERT INTO share (booking_id, position, player, amount_cents, status, token)
				VALUES ($1, $2, $3, $4, 'due', $5)`, id, i+1, payers[i], amount, randomString(32)); err != nil {
				return fmt.Errorf("write share: %w", err)
			}
		}
		if _, err := t.Exec(c.ctx, `INSERT INTO guarantee (booking_id, seq, reference, provider_id, amount_cents, status)
			VALUES ($1, 1, $1, $2, $3, 'authorized')`, id, auth.ID, price.Total); err != nil {
			return fmt.Errorf("write guarantee: %w", err)
		}
		org, err := recipientOf(c.ctx, t, c.user.Username)
		if err != nil {
			return err
		}
		t.notify(a.heldNotices(org, slotRef{slot.Court, slot.Start}, expiresAt)...)
		return nil
	})
	if err != nil {
		return 0, nil, err
	}
	if lostGuarantee != 0 {
		if err := a.sendOwedVoid(c.ctx, lostGuarantee, auth.ID); err != nil {
			return 0, nil, err
		}
		return 0, nil, fail("SLOT_TAKEN")
	}
	return a.bookingAnswer(c.ctx, 201, id)
}

// slotFree reports whether nothing live overlaps the slot on its court.
func (a *app) slotFree(ctx context.Context, s slotRequest) (bool, error) {
	var free bool
	err := a.tx(ctx, func(t *txn) error {
		if err := a.freeStaleClaims(ctx, t, s.Court); err != nil {
			return err
		}
		return t.QueryRow(ctx, `SELECT NOT EXISTS (SELECT 1 FROM court_claim WHERE court = $1
			AND during && tstzrange($2::timestamptz, $2::timestamptz + make_interval(mins => $3)))`, s.Court, s.Start, s.Minutes).Scan(&free)
	})
	return free, err
}

// freeStaleClaims ends holds past their expiry and matches past their cut-off on a court.
func (a *app) freeStaleClaims(ctx context.Context, t *txn, court int) error {
	if err := a.releaseExpiredHolds(ctx, t, court); err != nil {
		return err
	}
	return a.cancelMatchesAtCutoff(ctx, t, court)
}

// claimSlot takes the court time for owner; the exclusion constraint decides every race.
func (a *app) claimSlot(ctx context.Context, t *txn, owner string, s slotRequest) (bool, error) {
	if err := a.freeStaleClaims(ctx, t, s.Court); err != nil {
		return false, err
	}
	sp, err := t.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("claim savepoint: %w", err)
	}
	_, err = sp.Exec(ctx, `INSERT INTO court_claim (owner, court, during)
		VALUES ($1, $2, tstzrange($3::timestamptz, $3::timestamptz + make_interval(mins => $4)))`, owner, s.Court, s.Start, s.Minutes)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23P01" {
		return false, sp.Rollback(ctx)
	}
	if err != nil {
		_ = sp.Rollback(ctx)
		return false, fmt.Errorf("claim court: %w", err)
	}
	return true, sp.Commit(ctx)
}

// releaseExpiredHolds releases every hold past its expiry, on one court or (court 0) all.
func (a *app) releaseExpiredHolds(ctx context.Context, t *txn, court int) error {
	rows, err := t.Query(ctx, `SELECT id FROM booking WHERE status = 'held' AND expires_at <= now()
		AND ($1 = 0 OR court = $1) ORDER BY id FOR UPDATE`, court)
	if err != nil {
		return fmt.Errorf("find expired holds: %w", err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return fmt.Errorf("find expired holds: %w", err)
	}
	for _, id := range ids {
		if err := a.releaseHold(ctx, t, id); err != nil {
			return err
		}
	}
	return nil
}

// releaseHold is the held to released transition.
func (a *app) releaseHold(ctx context.Context, t *txn, id string) error {
	var s slotRef
	var organiser string
	err := t.QueryRow(ctx, `UPDATE booking SET status = 'released' WHERE id = $1 AND status = 'held'
		RETURNING court, start_utc, organiser`, id).Scan(&s.Court, &s.Start, &organiser)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("release hold: %w", err)
	}
	if _, err := t.Exec(ctx, `UPDATE share SET status = 'void' WHERE booking_id = $1 AND status = 'due'`, id); err != nil {
		return fmt.Errorf("void shares: %w", err)
	}
	if _, err := t.Exec(ctx, `DELETE FROM court_claim WHERE owner = $1`, id); err != nil {
		return fmt.Errorf("free court: %w", err)
	}
	if err := closeFinishedGuarantees(ctx, t, &id); err != nil {
		return err
	}
	org, err := recipientOf(ctx, t, organiser)
	if err != nil {
		return err
	}
	t.notify(a.releasedNotices(org, s)...)
	return nil
}

// closeFinishedGuarantees owes a void on every live guarantee of a booking
// that is past its hold and has no co-player share due; bookingID nil means all bookings.
func closeFinishedGuarantees(ctx context.Context, q querier, bookingID *string) error {
	_, err := q.Exec(ctx, `UPDATE guarantee g SET status = 'voided', void_state = 'owed', void_next_at = now()
		FROM booking b WHERE b.id = g.booking_id AND g.status = 'authorized' AND b.status <> 'held'
			AND ($1::text IS NULL OR b.id = $1)
			AND NOT EXISTS (SELECT 1 FROM share s WHERE s.booking_id = b.id AND s.position > 1 AND s.status = 'due')`, bookingID)
	if err != nil {
		return fmt.Errorf("close guarantees: %w", err)
	}
	return nil
}

type guaranteeRow struct {
	ID         int64
	Seq        int
	ProviderID string
	Status     string
}

// currentGuarantee is the newest accepted authorisation of a booking.
func currentGuarantee(ctx context.Context, q querier, bookingID string) (guaranteeRow, error) {
	var g guaranteeRow
	err := q.QueryRow(ctx, `SELECT id, seq, provider_id, status FROM guarantee WHERE booking_id = $1
		ORDER BY seq DESC LIMIT 1`, bookingID).Scan(&g.ID, &g.Seq, &g.ProviderID, &g.Status)
	if err != nil {
		return g, fmt.Errorf("current guarantee: %w", err)
	}
	return g, nil
}

func addCredit(ctx context.Context, q querier, username string, amount int, reason string, bookingID, matchID *string) error {
	if _, err := q.Exec(ctx, `INSERT INTO credit (username, amount_cents, reason, booking_id, match_id)
		VALUES ($1, $2, $3, $4, $5)`, username, amount, reason, bookingID, matchID); err != nil {
		return fmt.Errorf("write credit: %w", err)
	}
	return nil
}

func (a *app) payBooking(c *call) (int, any, error) {
	b, err := loadBooking(c.ctx, a.db, pathID(c, "id"))
	if err != nil {
		return 0, nil, err
	}
	switch b.State {
	case "held":
	case "released":
		return 0, nil, fail("HOLD_EXPIRED")
	case "paid":
		return 0, nil, fail("ALREADY_PAID")
	default:
		return 0, nil, fail("INVALID_TRANSITION")
	}
	g, err := currentGuarantee(c.ctx, a.db, b.ID)
	if err != nil {
		return 0, nil, err
	}
	amount, reference, final := b.Total, b.ID, true
	if b.Split {
		amount, reference, final = b.Shares[0].Amount, b.ID+":1", false
	}
	res := a.courtpay.capture(c.ctx, g.ProviderID, amount, reference, final)
	if res.Outcome != payAccepted {
		return 0, nil, res.asError(false)
	}
	late := false
	err = a.tx(c.ctx, func(t *txn) error {
		var live bool
		if err := t.QueryRow(c.ctx, `SELECT status = 'held' AND expires_at > now() FROM booking WHERE id = $1 FOR UPDATE`,
			b.ID).Scan(&live); err != nil {
			return fmt.Errorf("lock booking: %w", err)
		}
		if final {
			if _, err := t.Exec(c.ctx, `UPDATE guarantee SET status = 'captured',
				void_state = CASE WHEN void_state = 'owed' THEN 'none' ELSE void_state END WHERE id = $1`, g.ID); err != nil {
				return fmt.Errorf("close guarantee: %w", err)
			}
		}
		org, err := recipientOf(c.ctx, t, b.Organiser.Username)
		if err != nil {
			return err
		}
		if !live {
			late = true
			if err := a.releaseHold(c.ctx, t, b.ID); err != nil {
				return err
			}
			if err := addCredit(c.ctx, t, org.Username, amount, "late_capture", &b.ID, nil); err != nil {
				return err
			}
			t.notify(a.creditedNotices(org, b.slot(), amount)...)
			return nil
		}
		if _, err := t.Exec(c.ctx, `UPDATE booking SET status = 'paid', paid_at = now() WHERE id = $1`, b.ID); err != nil {
			return fmt.Errorf("mark paid: %w", err)
		}
		if _, err := t.Exec(c.ctx, `UPDATE share SET status = 'paid', provider_id = $2 WHERE booking_id = $1 AND position = 1`,
			b.ID, res.ID); err != nil {
			return fmt.Errorf("mark share paid: %w", err)
		}
		t.notify(a.paidNotices(org, b.slot(), amount)...)
		for _, s := range b.Shares[1:] {
			r, err := recipientOf(c.ctx, t, s.Player.Username)
			if err != nil {
				return err
			}
			t.notify(a.shareNotice(r, b.slot(), s.Amount, b.Organiser.Name, *b.SettleAt, s.Token))
		}
		return nil
	})
	if err != nil {
		return 0, nil, err
	}
	if late {
		return 0, nil, fail("HOLD_EXPIRED")
	}
	return a.bookingAnswer(c.ctx, 200, b.ID)
}

func (a *app) releaseBooking(c *call) (int, any, error) {
	id := pathID(c, "id")
	released := false
	err := a.tx(c.ctx, func(t *txn) error {
		if err := t.QueryRow(c.ctx, `SELECT status = 'held' AND expires_at > now() FROM booking WHERE id = $1 FOR UPDATE`,
			id).Scan(&released); err != nil {
			return fmt.Errorf("lock booking: %w", err)
		}
		if !released {
			return nil
		}
		return a.releaseHold(c.ctx, t, id)
	})
	if err != nil {
		return 0, nil, err
	}
	if !released {
		return 0, nil, fail("INVALID_TRANSITION")
	}
	return a.bookingAnswer(c.ctx, 200, id)
}

type creditJSON struct {
	Username string `json:"username"`
	Amount   int    `json:"amount_cents"`
}

func (a *app) cancelBooking(c *call) (int, any, error) {
	id := pathID(c, "id")
	var fee, ruleVersion int
	credits := []creditJSON{}
	err := a.tx(c.ctx, func(t *txn) error {
		var status string
		var started bool
		var s slotRef
		var organiser string
		var matchID *string
		if _, err := t.Exec(c.ctx, `SELECT 1 FROM booking WHERE id = $1 FOR UPDATE`, id); err != nil {
			return fmt.Errorf("lock booking: %w", err)
		}
		if err := t.QueryRow(c.ctx, `SELECT state, start_utc <= now(), court, start_utc, organiser, match_id
			FROM booking_now WHERE id = $1`, id).Scan(&status, &started, &s.Court, &s.Start, &organiser, &matchID); err != nil {
			return fmt.Errorf("read booking: %w", err)
		}
		if status != "paid" {
			return fail("INVALID_TRANSITION")
		}
		if started {
			return fail("BOOKING_STARTED")
		}
		var percent int
		var now time.Time
		if err := t.QueryRow(c.ctx, `SELECT version, late_fee_percent, now() FROM cancellation_rule
			ORDER BY version DESC LIMIT 1`).Scan(&ruleVersion, &percent, &now); err != nil {
			return fmt.Errorf("read cancellation rule: %w", err)
		}
		if !now.After(a.cfg.freeCancelUntil(s.Start)) {
			percent = 0
		}
		rows, err := t.Query(c.ctx, `SELECT CASE WHEN status = 'covered' THEN $2 ELSE player END, sum(amount_cents)::int,
			min(position) FROM share WHERE booking_id = $1 AND status IN ('paid', 'covered')
			GROUP BY 1 ORDER BY 3`, id, organiser)
		if err != nil {
			return fmt.Errorf("read payers: %w", err)
		}
		type payer struct {
			username string
			paid     int
		}
		payers, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (payer, error) {
			var p payer
			var pos int
			err := r.Scan(&p.username, &p.paid, &pos)
			return p, err
		})
		if err != nil {
			return fmt.Errorf("read payers: %w", err)
		}
		for _, p := range payers {
			kept := lateFee(p.paid, percent)
			fee += kept
			credits = append(credits, creditJSON{Username: p.username, Amount: p.paid - kept})
			if err := addCredit(c.ctx, t, p.username, p.paid-kept, "booking_cancelled", &id, nil); err != nil {
				return err
			}
			r, err := recipientOf(c.ctx, t, p.username)
			if err != nil {
				return err
			}
			t.notify(a.refundedNotices(r, s, p.paid-kept)...)
		}
		if _, err := t.Exec(c.ctx, `UPDATE booking SET status = 'cancelled' WHERE id = $1`, id); err != nil {
			return fmt.Errorf("cancel booking: %w", err)
		}
		if _, err := t.Exec(c.ctx, `UPDATE share SET status = 'void' WHERE booking_id = $1 AND status = 'due'`, id); err != nil {
			return fmt.Errorf("void shares: %w", err)
		}
		if _, err := t.Exec(c.ctx, `DELETE FROM court_claim WHERE owner = $1 OR owner = $2`, id, matchID); err != nil {
			return fmt.Errorf("free court: %w", err)
		}
		return closeFinishedGuarantees(c.ctx, t, &id)
	})
	if err != nil {
		return 0, nil, err
	}
	b, err := loadBooking(c.ctx, a.db, id)
	if err != nil {
		return 0, nil, err
	}
	return 200, map[string]any{"booking": a.bookingBody(b), "fee_cents": fee, "credits": credits, "rule_version": ruleVersion}, nil
}
