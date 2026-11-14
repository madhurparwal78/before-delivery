package main

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

type lessonJSON struct {
	ID             string      `json:"id"`
	SeriesID       string      `json:"series_id"`
	CoachID        string      `json:"coach_id"`
	Court          int         `json:"court"`
	Start          string      `json:"start"`
	StartUTC       string      `json:"start_utc"`
	Minutes        int         `json:"minutes"`
	Total          int         `json:"total_cents"`
	PricingVersion int         `json:"pricing_version"`
	Shares         []shareJSON `json:"shares"`
}

// loadLessons reads lesson blocks matching a filter, by start.
func (a *app) loadLessons(ctx context.Context, q querier, where string, arg any) ([]lessonJSON, error) {
	rows, err := q.Query(ctx, `SELECT id, series_id, coach_id, court, start_utc, minutes, total_cents, pricing_version
		FROM lesson WHERE `+where+` ORDER BY start_utc, id`, arg)
	if err != nil {
		return nil, fmt.Errorf("read lessons: %w", err)
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (lessonJSON, error) {
		var l lessonJSON
		var start time.Time
		err := r.Scan(&l.ID, &l.SeriesID, &l.CoachID, &l.Court, &start, &l.Minutes, &l.Total, &l.PricingVersion)
		l.Start, l.StartUTC, l.Shares = a.cfg.clubOffsetTime(start), utcStamp(start), []shareJSON{}
		return l, err
	})
	if err != nil {
		return nil, fmt.Errorf("read lessons: %w", err)
	}
	for i := range list {
		rows, err := q.Query(ctx, `SELECT s.position, s.player, u.name, s.amount_cents, s.state FROM share_now s
			JOIN app_user u ON u.username = s.player WHERE s.lesson_id = $1 ORDER BY s.position`, list[i].ID)
		if err != nil {
			return nil, fmt.Errorf("read lesson shares: %w", err)
		}
		list[i].Shares, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (shareJSON, error) {
			var s shareJSON
			err := r.Scan(&s.Position, &s.Player.Username, &s.Player.Name, &s.Amount, &s.Status)
			return s, err
		})
		if err != nil {
			return nil, fmt.Errorf("read lesson shares: %w", err)
		}
	}
	return list, nil
}

func ownCoachID(u *identity, coachID string) bool {
	return u.CoachID != nil && *u.CoachID == coachID
}

func (a *app) createLessons(c *call) (int, any, error) {
	f, err := c.fields()
	if err != nil {
		return 0, nil, err
	}
	coachID, _ := f.stringField("coach_id")
	if !ownCoachID(c.user, coachID) {
		return 0, nil, fail("NOT_YOUR_COACH_ID")
	}
	now, err := dbNow(c.ctx, a.db)
	if err != nil {
		return 0, nil, err
	}
	errs := map[string]string{}
	first := a.parseSlot(f, now, errs)
	weeks := 1
	if f.has("weeks") {
		var ok bool
		if weeks, ok = f.intField("weeks"); !ok || weeks < 1 || weeks > 8 {
			errs["weeks"] = msgWeeks
		}
	}
	emails, ok := f.stringList("students")
	var students []string
	if !ok || len(emails) < 1 || len(emails) > 4 {
		errs["students"] = msgStudents
	} else {
		names, found, err := registeredPlayers(c.ctx, a.db, emails)
		if err != nil {
			return 0, nil, err
		}
		if !found || !distinct(names) {
			errs["students"] = msgStudents
		}
		students = names
	}
	var starts []time.Time
	if _, bad := errs["start"]; !bad {
		raw, _ := f.stringField("start")
		d, minute, _ := parseWallStart(raw)
		for w := 0; w < weeks && errs["weeks"] == ""; w++ {
			start, ok := a.cfg.weeklyRepeat(d, minute, w, first.Minutes)
			if !ok {
				errs["start"] = msgStart
				break
			}
			starts = append(starts, start)
		}
	}
	if len(errs) > 0 {
		return 0, nil, invalid(errs)
	}
	seriesID := newID("sr")
	var coachName string
	err = a.tx(c.ctx, func(t *txn) error {
		if err := t.QueryRow(c.ctx, `SELECT name FROM app_user WHERE coach_id = $1`, coachID).Scan(&coachName); err != nil {
			return fmt.Errorf("read coach: %w", err)
		}
		if _, err := t.Exec(c.ctx, `INSERT INTO lesson_series (id, coach_id) VALUES ($1, $2)`, seriesID, coachID); err != nil {
			return fmt.Errorf("write series: %w", err)
		}
		for _, start := range starts {
			id := newID("ls")
			won, err := a.claimSlot(c.ctx, t, id, slotRequest{Court: first.Court, Start: start, Minutes: first.Minutes})
			if err != nil {
				return err
			}
			if !won {
				return fail("SLOT_TAKEN")
			}
			price, err := a.cfg.priceFor(c.ctx, t, start, first.Minutes)
			if err != nil {
				return err
			}
			if _, err := t.Exec(c.ctx, `INSERT INTO lesson (id, series_id, coach_id, court, start_utc, minutes, total_cents, pricing_version)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, id, seriesID, coachID, first.Court, start, first.Minutes,
				price.Total, price.Version); err != nil {
				return fmt.Errorf("write lesson: %w", err)
			}
			for i, amount := range splitShares(price.Total, len(students)) {
				token := randomString(32)
				if _, err := t.Exec(c.ctx, `INSERT INTO share (lesson_id, position, player, amount_cents, status, token)
					VALUES ($1, $2, $3, $4, 'due', $5)`, id, i+1, students[i], amount, token); err != nil {
					return fmt.Errorf("write lesson share: %w", err)
				}
				r, err := recipientOf(c.ctx, t, students[i])
				if err != nil {
					return err
				}
				t.notify(a.lessonShareNotice(r, slotRef{first.Court, start}, amount, coachName, token))
			}
		}
		return nil
	})
	if err != nil {
		return 0, nil, err
	}
	items, err := a.loadLessons(c.ctx, a.db, "series_id = $1", seriesID)
	if err != nil {
		return 0, nil, err
	}
	return 201, map[string]any{"series_id": seriesID, "items": items}, nil
}

func (a *app) listLessons(c *call) (int, any, error) {
	coachID := c.r.URL.Query().Get("coach_id")
	if !ownCoachID(c.user, coachID) {
		return 0, nil, fail("NOT_YOUR_COACH_ID")
	}
	items, err := a.loadLessons(c.ctx, a.db, "coach_id = $1", coachID)
	if err != nil {
		return 0, nil, err
	}
	return 200, map[string]any{"items": items}, nil
}

func (a *app) lookupLesson(c *call) error {
	var coachID string
	err := a.db.QueryRow(c.ctx, `SELECT coach_id FROM lesson WHERE id = $1`, pathID(c, "id")).Scan(&coachID)
	if errors.Is(err, pgx.ErrNoRows) {
		return fail("NOT_FOUND")
	}
	if err != nil {
		return fmt.Errorf("read lesson: %w", err)
	}
	if !c.user.has("manager") && !ownCoachID(c.user, coachID) {
		return fail("NOT_FOUND")
	}
	return nil
}

func (a *app) getLesson(c *call) (int, any, error) {
	items, err := a.loadLessons(c.ctx, a.db, "id = $1", pathID(c, "id"))
	if err != nil {
		return 0, nil, err
	}
	return 200, items[0], nil
}
