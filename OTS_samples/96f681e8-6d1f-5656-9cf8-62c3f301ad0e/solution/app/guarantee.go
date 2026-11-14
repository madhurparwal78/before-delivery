package main

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// guaranteeRow is one authorisation of the organiser's card.
type guaranteeRow struct {
	ProviderID string
}

func recordGuarantee(ctx context.Context, q querier, bookingID string, sequence int, providerID string, amount int, at time.Time) error {
	if _, err := q.Exec(ctx, `INSERT INTO guarantees (booking_id, sequence, provider_id, amount_cents, status, authorized_at)
		VALUES ($1, $2, $3, $4, $5, $6)`, bookingID, sequence, providerID, amount, guaranteeAuthorized, at); err != nil {
		return fmt.Errorf("record guarantee %s:g%d: %w", bookingID, sequence, err)
	}
	return nil
}

func currentGuarantee(ctx context.Context, q querier, bookingID string) (guaranteeRow, error) {
	var g guaranteeRow
	err := q.QueryRow(ctx, "SELECT provider_id FROM guarantees WHERE booking_id = $1 AND status = $2",
		bookingID, guaranteeAuthorized).Scan(&g.ProviderID)
	if err != nil {
		return guaranteeRow{}, fmt.Errorf("current guarantee of %s: %w", bookingID, err)
	}
	return g, nil
}

// endGuarantees voids every live guarantee of a booking: each authorisation still held is owed a void.
func endGuarantees(ctx context.Context, q querier, bookingID string) error {
	rows, err := q.Query(ctx, "UPDATE guarantees SET status = $2 WHERE booking_id = $1 AND status = $3 RETURNING provider_id",
		bookingID, guaranteeVoided, guaranteeAuthorized)
	if err != nil {
		return fmt.Errorf("end guarantees of %s: %w", bookingID, err)
	}
	var owed []string
	for rows.Next() {
		var providerID string
		if err := rows.Scan(&providerID); err != nil {
			rows.Close()
			return fmt.Errorf("read ended guarantee: %w", err)
		}
		owed = append(owed, providerID)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("end guarantees of %s: %w", bookingID, err)
	}
	for _, providerID := range owed {
		if _, err := oweVoid(ctx, q, providerID, 0); err != nil {
			return err
		}
	}
	return nil
}

// oweVoid records a void the club owes the provider, first due after the given delay.
func oweVoid(ctx context.Context, q querier, providerID string, delay time.Duration) (int64, error) {
	var id int64
	err := q.QueryRow(ctx, "INSERT INTO owed_voids (provider_id, next_attempt_at) VALUES ($1, clock_timestamp() + $2::interval) RETURNING id",
		providerID, fmt.Sprintf("%d milliseconds", delay.Milliseconds())).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("record owed void of %s: %w", providerID, err)
	}
	return id, nil
}

// voidLostAuthorization voids the authorisation of a hold that lost its slot, before the 409 answer goes out.
// If the provider does not accept it, the void stays owed and is retried.
func (a *App) voidLostAuthorization(ctx context.Context, providerID string) error {
	id, err := oweVoid(ctx, a.pool, providerID, retryEvery)
	if err != nil {
		return err
	}
	return a.sendVoid(ctx, id)
}

// sendVoid sends one owed void that is not yet accepted, pushing its next attempt out first so no other sender
// takes it. Each authorisation gets at most one accepted void.
func (a *App) sendVoid(ctx context.Context, id int64) error {
	var providerID string
	err := a.pool.QueryRow(ctx, `UPDATE owed_voids SET attempts = attempts + 1, next_attempt_at = clock_timestamp() + $2::interval
		WHERE id = $1 AND done_at IS NULL RETURNING provider_id`, id, retryInterval()).Scan(&providerID)
	if err != nil {
		return fmt.Errorf("claim owed void %d: %w", id, err)
	}
	return a.finishVoid(ctx, id, providerID)
}

func retryInterval() string { return fmt.Sprintf("%d seconds", int(retryEvery.Seconds())) }

func (a *App) finishVoid(ctx context.Context, id int64, providerID string) error {
	if !a.courtpay.void(ctx, providerID) {
		return nil
	}
	if _, err := a.pool.Exec(ctx, "UPDATE owed_voids SET done_at = clock_timestamp() WHERE id = $1", id); err != nil {
		return fmt.Errorf("record accepted void %d: %w", id, err)
	}
	return nil
}

// sendNextOwedVoid sends the next void that is due; it reports whether there was one.
func (a *App) sendNextOwedVoid(ctx context.Context) (bool, error) {
	var id int64
	var providerID string
	err := a.pool.QueryRow(ctx, `UPDATE owed_voids SET attempts = attempts + 1, next_attempt_at = clock_timestamp() + $1::interval
		WHERE id = (SELECT id FROM owed_voids WHERE done_at IS NULL AND next_attempt_at <= clock_timestamp()
			ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id, provider_id`, retryInterval()).Scan(&id, &providerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("claim next owed void: %w", err)
	}
	return true, a.finishVoid(ctx, id, providerID)
}

// refreshNextGuarantee re-authorises, for one paid split booking whose guarantee is due to lapse, the sum of its
// due co-player shares. The previous guarantee is voided only after the new one is accepted. It reports whether
// a booking was due.
func (a *App) refreshNextGuarantee(ctx context.Context) (bool, error) {
	var bookingID, organiserEmail string
	var sequence, dueCents int
	err := a.pool.QueryRow(ctx, `UPDATE bookings SET refresh_next_at = clock_timestamp() + $2::interval
		WHERE id = (SELECT b.id FROM bookings b JOIN guarantees g ON g.booking_id = b.id AND g.status = $3
			WHERE b.status = $4 AND b.kind = $5 AND b.split AND b.start_utc > clock_timestamp()
				AND g.authorized_at + make_interval(secs => $1) <= clock_timestamp()
				AND (b.refresh_next_at IS NULL OR b.refresh_next_at <= clock_timestamp())
				AND EXISTS (SELECT 1 FROM shares s WHERE s.owner_kind = $6 AND s.owner_id = b.id AND s.position > 1 AND s.status = $7)
			ORDER BY g.authorized_at LIMIT 1 FOR UPDATE OF b SKIP LOCKED)
		RETURNING id, (SELECT email FROM people WHERE username = organiser),
			(SELECT max(sequence) FROM guarantees WHERE booking_id = bookings.id),
			(SELECT COALESCE(sum(amount_cents), 0) FROM shares s WHERE s.owner_kind = $6 AND s.owner_id = bookings.id AND s.position > 1 AND s.status = $7)`,
		a.cfg.Timing.AuthRefreshSeconds, retryInterval(), guaranteeAuthorized, bookingPaid, kindBooking, shareBooking, shareDue).
		Scan(&bookingID, &organiserEmail, &sequence, &dueCents)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("claim guarantee refresh: %w", err)
	}
	next := sequence + 1
	answer := a.courtpay.authorize(ctx, dueCents, fmt.Sprintf("%s:g%d", bookingID, next), organiserEmail)
	if answer.outcome != providerAccepted {
		return true, nil
	}
	return true, withTx(ctx, a.pool, func(tx pgx.Tx) error {
		b, err := loadBooking(ctx, tx, bookingID, true)
		if err != nil {
			return err
		}
		now, err := dbNow(ctx, tx)
		if err != nil {
			return err
		}
		if b.Status != bookingPaid {
			if _, err := oweVoid(ctx, tx, answer.id, 0); err != nil {
				return err
			}
			return nil
		}
		var previous string
		err = tx.QueryRow(ctx, "UPDATE guarantees SET status = $3 WHERE booking_id = $1 AND status = $2 RETURNING provider_id",
			bookingID, guaranteeAuthorized, guaranteeSuperseded).Scan(&previous)
		if errors.Is(err, pgx.ErrNoRows) {
			// A final settlement capture closed the guarantee while this refresh was out: nothing is left to guarantee.
			_, err = oweVoid(ctx, tx, answer.id, 0)
			return err
		}
		if err != nil {
			return fmt.Errorf("supersede guarantee: %w", err)
		}
		if _, err := oweVoid(ctx, tx, previous, 0); err != nil {
			return err
		}
		if err := recordGuarantee(ctx, tx, bookingID, next, answer.id, dueCents, now); err != nil {
			return err
		}
		return a.afterShareChange(ctx, tx, b)
	})
}
