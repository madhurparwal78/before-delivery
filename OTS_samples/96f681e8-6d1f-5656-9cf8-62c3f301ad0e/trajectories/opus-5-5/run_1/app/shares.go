package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
)

type shareView struct {
	ID            int64
	Token         string
	Amount        int
	State         string
	Position      int
	Player        string
	BookingID     *string
	LessonID      *string
	Court         int
	Start         time.Time
	Minutes       int
	OrganiserName string
	SettleAt      *time.Time
	BookingState  *string
	BookingKind   *string
	Now           time.Time
}

func (s *shareView) slot() slotRef { return slotRef{Court: s.Court, Start: s.Start} }

func (s *shareView) reference() string {
	if s.LessonID != nil {
		return fmt.Sprintf("%s:%d", *s.LessonID, s.Position)
	}
	return fmt.Sprintf("%s:%d", *s.BookingID, s.Position)
}

// settled reports whether the share's settlement instant has been reached.
func (s *shareView) settled() bool { return s.SettleAt != nil && !s.Now.Before(*s.SettleAt) }

func loadShare(ctx context.Context, q querier, token string) (*shareView, error) {
	s := &shareView{}
	err := q.QueryRow(ctx, `SELECT s.id, s.token, s.amount_cents, s.state, s.position, s.player, s.booking_id, s.lesson_id,
		COALESCE(b.court, l.court), COALESCE(b.start_utc, l.start_utc), COALESCE(b.minutes, l.minutes),
		COALESCE(ou.name, cu.name, ''), b.settle_at, b.state, b.kind, now()
		FROM share_now s
		LEFT JOIN booking_now b ON b.id = s.booking_id
		LEFT JOIN app_user ou ON ou.username = b.organiser
		LEFT JOIN lesson l ON l.id = s.lesson_id
		LEFT JOIN app_user cu ON cu.coach_id = l.coach_id
		WHERE s.token = $1`, token).Scan(&s.ID, &s.Token, &s.Amount, &s.State, &s.Position, &s.Player, &s.BookingID,
		&s.LessonID, &s.Court, &s.Start, &s.Minutes, &s.OrganiserName, &s.SettleAt, &s.BookingState, &s.BookingKind, &s.Now)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load share: %w", err)
	}
	return s, nil
}

// payable reports whether a share is paid through its own link: a co-player
// share of a booking, or a lesson share.
func (s *shareView) payable() bool {
	return s.LessonID != nil || (s.BookingKind != nil && *s.BookingKind == "booking" && s.Position > 1)
}

func (a *app) lookupOwnShare(c *call) error {
	s, err := loadShare(c.ctx, a.db, pathID(c, "token"))
	if err != nil {
		return err
	}
	if s == nil || s.Player != c.user.Username || !s.payable() {
		return fail("NOT_FOUND")
	}
	return nil
}

func (a *app) shareBody(s *shareView) map[string]any {
	kind := "booking"
	var settle *string
	if s.LessonID != nil {
		kind = "lesson"
	} else if s.SettleAt != nil {
		v := utcStamp(*s.SettleAt)
		settle = &v
	}
	return map[string]any{
		"token": s.Token, "amount_cents": s.Amount, "status": s.State, "court": s.Court,
		"start": a.cfg.clubOffsetTime(s.Start), "start_utc": utcStamp(s.Start), "minutes": s.Minutes,
		"organiser_name": s.OrganiserName, "kind": kind, "settle_at": settle,
	}
}

func (a *app) getShare(c *call) (int, any, error) {
	s, err := loadShare(c.ctx, a.db, pathID(c, "token"))
	if err != nil {
		return 0, nil, err
	}
	return 200, a.shareBody(s), nil
}

// shareConflict is the answer for paying a share that is not due.
func shareConflict(s *shareView) *apiError {
	switch {
	case s.State == "paid":
		return fail("ALREADY_PAID")
	case s.State == "void":
		return fail("SHARE_VOID")
	case s.State == "covered", s.settled():
		return fail("SHARE_SETTLED")
	}
	return nil
}

func (a *app) payShare(c *call) (int, any, error) {
	token := pathID(c, "token")
	s, err := loadShare(c.ctx, a.db, token)
	if err != nil {
		return 0, nil, err
	}
	if conflict := shareConflict(s); conflict != nil {
		return 0, nil, conflict
	}
	res := a.courtpay.charge(c.ctx, s.Amount, s.reference(), c.user.Email)
	if res.Outcome != payAccepted {
		return 0, nil, res.asError(false)
	}
	var late *apiError
	err = a.tx(c.ctx, func(t *txn) error {
		if _, err := t.Exec(c.ctx, `SELECT 1 FROM share WHERE id = $1 FOR UPDATE`, s.ID); err != nil {
			return fmt.Errorf("lock share: %w", err)
		}
		now, err := loadShare(c.ctx, t, token)
		if err != nil {
			return err
		}
		payer, err := recipientOf(c.ctx, t, s.Player)
		if err != nil {
			return err
		}
		if late = shareConflict(now); late != nil {
			if err := addCredit(c.ctx, t, s.Player, s.Amount, "late_capture", s.BookingID, nil); err != nil {
				return err
			}
			if now.BookingState != nil && *now.BookingState == "cancelled" {
				t.notify(a.refundedNotices(payer, s.slot(), s.Amount)...)
			} else {
				t.notify(a.creditedNotices(payer, s.slot(), s.Amount)...)
			}
			return nil
		}
		if _, err := t.Exec(c.ctx, `UPDATE share SET status = 'paid', provider_id = $2 WHERE id = $1`, s.ID, res.ID); err != nil {
			return fmt.Errorf("mark share paid: %w", err)
		}
		t.notify(a.paidNotices(payer, s.slot(), s.Amount)...)
		if s.BookingID != nil {
			return closeFinishedGuarantees(c.ctx, t, s.BookingID)
		}
		return nil
	})
	if err != nil {
		return 0, nil, err
	}
	if late != nil {
		return 0, nil, late
	}
	s, err = loadShare(c.ctx, a.db, token)
	if err != nil {
		return 0, nil, err
	}
	return 200, a.shareBody(s), nil
}

// sendOwedVoid sends one owed void; it is marked sent only on a 2xx answer.
func (a *app) sendOwedVoid(ctx context.Context, guaranteeID int64, providerID string) error {
	if !a.courtpay.void(ctx, providerID) {
		return nil
	}
	if _, err := a.db.Exec(ctx, `UPDATE guarantee SET void_state = 'sent' WHERE id = $1 AND void_state = 'owed'`, guaranteeID); err != nil {
		return fmt.Errorf("record void: %w", err)
	}
	return nil
}

// sendOwedVoids sends every owed void that is due, leasing each for 30 seconds.
func (a *app) sendOwedVoids(ctx context.Context) error {
	rows, err := a.db.Query(ctx, `UPDATE guarantee SET void_next_at = now() + interval '30 seconds'
		WHERE id IN (SELECT id FROM guarantee WHERE void_state = 'owed' AND void_next_at <= now()
			ORDER BY void_next_at LIMIT 50 FOR UPDATE SKIP LOCKED)
		RETURNING id, provider_id`)
	if err != nil {
		return fmt.Errorf("lease owed voids: %w", err)
	}
	type owed struct {
		id       int64
		provider string
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (owed, error) {
		var o owed
		err := r.Scan(&o.id, &o.provider)
		return o, err
	})
	if err != nil {
		return fmt.Errorf("lease owed voids: %w", err)
	}
	for _, o := range list {
		if err := a.sendOwedVoid(ctx, o.id, o.provider); err != nil {
			return err
		}
	}
	return nil
}

// voidSharesAtStart voids co-player shares still due once their booking starts.
func (a *app) voidSharesAtStart(ctx context.Context) error {
	return a.tx(ctx, func(t *txn) error {
		rows, err := t.Query(ctx, `UPDATE share s SET status = 'void' FROM booking b
			WHERE s.booking_id = b.id AND s.status = 'due' AND b.status <> 'held' AND b.start_utc <= now()
			RETURNING b.id`)
		if err != nil {
			return fmt.Errorf("void shares at start: %w", err)
		}
		ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return fmt.Errorf("void shares at start: %w", err)
		}
		seen := map[string]bool{}
		for _, id := range ids {
			if seen[id] {
				continue
			}
			seen[id] = true
			if err := a.noticeCoveredIfDone(ctx, t, id); err != nil {
				return err
			}
		}
		return closeFinishedGuarantees(ctx, t, nil)
	})
}

// noticeCoveredIfDone queues the shares-covered notices once no co-player share is due.
func (a *app) noticeCoveredIfDone(ctx context.Context, t *txn, bookingID string) error {
	var organiser string
	var covered, count int
	var s slotRef
	err := t.QueryRow(ctx, `UPDATE booking b SET covered_noticed = true
		WHERE b.id = $1 AND NOT b.covered_noticed
			AND NOT EXISTS (SELECT 1 FROM share WHERE booking_id = b.id AND position > 1 AND status = 'due')
			AND EXISTS (SELECT 1 FROM share WHERE booking_id = b.id AND status = 'covered')
		RETURNING organiser, court, start_utc,
			(SELECT sum(amount_cents)::int FROM share WHERE booking_id = b.id AND status = 'covered'),
			(SELECT count(*)::int FROM share WHERE booking_id = b.id AND status = 'covered')`, bookingID).
		Scan(&organiser, &s.Court, &s.Start, &covered, &count)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("covered notices: %w", err)
	}
	r, err := recipientOf(ctx, t, organiser)
	if err != nil {
		return err
	}
	t.notify(a.coveredNotices(r, s, covered, count)...)
	return nil
}

// settleShares captures still-due co-player shares from the organiser's guarantee after the settlement instant.
func (a *app) settleShares(ctx context.Context) error {
	rows, err := a.db.Query(ctx, `SELECT b.id FROM booking b WHERE b.kind = 'booking' AND b.split AND b.status IN ('paid', 'checked-in')
		AND b.settle_at <= now() AND b.start_utc > now() AND (b.settle_next_at IS NULL OR b.settle_next_at <= now())
		AND EXISTS (SELECT 1 FROM share s WHERE s.booking_id = b.id AND s.position > 1 AND s.status = 'due')`)
	if err != nil {
		return fmt.Errorf("find settlements: %w", err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return fmt.Errorf("find settlements: %w", err)
	}
	for _, id := range ids {
		for {
			more, err := a.settleNextShare(ctx, id)
			if err != nil {
				log.Printf("settle %s: %v", id, err)
			}
			if !more || err != nil {
				break
			}
		}
	}
	return nil
}

type dueShare struct {
	id       int64
	position int
	amount   int
}

// settleNextShare captures the lowest-position due share; only the last due share's capture is final.
func (a *app) settleNextShare(ctx context.Context, bookingID string) (bool, error) {
	var due []dueShare
	var g guaranteeRow
	err := a.tx(ctx, func(t *txn) error {
		if _, err := t.Exec(ctx, `UPDATE booking SET settle_next_at = now() + interval '30 seconds' WHERE id = $1`, bookingID); err != nil {
			return fmt.Errorf("lease settlement: %w", err)
		}
		rows, err := t.Query(ctx, `SELECT id, position, amount_cents FROM share WHERE booking_id = $1 AND position > 1
			AND status = 'due' ORDER BY position`, bookingID)
		if err != nil {
			return fmt.Errorf("read due shares: %w", err)
		}
		due, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (dueShare, error) {
			var d dueShare
			err := r.Scan(&d.id, &d.position, &d.amount)
			return d, err
		})
		if err != nil {
			return fmt.Errorf("read due shares: %w", err)
		}
		g, err = currentGuarantee(ctx, t, bookingID)
		return err
	})
	if err != nil || len(due) == 0 || g.Status != "authorized" {
		return false, err
	}
	next, final := due[0], len(due) == 1
	res := a.courtpay.capture(ctx, g.ProviderID, next.amount, fmt.Sprintf("%s:%d", bookingID, next.position), final)
	if res.Outcome != payAccepted {
		return false, nil
	}
	err = a.tx(ctx, func(t *txn) error {
		var organiser string
		var s slotRef
		var stillDue bool
		if err := t.QueryRow(ctx, `SELECT b.organiser, b.court, b.start_utc, s.status = 'due' AND b.status IN ('paid', 'checked-in')
			FROM booking b JOIN share s ON s.booking_id = b.id WHERE s.id = $1 FOR UPDATE`, next.id).
			Scan(&organiser, &s.Court, &s.Start, &stillDue); err != nil {
			return fmt.Errorf("lock settlement: %w", err)
		}
		if final {
			if _, err := t.Exec(ctx, `UPDATE guarantee SET status = 'captured',
				void_state = CASE WHEN void_state = 'owed' THEN 'none' ELSE void_state END WHERE id = $1`, g.ID); err != nil {
				return fmt.Errorf("close guarantee: %w", err)
			}
		}
		if stillDue {
			if _, err := t.Exec(ctx, `UPDATE share SET status = 'covered', provider_id = $2 WHERE id = $1`, next.id, res.ID); err != nil {
				return fmt.Errorf("cover share: %w", err)
			}
		} else {
			if err := addCredit(ctx, t, organiser, next.amount, "late_capture", &bookingID, nil); err != nil {
				return err
			}
			r, err := recipientOf(ctx, t, organiser)
			if err != nil {
				return err
			}
			t.notify(a.creditedNotices(r, s, next.amount)...)
		}
		if _, err := t.Exec(ctx, `UPDATE booking SET settle_next_at = NULL WHERE id = $1`, bookingID); err != nil {
			return fmt.Errorf("clear settlement lease: %w", err)
		}
		if err := a.noticeCoveredIfDone(ctx, t, bookingID); err != nil {
			return err
		}
		return closeFinishedGuarantees(ctx, t, &bookingID)
	})
	return err == nil && !final, err
}

// refreshGuarantees re-authorises the due co-player shares before the current guarantee lapses.
func (a *app) refreshGuarantees(ctx context.Context) error {
	rows, err := a.db.Query(ctx, `SELECT b.id FROM booking b
		JOIN LATERAL (SELECT status, authorized_at FROM guarantee WHERE booking_id = b.id ORDER BY seq DESC LIMIT 1) g ON true
		WHERE b.kind = 'booking' AND b.split AND b.status IN ('paid', 'checked-in') AND b.start_utc > now()
			AND g.status = 'authorized' AND g.authorized_at + make_interval(secs => $1) <= now()
			AND (b.refresh_next_at IS NULL OR b.refresh_next_at <= now())
			AND EXISTS (SELECT 1 FROM share s WHERE s.booking_id = b.id AND s.position > 1 AND s.status = 'due')`,
		a.cfg.AuthRefreshSecs)
	if err != nil {
		return fmt.Errorf("find refreshes: %w", err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return fmt.Errorf("find refreshes: %w", err)
	}
	for _, id := range ids {
		if err := a.refreshGuarantee(ctx, id); err != nil {
			log.Printf("refresh %s: %v", id, err)
		}
	}
	return nil
}

func (a *app) refreshGuarantee(ctx context.Context, bookingID string) error {
	var amount, seq int
	var payer string
	err := a.tx(ctx, func(t *txn) error {
		return t.QueryRow(ctx, `UPDATE booking b SET refresh_next_at = now() + interval '30 seconds' WHERE b.id = $1
			RETURNING (SELECT COALESCE(sum(amount_cents), 0)::int FROM share WHERE booking_id = b.id AND position > 1 AND status = 'due'),
				(SELECT max(seq) FROM guarantee WHERE booking_id = b.id) + 1,
				(SELECT email FROM app_user WHERE username = b.organiser)`, bookingID).Scan(&amount, &seq, &payer)
	})
	if err != nil {
		return fmt.Errorf("lease refresh: %w", err)
	}
	reference := fmt.Sprintf("%s:g%d", bookingID, seq)
	res := a.courtpay.authorize(ctx, amount, reference, payer)
	if res.Outcome != payAccepted {
		return nil
	}
	return a.tx(ctx, func(t *txn) error {
		if _, err := t.Exec(ctx, `INSERT INTO guarantee (booking_id, seq, reference, provider_id, amount_cents, status)
			VALUES ($1, $2, $3, $4, $5, 'authorized')`, bookingID, seq, reference, res.ID, amount); err != nil {
			return fmt.Errorf("write refreshed guarantee: %w", err)
		}
		if _, err := t.Exec(ctx, `UPDATE guarantee SET status = 'superseded', void_state = 'owed', void_next_at = now()
			WHERE booking_id = $1 AND seq < $2 AND status = 'authorized'`, bookingID, seq); err != nil {
			return fmt.Errorf("supersede guarantee: %w", err)
		}
		if _, err := t.Exec(ctx, `UPDATE booking SET refresh_next_at = NULL WHERE id = $1`, bookingID); err != nil {
			return fmt.Errorf("clear refresh lease: %w", err)
		}
		return closeFinishedGuarantees(ctx, t, &bookingID)
	})
}
