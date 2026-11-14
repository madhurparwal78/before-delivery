package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// bookingRow is a booking as stored.
type bookingRow struct {
	ID              string
	Kind            string
	Court           int
	Start           time.Time
	Minutes         int
	Note            string
	TotalCents      int
	Organiser       string
	Status          string
	CreatedAt       time.Time
	ExpiresAt       *time.Time
	SettleAt        *time.Time
	PricingVersion  int
	MatchID         *string
	Split           bool
	CoveredNotified bool
}

const bookingColumns = "id, kind, court, start_utc, minutes, note, total_cents, organiser, status, created_at, expires_at, settle_at, pricing_version, match_id, split, covered_notified"

func scanBooking(row pgx.Row) (bookingRow, error) {
	var b bookingRow
	err := row.Scan(&b.ID, &b.Kind, &b.Court, &b.Start, &b.Minutes, &b.Note, &b.TotalCents, &b.Organiser, &b.Status,
		&b.CreatedAt, &b.ExpiresAt, &b.SettleAt, &b.PricingVersion, &b.MatchID, &b.Split, &b.CoveredNotified)
	return b, err
}

// loadBooking reads a booking, locking its row when asked. An unknown id is a 404.
func loadBooking(ctx context.Context, q querier, id string, lock bool) (bookingRow, error) {
	query := "SELECT " + bookingColumns + " FROM bookings WHERE id = $1"
	if lock {
		query += " FOR UPDATE"
	}
	b, err := scanBooking(q.QueryRow(ctx, query, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return bookingRow{}, fail(codeNotFound)
	}
	if err != nil {
		return bookingRow{}, fmt.Errorf("load booking %s: %w", id, err)
	}
	return b, nil
}

// shareRow is a share as stored, with its payer's name.
type shareRow struct {
	Token     string
	OwnerKind string
	OwnerID   string
	Position  int
	Username  string
	Name      string
	Email     string
	Amount    int
	Status    string
}

func loadShares(ctx context.Context, q querier, ownerKind, ownerID string, lock bool) ([]shareRow, error) {
	query := `SELECT s.token, s.owner_kind, s.owner_id, s.position, s.username, p.name, p.email, s.amount_cents, s.status
		FROM shares s JOIN people p ON p.username = s.username WHERE s.owner_kind = $1 AND s.owner_id = $2 ORDER BY s.position`
	if lock {
		query += " FOR UPDATE OF s"
	}
	rows, err := q.Query(ctx, query, ownerKind, ownerID)
	if err != nil {
		return nil, fmt.Errorf("load shares of %s: %w", ownerID, err)
	}
	defer rows.Close()
	var shares []shareRow
	for rows.Next() {
		var s shareRow
		if err := rows.Scan(&s.Token, &s.OwnerKind, &s.OwnerID, &s.Position, &s.Username, &s.Name, &s.Email, &s.Amount, &s.Status); err != nil {
			return nil, fmt.Errorf("read share: %w", err)
		}
		shares = append(shares, s)
	}
	return shares, rows.Err()
}

// insertShare writes a share and returns the token of its pay-your-share link.
func insertShare(ctx context.Context, q querier, ownerKind, ownerID string, position int, username string, amount int, status string) (string, error) {
	token := newToken()
	if _, err := q.Exec(ctx, "INSERT INTO shares (token, owner_kind, owner_id, position, username, amount_cents, status) VALUES ($1, $2, $3, $4, $5, $6, $7)",
		token, ownerKind, ownerID, position, username, amount, status); err != nil {
		return "", fmt.Errorf("insert share %s:%d: %w", ownerID, position, err)
	}
	return token, nil
}

// PersonRef names a person in a body.
type PersonRef struct {
	Username string `json:"username"`
	Name     string `json:"name"`
}

// ShareView is a share in a body.
type ShareView struct {
	Position    int       `json:"position"`
	Player      PersonRef `json:"player"`
	AmountCents int       `json:"amount_cents"`
	Status      string    `json:"status"`
}

// BookingView is the booking body.
type BookingView struct {
	ID          string      `json:"id"`
	Kind        string      `json:"kind"`
	Status      string      `json:"status"`
	Court       int         `json:"court"`
	Start       string      `json:"start"`
	StartUTC    string      `json:"start_utc"`
	Minutes     int         `json:"minutes"`
	Note        string      `json:"note"`
	TotalCents  int         `json:"total_cents"`
	Organiser   PersonRef   `json:"organiser"`
	Shares      []ShareView `json:"shares"`
	SettleAt    *string     `json:"settle_at"`
	CreatedAt   string      `json:"created_at"`
	ExpiresAt   *string     `json:"expires_at"`
	RemainingMs *int64      `json:"remaining_ms"`
	ServerNow   string      `json:"server_now"`
}

func optionalUTC(t *time.Time) *string {
	if t == nil {
		return nil
	}
	text := formatUTC(*t)
	return &text
}

// bookingView builds the booking body as it reads at now.
func (a *App) bookingView(ctx context.Context, q querier, b bookingRow, now time.Time) (BookingView, error) {
	shares, err := loadShares(ctx, q, shareBooking, b.ID, false)
	if err != nil {
		return BookingView{}, err
	}
	status := effectiveBookingStatus(b.Status, b.ExpiresAt, now)
	view := BookingView{ID: b.ID, Kind: b.Kind, Status: status, Court: b.Court, Start: a.clock.formatClub(b.Start),
		StartUTC: formatUTC(b.Start), Minutes: b.Minutes, Note: b.Note, TotalCents: b.TotalCents,
		SettleAt: optionalUTC(b.SettleAt), CreatedAt: formatUTC(b.CreatedAt), ExpiresAt: optionalUTC(b.ExpiresAt),
		ServerNow: formatUTC(now), Shares: []ShareView{}}
	for _, s := range shares {
		view.Shares = append(view.Shares, ShareView{Position: s.Position, Player: PersonRef{s.Username, s.Name},
			AmountCents: s.Amount, Status: effectiveShareStatus(s.Status, status, b.Start, now)})
		if s.Position == 1 {
			view.Organiser = PersonRef{s.Username, s.Name}
		}
	}
	if status == bookingHeld && b.ExpiresAt != nil {
		remaining := max(b.ExpiresAt.Sub(now).Milliseconds(), 0)
		view.RemainingMs = &remaining
	}
	return view, nil
}

// canSee is true for the organiser and the manager.
func (b bookingRow) canSee(me *Identity) bool {
	return b.Organiser == me.Username || me.Roles[roleManager]
}

// ---- holds ----

type holdInput struct {
	court     int
	start     time.Time
	minutes   int
	note      string
	coPlayers []person
}

func (a *App) parseHold(ctx context.Context, rq *request, now time.Time) (holdInput, error) {
	var body struct {
		Court     json.RawMessage `json:"court"`
		Start     json.RawMessage `json:"start"`
		Minutes   json.RawMessage `json:"minutes"`
		Note      json.RawMessage `json:"note"`
		CoPlayers json.RawMessage `json:"co_players"`
	}
	if err := decodeJSON(rq, &body); err != nil {
		return holdInput{}, err
	}
	var in holdInput
	problems := fieldErrors{}
	if court, valid := rawInt(body.Court); valid && court >= 1 && court <= courtCount {
		in.court = court
	} else {
		problems["court"] = msgCourt
	}
	minutes, minutesOK := rawInt(body.Minutes)
	if minutesOK && allowedLength(minutes) {
		in.minutes = minutes
	} else {
		problems["minutes"] = msgMinutes
		minutes = defaultMinutes
	}
	if text, valid := rawString(body.Start); !valid {
		problems["start"] = msgStart
	} else if start, ok := a.clock.slotStart(text, minutes); !ok {
		problems["start"] = msgStart
	} else if !start.After(now) {
		problems["start"] = msgStartFuture
	} else {
		in.start = start
	}
	if !isAbsent(body.Note) {
		if note, valid := rawString(body.Note); valid && withinRunes(note, maxNoteRunes) {
			in.note = note
		} else {
			problems["note"] = msgNote
		}
	}
	if !isAbsent(body.CoPlayers) {
		emails, valid := rawStrings(body.CoPlayers)
		if valid && len(emails) > 0 {
			players, found, err := a.clubPlayersByEmail(ctx, rq.me, emails)
			if err != nil {
				return holdInput{}, err
			}
			if found && len(players) == coPlayersPerSplit {
				in.coPlayers = players
			} else {
				problems["co_players"] = msgCoPlayers
			}
		} else if !valid {
			problems["co_players"] = msgCoPlayers
		}
	}
	if len(in.coPlayers) > 0 && !in.start.IsZero() && !a.settleAt(in.start).After(now) {
		problems["co_players"] = msgSplitLate
	}
	if err := problems.err(); err != nil {
		return holdInput{}, err
	}
	return in, nil
}

// slotRef names a slot in notices and cards.
type slotRef struct {
	court int
	start time.Time
}

func (a *App) postHold(ctx context.Context, rq *request) (result, error) {
	return a.withIdempotency(ctx, rq, func() (result, error) {
		now, err := dbNow(ctx, a.pool)
		if err != nil {
			return result{}, err
		}
		in, err := a.parseHold(ctx, rq, now)
		if err != nil {
			return result{}, err
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
		id := newID("bk_")
		answer := a.courtpay.authorize(ctx, quote.TotalCents, id, rq.me.Email)
		if answer.outcome != providerAccepted {
			return result{}, paymentFailure(answer, true)
		}
		view, err := a.writeHold(ctx, rq.me, id, in, quote, answer.id)
		if err != nil {
			return result{}, err
		}
		return created(view), nil
	})
}

// writeHold records an accepted guarantee as a held booking. The court's advisory lock lets the database decide
// a race; the loser owes a void of its authorisation, sent before the 409 answer.
func (a *App) writeHold(ctx context.Context, me *Identity, id string, in holdInput, quote Quote, authorizationID string) (BookingView, error) {
	var view BookingView
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
		if taken {
			lost = true
			return nil
		}
		now, err := dbNow(ctx, tx)
		if err != nil {
			return err
		}
		split := len(in.coPlayers) > 0
		var settle *time.Time
		if split {
			at := a.settleAt(in.start)
			settle = &at
		}
		expires := a.holdExpiry(now)
		if _, err := tx.Exec(ctx, `INSERT INTO bookings (id, kind, court, start_utc, minutes, note, total_cents, organiser, status, created_at, expires_at, settle_at, pricing_version, split)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
			id, kindBooking, in.court, in.start, in.minutes, in.note, quote.TotalCents, me.Username, bookingHeld, now, expires,
			settle, quote.PricingVersion, split); err != nil {
			return fmt.Errorf("insert hold: %w", err)
		}
		amounts := []int{quote.TotalCents}
		if split {
			amounts = quote.SplitCents
		}
		if _, err := insertShare(ctx, tx, shareBooking, id, 1, me.Username, amounts[0], shareDue); err != nil {
			return err
		}
		for i, co := range in.coPlayers {
			if _, err := insertShare(ctx, tx, shareBooking, id, i+2, co.Username, amounts[i+1], shareDue); err != nil {
				return err
			}
		}
		if err := recordGuarantee(ctx, tx, id, 1, authorizationID, quote.TotalCents, now); err != nil {
			return err
		}
		slot := slotRef{in.court, in.start}
		if err := a.queueNotices(ctx, tx, a.heldNotices(me.asPerson(), slot, expires)); err != nil {
			return err
		}
		b, err := loadBooking(ctx, tx, id, false)
		if err != nil {
			return err
		}
		view, err = a.bookingView(ctx, tx, b, now)
		return err
	})
	if err != nil {
		return BookingView{}, err
	}
	if lost {
		if err := a.voidLostAuthorization(ctx, authorizationID); err != nil {
			return BookingView{}, err
		}
		return BookingView{}, fail(codeSlotTaken)
	}
	return view, nil
}

// ---- reading ----

func (a *App) getBooking(ctx context.Context, rq *request) (result, error) {
	b, err := loadBooking(ctx, a.pool, rq.r.PathValue("id"), false)
	if err != nil {
		return result{}, err
	}
	if !b.canSee(rq.me) {
		return result{}, fail(codeNotFound)
	}
	now, err := dbNow(ctx, a.pool)
	if err != nil {
		return result{}, err
	}
	view, err := a.bookingView(ctx, a.pool, b, now)
	if err != nil {
		return result{}, err
	}
	return ok(view), nil
}

// ownBooking loads a booking only its organiser may act on; anyone else gets the unknown-id 404.
func (a *App) ownBooking(ctx context.Context, rq *request) (bookingRow, error) {
	b, err := loadBooking(ctx, a.pool, rq.r.PathValue("id"), false)
	if err != nil {
		return bookingRow{}, err
	}
	if b.Organiser != rq.me.Username {
		return bookingRow{}, fail(codeNotFound)
	}
	return b, nil
}

// ---- paying ----

// payConflict is the one place a pay request's state conflicts are decided.
func payConflict(b bookingRow, now time.Time) *apiError {
	switch effectiveBookingStatus(b.Status, b.ExpiresAt, now) {
	case bookingHeld:
		return nil
	case bookingReleased:
		return fail(codeHoldExpired)
	case bookingPaid:
		return fail(codeAlreadyPaid)
	default:
		return fail(codeInvalidTransition)
	}
}

func (a *App) postPay(ctx context.Context, rq *request) (result, error) {
	b, err := a.ownBooking(ctx, rq)
	if err != nil {
		return result{}, err
	}
	return a.withIdempotency(ctx, rq, func() (result, error) {
		now, err := dbNow(ctx, a.pool)
		if err != nil {
			return result{}, err
		}
		if conflict := payConflict(b, now); conflict != nil {
			return result{}, conflict
		}
		guarantee, err := currentGuarantee(ctx, a.pool, b.ID)
		if err != nil {
			return result{}, err
		}
		shares, err := loadShares(ctx, a.pool, shareBooking, b.ID, false)
		if err != nil {
			return result{}, err
		}
		// An unsplit booking's capture is final and closes its authorisation; a split booking's first share is not,
		// so the rest of the guarantee stays authorised for the co-players' shares.
		amount, reference, final := b.TotalCents, b.ID, true
		if b.Split {
			amount, reference, final = shares[0].Amount, fmt.Sprintf("%s:1", b.ID), false
		}
		answer := a.courtpay.capture(ctx, guarantee.ProviderID, amount, reference, final)
		if answer.outcome != providerAccepted {
			return result{}, paymentFailure(answer, false)
		}
		return a.recordPayment(ctx, rq.me, b.ID, amount, answer.id)
	})
}

// recordPayment writes the organiser's captured amount. When the hold ended while the provider was answering,
// the booking stays released and the captured amount becomes a late_capture credit.
func (a *App) recordPayment(ctx context.Context, me *Identity, id string, amount int, captureID string) (result, error) {
	var res result
	var late *apiError
	err := withTx(ctx, a.pool, func(tx pgx.Tx) error {
		b, err := loadBooking(ctx, tx, id, true)
		if err != nil {
			return err
		}
		now, err := dbNow(ctx, tx)
		if err != nil {
			return err
		}
		if conflict := payConflict(b, now); conflict != nil {
			late = conflict
			if b.Status == bookingHeld {
				if err := a.releaseHold(ctx, tx, b); err != nil {
					return err
				}
			}
			return a.creditLateCapture(ctx, tx, me.asPerson(), amount, slotRef{b.Court, b.Start}, &b.ID, nil, false)
		}
		shares, err := loadShares(ctx, tx, shareBooking, id, true)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "UPDATE bookings SET status = $2 WHERE id = $1", id, bookingPaid); err != nil {
			return fmt.Errorf("mark booking paid: %w", err)
		}
		if _, err := tx.Exec(ctx, "UPDATE shares SET status = $3, provider_id = $4 WHERE owner_kind = $1 AND owner_id = $2 AND position = 1",
			shareBooking, id, sharePaid, captureID); err != nil {
			return fmt.Errorf("mark organiser share paid: %w", err)
		}
		slot := slotRef{b.Court, b.Start}
		notices := a.paidNotices(me.asPerson(), slot, amount)
		if b.Split {
			for _, s := range shares[1:] {
				notices = append(notices, a.shareNotice(person{s.Username, s.Name, s.Email}, me.Name, slot, s.Amount, *b.SettleAt, s.Token))
			}
		} else if _, err := tx.Exec(ctx, "UPDATE guarantees SET status = $2 WHERE booking_id = $1 AND status = $3",
			id, guaranteeCaptured, guaranteeAuthorized); err != nil {
			return fmt.Errorf("use up authorisation: %w", err)
		}
		if err := a.queueNotices(ctx, tx, notices); err != nil {
			return err
		}
		b.Status = bookingPaid
		view, err := a.bookingView(ctx, tx, b, now)
		if err != nil {
			return err
		}
		res = ok(view)
		return nil
	})
	if err != nil {
		return result{}, err
	}
	if late != nil {
		return result{}, late
	}
	return res, nil
}

// ---- releasing ----

// releaseHold is the one place a held booking becomes released: its shares go void, its authorisation is
// owed a void and the released notices are queued.
func (a *App) releaseHold(ctx context.Context, tx pgx.Tx, b bookingRow) error {
	if _, err := tx.Exec(ctx, "UPDATE bookings SET status = $2 WHERE id = $1", b.ID, bookingReleased); err != nil {
		return fmt.Errorf("release hold %s: %w", b.ID, err)
	}
	if err := voidDueShares(ctx, tx, b.ID); err != nil {
		return err
	}
	if err := endGuarantees(ctx, tx, b.ID); err != nil {
		return err
	}
	organiser, err := loadPerson(ctx, tx, b.Organiser)
	if err != nil {
		return err
	}
	return a.queueNotices(ctx, tx, a.releasedNotices(organiser, slotRef{b.Court, b.Start}))
}

func (a *App) postRelease(ctx context.Context, rq *request) (result, error) {
	b, err := a.ownBooking(ctx, rq)
	if err != nil {
		return result{}, err
	}
	var view BookingView
	err = withTx(ctx, a.pool, func(tx pgx.Tx) error {
		locked, err := loadBooking(ctx, tx, b.ID, true)
		if err != nil {
			return err
		}
		now, err := dbNow(ctx, tx)
		if err != nil {
			return err
		}
		if effectiveBookingStatus(locked.Status, locked.ExpiresAt, now) != bookingHeld {
			return fail(codeInvalidTransition)
		}
		if err := a.releaseHold(ctx, tx, locked); err != nil {
			return err
		}
		locked.Status = bookingReleased
		view, err = a.bookingView(ctx, tx, locked, now)
		return err
	})
	if err != nil {
		return result{}, err
	}
	return ok(view), nil
}

// ---- cancelling ----

// CancelledBooking is the answer to a cancel.
type CancelledBooking struct {
	Booking     BookingView    `json:"booking"`
	FeeCents    int            `json:"fee_cents"`
	Credits     []CreditAmount `json:"credits"`
	RuleVersion int            `json:"rule_version"`
}

// CreditAmount is what one payer is credited.
type CreditAmount struct {
	Username    string `json:"username"`
	AmountCents int    `json:"amount_cents"`
}

func (a *App) postCancel(ctx context.Context, rq *request) (result, error) {
	b, err := a.ownBooking(ctx, rq)
	if err != nil {
		return result{}, err
	}
	var out CancelledBooking
	err = withTx(ctx, a.pool, func(tx pgx.Tx) error {
		locked, err := loadBooking(ctx, tx, b.ID, true)
		if err != nil {
			return err
		}
		now, err := dbNow(ctx, tx)
		if err != nil {
			return err
		}
		if locked.Status != bookingPaid {
			return fail(codeInvalidTransition)
		}
		if !locked.Start.After(now) {
			return fail(codeBookingStarted)
		}
		out, err = a.cancelPaidBooking(ctx, tx, locked, now)
		return err
	})
	if err != nil {
		return result{}, err
	}
	return ok(out), nil
}

// cancelPaidBooking is the one place a paid booking becomes cancelled: each payer is credited in full up to and
// including the free-cancellation cut-off, and less the late fee from the next millisecond. Covered shares count
// as paid by the organiser.
func (a *App) cancelPaidBooking(ctx context.Context, tx pgx.Tx, b bookingRow, now time.Time) (CancelledBooking, error) {
	shares, err := loadShares(ctx, tx, shareBooking, b.ID, true)
	if err != nil {
		return CancelledBooking{}, err
	}
	rule, err := latestRule(ctx, tx)
	if err != nil {
		return CancelledBooking{}, err
	}
	percent := 0
	if now.After(a.freeCancelUntil(b.Start)) {
		percent = rule.LateFeePercent
	}
	if _, err := tx.Exec(ctx, "UPDATE bookings SET status = $2 WHERE id = $1", b.ID, bookingCancelled); err != nil {
		return CancelledBooking{}, fmt.Errorf("cancel booking: %w", err)
	}
	if err := voidDueShares(ctx, tx, b.ID); err != nil {
		return CancelledBooking{}, err
	}
	if err := endGuarantees(ctx, tx, b.ID); err != nil {
		return CancelledBooking{}, err
	}
	out := CancelledBooking{Credits: []CreditAmount{}, RuleVersion: rule.Version}
	slot := slotRef{b.Court, b.Start}
	for _, payer := range paidByPayer(shares, b.Organiser) {
		fee := lateFee(payer.paid, percent)
		out.FeeCents += fee
		if payer.paid-fee <= 0 {
			continue
		}
		credit := CreditAmount{payer.username, payer.paid - fee}
		out.Credits = append(out.Credits, credit)
		if err := a.writeCredit(ctx, tx, credit, creditBookingCancelled, &b.ID, nil); err != nil {
			return CancelledBooking{}, err
		}
		person, err := loadPerson(ctx, tx, payer.username)
		if err != nil {
			return CancelledBooking{}, err
		}
		if err := a.queueNotices(ctx, tx, a.creditNotices(eventRefunded, person, slot, credit.AmountCents)); err != nil {
			return CancelledBooking{}, err
		}
	}
	b.Status = bookingCancelled
	out.Booking, err = a.bookingView(ctx, tx, b, now)
	return out, err
}

type payerPaid struct {
	username string
	paid     int
}

// paidByPayer totals what each payer paid, in share order; covered shares count as paid by the organiser.
func paidByPayer(shares []shareRow, organiser string) []payerPaid {
	var payers []payerPaid
	add := func(username string, amount int) {
		for i := range payers {
			if payers[i].username == username {
				payers[i].paid += amount
				return
			}
		}
		payers = append(payers, payerPaid{username, amount})
	}
	for _, s := range shares {
		switch s.Status {
		case sharePaid:
			add(s.Username, s.Amount)
		case shareCovered:
			add(organiser, s.Amount)
		}
	}
	return payers
}
