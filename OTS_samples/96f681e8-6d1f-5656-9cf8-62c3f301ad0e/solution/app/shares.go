package main

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// ShareCard is the share answer: what the payer sees at their link.
type ShareCard struct {
	Token         string  `json:"token"`
	AmountCents   int     `json:"amount_cents"`
	Status        string  `json:"status"`
	Court         int     `json:"court"`
	Start         string  `json:"start"`
	StartUTC      string  `json:"start_utc"`
	Minutes       int     `json:"minutes"`
	OrganiserName string  `json:"organiser_name"`
	Kind          string  `json:"kind"`
	SettleAt      *string `json:"settle_at"`
}

// shareContext is what a share is paid for: a booking or a lesson block.
type shareContext struct {
	court     int
	start     time.Time
	minutes   int
	organiser person
}

func loadShareByToken(ctx context.Context, q querier, token string) (shareRow, error) {
	var s shareRow
	err := q.QueryRow(ctx, `SELECT s.token, s.owner_kind, s.owner_id, s.position, s.username, p.name, p.email, s.amount_cents, s.status
		FROM shares s JOIN people p ON p.username = s.username WHERE s.token = $1`, token).
		Scan(&s.Token, &s.OwnerKind, &s.OwnerID, &s.Position, &s.Username, &s.Name, &s.Email, &s.Amount, &s.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return shareRow{}, fail(codeNotFound)
	}
	if err != nil {
		return shareRow{}, fmt.Errorf("load share: %w", err)
	}
	return s, nil
}

func (a *App) loadShareContext(ctx context.Context, q querier, s shareRow) (shareContext, error) {
	if s.OwnerKind == shareLesson {
		var c shareContext
		err := q.QueryRow(ctx, `SELECT l.court, l.start_utc, l.minutes, p.username, p.name, p.email FROM lessons l
			JOIN people p ON p.coach_id = l.coach_id WHERE l.id = $1`, s.OwnerID).
			Scan(&c.court, &c.start, &c.minutes, &c.organiser.Username, &c.organiser.Name, &c.organiser.Email)
		if err != nil {
			return shareContext{}, fmt.Errorf("load lesson of share: %w", err)
		}
		return c, nil
	}
	b, err := loadBooking(ctx, q, s.OwnerID, false)
	if err != nil {
		return shareContext{}, err
	}
	organiser, err := loadPerson(ctx, q, b.Organiser)
	if err != nil {
		return shareContext{}, err
	}
	return shareContext{court: b.Court, start: b.Start, minutes: b.Minutes, organiser: organiser}, nil
}

// ownShare loads a share only its payer may read; anyone else gets the unknown-token 404.
func (a *App) ownShare(ctx context.Context, rq *request) (shareRow, error) {
	s, err := loadShareByToken(ctx, a.pool, rq.r.PathValue("token"))
	if err != nil {
		return shareRow{}, err
	}
	if s.Username != rq.me.Username {
		return shareRow{}, fail(codeNotFound)
	}
	return s, nil
}

func (a *App) shareCard(ctx context.Context, q querier, s shareRow, now time.Time) (ShareCard, error) {
	c, err := a.loadShareContext(ctx, q, s)
	if err != nil {
		return ShareCard{}, err
	}
	card := ShareCard{Token: s.Token, AmountCents: s.Amount, Status: s.Status, Kind: s.OwnerKind, Court: c.court,
		Start: a.clock.formatClub(c.start), StartUTC: formatUTC(c.start), Minutes: c.minutes, OrganiserName: c.organiser.Name}
	if s.OwnerKind == shareBooking {
		b, err := loadBooking(ctx, q, s.OwnerID, false)
		if err != nil {
			return ShareCard{}, err
		}
		card.Status = effectiveShareStatus(s.Status, effectiveBookingStatus(b.Status, b.ExpiresAt, now), b.Start, now)
		card.SettleAt = optionalUTC(b.SettleAt)
	}
	return card, nil
}

func (a *App) getShare(ctx context.Context, rq *request) (result, error) {
	s, err := a.ownShare(ctx, rq)
	if err != nil {
		return result{}, err
	}
	now, err := dbNow(ctx, a.pool)
	if err != nil {
		return result{}, err
	}
	card, err := a.shareCard(ctx, a.pool, s, now)
	if err != nil {
		return result{}, err
	}
	return ok(card), nil
}

// sharePayConflict is the one place a share payment's state conflicts are decided; none of them calls the provider.
func sharePayConflict(s shareRow, b *bookingRow, now time.Time) *apiError {
	status := s.Status
	if b != nil {
		status = effectiveShareStatus(s.Status, effectiveBookingStatus(b.Status, b.ExpiresAt, now), b.Start, now)
	}
	switch status {
	case sharePaid:
		return fail(codeAlreadyPaid)
	case shareVoid:
		return fail(codeShareVoid)
	case shareCovered:
		return fail(codeShareSettled)
	}
	if b != nil && b.SettleAt != nil && !b.SettleAt.After(now) {
		return fail(codeShareSettled)
	}
	if b != nil && b.Status == bookingHeld {
		return fail(codeInvalidTransition)
	}
	return nil
}

func (a *App) postSharePay(ctx context.Context, rq *request) (result, error) {
	s, err := a.ownShare(ctx, rq)
	if err != nil {
		return result{}, err
	}
	return a.withIdempotency(ctx, rq, func() (result, error) {
		now, err := dbNow(ctx, a.pool)
		if err != nil {
			return result{}, err
		}
		var booking *bookingRow
		if s.OwnerKind == shareBooking {
			b, err := loadBooking(ctx, a.pool, s.OwnerID, false)
			if err != nil {
				return result{}, err
			}
			booking = &b
		}
		fresh, err := loadShareByToken(ctx, a.pool, s.Token)
		if err != nil {
			return result{}, err
		}
		if conflict := sharePayConflict(fresh, booking, now); conflict != nil {
			return result{}, conflict
		}
		answer := a.courtpay.charge(ctx, s.Amount, fmt.Sprintf("%s:%d", s.OwnerID, s.Position), rq.me.Email)
		if answer.outcome != providerAccepted {
			return result{}, paymentFailure(answer, false)
		}
		return a.recordSharePayment(ctx, rq.me, s, answer.id)
	})
}

// recordSharePayment writes a captured share charge. A charge that lands after the share stopped being due becomes a
// late_capture credit and the answer says why the share was not paid.
func (a *App) recordSharePayment(ctx context.Context, me *Identity, s shareRow, captureID string) (result, error) {
	var res result
	var late *apiError
	err := withTx(ctx, a.pool, func(tx pgx.Tx) error {
		var booking *bookingRow
		if s.OwnerKind == shareBooking {
			b, err := loadBooking(ctx, tx, s.OwnerID, true)
			if err != nil {
				return err
			}
			booking = &b
		}
		fresh, err := loadShareByToken(ctx, tx, s.Token)
		if err != nil {
			return err
		}
		now, err := dbNow(ctx, tx)
		if err != nil {
			return err
		}
		c, err := a.loadShareContext(ctx, tx, s)
		if err != nil {
			return err
		}
		if conflict := sharePayConflict(fresh, booking, now); conflict != nil {
			late = conflict
			cancelled := booking != nil && booking.Status == bookingCancelled
			id := s.OwnerID
			return a.creditLateCapture(ctx, tx, me.asPerson(), s.Amount, slotRef{c.court, c.start}, &id, nil, cancelled)
		}
		if _, err := tx.Exec(ctx, "UPDATE shares SET status = $2, provider_id = $3 WHERE token = $1", s.Token, sharePaid, captureID); err != nil {
			return fmt.Errorf("mark share paid: %w", err)
		}
		if err := a.queueNotices(ctx, tx, a.paidNotices(me.asPerson(), slotRef{c.court, c.start}, s.Amount)); err != nil {
			return err
		}
		if booking != nil {
			if err := a.afterShareChange(ctx, tx, *booking); err != nil {
				return err
			}
		}
		fresh.Status = sharePaid
		card, err := a.shareCard(ctx, tx, fresh, now)
		if err != nil {
			return err
		}
		res = ok(card)
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

// voidDueShares makes void every share of a booking that is still due.
func voidDueShares(ctx context.Context, q querier, bookingID string) error {
	if _, err := q.Exec(ctx, "UPDATE shares SET status = $3 WHERE owner_kind = $1 AND owner_id = $2 AND status = $4",
		shareBooking, bookingID, shareVoid, shareDue); err != nil {
		return fmt.Errorf("void shares of %s: %w", bookingID, err)
	}
	return nil
}

// afterShareChange runs once a co-player share of a booking has stopped being due: when none is due any more, the
// organiser gets the shares-covered notices (once per booking) and every live guarantee is voided.
func (a *App) afterShareChange(ctx context.Context, tx pgx.Tx, b bookingRow) error {
	shares, err := loadShares(ctx, tx, shareBooking, b.ID, true)
	if err != nil {
		return err
	}
	coveredCents, covered := 0, 0
	for _, s := range shares[1:] {
		switch s.Status {
		case shareDue:
			return nil
		case shareCovered:
			coveredCents += s.Amount
			covered++
		}
	}
	if covered > 0 && !b.CoveredNotified {
		if _, err := tx.Exec(ctx, "UPDATE bookings SET covered_notified = true WHERE id = $1", b.ID); err != nil {
			return fmt.Errorf("mark covered notified: %w", err)
		}
		organiser, err := loadPerson(ctx, tx, b.Organiser)
		if err != nil {
			return err
		}
		if err := a.queueNotices(ctx, tx, a.coveredNotices(organiser, slotRef{b.Court, b.Start}, coveredCents, covered)); err != nil {
			return err
		}
	}
	return endGuarantees(ctx, tx, b.ID)
}

// settleNextShare covers one due co-player share of a paid split booking from the organiser's current guarantee,
// once the settlement instant has passed. Shares are captured one at a time in position order: only the lowest
// due position of a booking is ever claimed, so a share whose capture failed blocks the ones after it, and only the
// capture of the highest due position is final. It reports whether a share was due.
func (a *App) settleNextShare(ctx context.Context) (bool, error) {
	var token, ownerID string
	var position, amount int
	var final bool
	err := a.pool.QueryRow(ctx, `UPDATE shares SET settle_next_at = clock_timestamp() + $1::interval
		WHERE token = (SELECT s.token FROM shares s JOIN bookings b ON b.id = s.owner_id AND s.owner_kind = $2
			WHERE s.status = $3 AND s.position > 1 AND b.status = $4 AND b.kind = $5 AND b.split
				AND b.settle_at <= clock_timestamp() AND b.start_utc > clock_timestamp()
				AND (s.settle_next_at IS NULL OR s.settle_next_at <= clock_timestamp())
				AND NOT EXISTS (SELECT 1 FROM shares e WHERE e.owner_kind = s.owner_kind AND e.owner_id = s.owner_id
					AND e.position > 1 AND e.position < s.position AND e.status = $3)
			ORDER BY b.settle_at, s.token LIMIT 1 FOR UPDATE OF s SKIP LOCKED)
		RETURNING token, owner_id, position, amount_cents,
			NOT EXISTS (SELECT 1 FROM shares h WHERE h.owner_kind = shares.owner_kind AND h.owner_id = shares.owner_id
				AND h.position > shares.position AND h.status = $3)`,
		retryInterval(), shareBooking, shareDue, bookingPaid, kindBooking).Scan(&token, &ownerID, &position, &amount, &final)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("claim share to settle: %w", err)
	}
	guarantee, err := currentGuarantee(ctx, a.pool, ownerID)
	if err != nil {
		return true, err
	}
	answer := a.courtpay.capture(ctx, guarantee.ProviderID, amount, fmt.Sprintf("%s:%d", ownerID, position), final)
	if answer.outcome != providerAccepted {
		return true, nil
	}
	return true, a.recordCovered(ctx, token, ownerID, amount, answer.id, finalCapture(final, guarantee))
}

// finalCapture names the guarantee an accepted capture closed, or none when the capture was not final.
func finalCapture(final bool, g guaranteeRow) *guaranteeRow {
	if !final {
		return nil
	}
	return &g
}

// recordCovered writes an accepted settlement capture. A final capture turns its guarantee captured, which owes no void.
func (a *App) recordCovered(ctx context.Context, token, ownerID string, amount int, captureID string, closed *guaranteeRow) error {
	return withTx(ctx, a.pool, func(tx pgx.Tx) error {
		b, err := loadBooking(ctx, tx, ownerID, true)
		if err != nil {
			return err
		}
		if closed != nil {
			if _, err := tx.Exec(ctx, "UPDATE guarantees SET status = $3 WHERE booking_id = $1 AND provider_id = $2 AND status = $4",
				ownerID, closed.ProviderID, guaranteeCaptured, guaranteeAuthorized); err != nil {
				return fmt.Errorf("close guarantee by final capture: %w", err)
			}
		}
		s, err := loadShareByToken(ctx, tx, token)
		if err != nil {
			return err
		}
		if s.Status != shareDue || b.Status != bookingPaid {
			organiser, err := loadPerson(ctx, tx, b.Organiser)
			if err != nil {
				return err
			}
			return a.creditLateCapture(ctx, tx, organiser, amount, slotRef{b.Court, b.Start}, &b.ID, nil, b.Status == bookingCancelled)
		}
		if _, err := tx.Exec(ctx, "UPDATE shares SET status = $2, provider_id = $3 WHERE token = $1", token, shareCovered, captureID); err != nil {
			return fmt.Errorf("mark share covered: %w", err)
		}
		return a.afterShareChange(ctx, tx, b)
	})
}

// voidStartedShares makes void every share still due on a booking that has started, then ends the guarantees.
func (a *App) voidStartedShares(ctx context.Context) error {
	rows, err := a.pool.Query(ctx, `SELECT DISTINCT b.id FROM bookings b JOIN shares s ON s.owner_kind = $1 AND s.owner_id = b.id
		WHERE b.kind = $2 AND b.status IN `+bookedStatusesSQL+` AND b.start_utc <= clock_timestamp() AND s.status = $3`,
		shareBooking, kindBooking, shareDue)
	if err != nil {
		return fmt.Errorf("find started bookings with due shares: %w", err)
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return fmt.Errorf("read started booking: %w", err)
		}
		ids = append(ids, id)
	}
	rows.Close()
	for _, id := range ids {
		err := withTx(ctx, a.pool, func(tx pgx.Tx) error {
			b, err := loadBooking(ctx, tx, id, true)
			if err != nil {
				return err
			}
			if err := voidDueShares(ctx, tx, id); err != nil {
				return err
			}
			return a.afterShareChange(ctx, tx, b)
		})
		if err != nil {
			return err
		}
	}
	return nil
}
