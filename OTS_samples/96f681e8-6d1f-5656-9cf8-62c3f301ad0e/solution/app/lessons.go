package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

const maxWeeks = 8

// LessonView is the lesson body.
type LessonView struct {
	ID             string      `json:"id"`
	SeriesID       string      `json:"series_id"`
	CoachID        string      `json:"coach_id"`
	Court          int         `json:"court"`
	Start          string      `json:"start"`
	StartUTC       string      `json:"start_utc"`
	Minutes        int         `json:"minutes"`
	TotalCents     int         `json:"total_cents"`
	PricingVersion int         `json:"pricing_version"`
	Shares         []ShareView `json:"shares"`
}

type lessonRow struct {
	ID, SeriesID, CoachID string
	Court, Minutes        int
	Start                 time.Time
	TotalCents            int
	PricingVersion        int
}

const lessonColumns = "id, series_id, coach_id, court, start_utc, minutes, total_cents, pricing_version"

func scanLesson(row pgx.Row) (lessonRow, error) {
	var l lessonRow
	err := row.Scan(&l.ID, &l.SeriesID, &l.CoachID, &l.Court, &l.Start, &l.Minutes, &l.TotalCents, &l.PricingVersion)
	return l, err
}

func (a *App) lessonView(ctx context.Context, q querier, l lessonRow) (LessonView, error) {
	shares, err := loadShares(ctx, q, shareLesson, l.ID, false)
	if err != nil {
		return LessonView{}, err
	}
	view := LessonView{ID: l.ID, SeriesID: l.SeriesID, CoachID: l.CoachID, Court: l.Court, Start: a.clock.formatClub(l.Start),
		StartUTC: formatUTC(l.Start), Minutes: l.Minutes, TotalCents: l.TotalCents, PricingVersion: l.PricingVersion, Shares: []ShareView{}}
	for _, s := range shares {
		view.Shares = append(view.Shares, ShareView{Position: s.Position, Player: PersonRef{s.Username, s.Name}, AmountCents: s.Amount, Status: s.Status})
	}
	return view, nil
}

type lessonInput struct {
	court   int
	starts  []time.Time
	minutes int
	// students are the club players the block's cost is split among, in the order given.
	students []person
}

func (a *App) postLessons(ctx context.Context, rq *request) (result, error) {
	var body struct {
		CoachID  json.RawMessage `json:"coach_id"`
		Court    json.RawMessage `json:"court"`
		Start    json.RawMessage `json:"start"`
		Minutes  json.RawMessage `json:"minutes"`
		Weeks    json.RawMessage `json:"weeks"`
		Students json.RawMessage `json:"students"`
	}
	if err := decodeJSON(rq, &body); err != nil {
		return result{}, err
	}
	if coachID, valid := rawString(body.CoachID); !valid || rq.me.CoachID == nil || coachID != *rq.me.CoachID {
		return result{}, fail(codeNotYourCoachID)
	}
	now, err := dbNow(ctx, a.pool)
	if err != nil {
		return result{}, err
	}
	in, err := a.parseLesson(ctx, rq.me, body.Court, body.Start, body.Minutes, body.Weeks, body.Students, now)
	if err != nil {
		return result{}, err
	}
	items, seriesID, err := a.writeSeries(ctx, rq.me, in)
	if err != nil {
		return result{}, err
	}
	return created(map[string]any{"series_id": seriesID, "items": items}), nil
}

func (a *App) parseLesson(ctx context.Context, me *Identity, rawCourt, rawStart, rawMinutes, rawWeeks, rawStudents json.RawMessage, now time.Time) (lessonInput, error) {
	var in lessonInput
	problems := fieldErrors{}
	if court, valid := rawInt(rawCourt); valid && court >= 1 && court <= courtCount {
		in.court = court
	} else {
		problems["court"] = msgCourt
	}
	if minutes, valid := rawInt(rawMinutes); valid && allowedLength(minutes) {
		in.minutes = minutes
	} else {
		problems["minutes"] = msgMinutes
	}
	weeks := 1
	if !isAbsent(rawWeeks) {
		value, valid := rawInt(rawWeeks)
		if !valid || value < 1 || value > maxWeeks {
			problems["weeks"] = msgWeeks
		} else {
			weeks = value
		}
	}
	if emails, valid := rawStrings(rawStudents); valid && len(emails) >= 1 && len(emails) <= 4 {
		students, found, err := a.clubPlayersByEmail(ctx, me, emails)
		if err != nil {
			return lessonInput{}, err
		}
		if found {
			in.students = students
		} else {
			problems["students"] = msgStudents
		}
	} else {
		problems["students"] = msgStudents
	}
	if text, valid := rawString(rawStart); valid && in.minutes != 0 {
		first, ok := a.clock.slotStart(text, in.minutes)
		if !ok {
			problems["start"] = msgStart
		} else if starts, repeated := a.clock.weeklyRepeat(first, in.minutes, weeks); !repeated {
			problems["start"] = msgStart
		} else if !first.After(now) {
			problems["start"] = msgStartFuture
		} else {
			in.starts = starts
		}
	} else if !valid || problems["minutes"] == "" {
		problems["start"] = msgStart
	}
	if err := problems.err(); err != nil {
		return lessonInput{}, err
	}
	return in, nil
}

// writeSeries books every week or none: if any week overlaps a live hold, booking, match or lesson, nothing is written.
func (a *App) writeSeries(ctx context.Context, me *Identity, in lessonInput) ([]LessonView, string, error) {
	seriesID := newID("sr_")
	items := []LessonView{}
	err := withTx(ctx, a.pool, func(tx pgx.Tx) error {
		if err := lockCourt(ctx, tx, in.court); err != nil {
			return err
		}
		for _, start := range in.starts {
			taken, err := slotTaken(ctx, tx, in.court, start, slotEnd(start, in.minutes))
			if err != nil {
				return err
			}
			if taken {
				return fail(codeSlotTaken)
			}
		}
		for _, start := range in.starts {
			quote, err := a.quoteSlot(ctx, tx, in.court, start, in.minutes)
			if err != nil {
				return err
			}
			id := newID("ls_")
			if _, err := tx.Exec(ctx, `INSERT INTO lessons (id, series_id, coach_id, court, start_utc, minutes, total_cents, pricing_version)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, id, seriesID, *me.CoachID, in.court, start, in.minutes, quote.TotalCents, quote.PricingVersion); err != nil {
				return fmt.Errorf("insert lesson: %w", err)
			}
			amounts := splitEvenly(quote.TotalCents, len(in.students))
			notices := make([]notice, 0, len(in.students))
			for i, student := range in.students {
				token, err := insertShare(ctx, tx, shareLesson, id, i+1, student.Username, amounts[i], shareDue)
				if err != nil {
					return err
				}
				notices = append(notices, a.lessonShareNotice(student, slotRef{in.court, start}, amounts[i], me.Name, token))
			}
			if err := a.queueNotices(ctx, tx, notices); err != nil {
				return err
			}
			l, err := scanLesson(tx.QueryRow(ctx, "SELECT "+lessonColumns+" FROM lessons WHERE id = $1", id))
			if err != nil {
				return fmt.Errorf("read lesson: %w", err)
			}
			view, err := a.lessonView(ctx, tx, l)
			if err != nil {
				return err
			}
			items = append(items, view)
		}
		return nil
	})
	if err != nil {
		return nil, "", err
	}
	return items, seriesID, nil
}

func (a *App) getLessons(ctx context.Context, rq *request) (result, error) {
	coachID := rq.r.URL.Query().Get("coach_id")
	if rq.me.CoachID == nil || (coachID != "" && coachID != *rq.me.CoachID) {
		return result{}, fail(codeNotYourCoachID)
	}
	rows, err := a.pool.Query(ctx, "SELECT "+lessonColumns+" FROM lessons WHERE coach_id = $1 ORDER BY start_utc, court, id", *rq.me.CoachID)
	if err != nil {
		return result{}, fmt.Errorf("list lessons: %w", err)
	}
	var lessons []lessonRow
	for rows.Next() {
		l, err := scanLesson(rows)
		if err != nil {
			rows.Close()
			return result{}, fmt.Errorf("read lesson: %w", err)
		}
		lessons = append(lessons, l)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return result{}, fmt.Errorf("list lessons: %w", err)
	}
	items := []LessonView{}
	for _, l := range lessons {
		view, err := a.lessonView(ctx, a.pool, l)
		if err != nil {
			return result{}, err
		}
		items = append(items, view)
	}
	return ok(map[string]any{"items": items}), nil
}

func (a *App) getLesson(ctx context.Context, rq *request) (result, error) {
	l, err := scanLesson(a.pool.QueryRow(ctx, "SELECT "+lessonColumns+" FROM lessons WHERE id = $1", rq.r.PathValue("id")))
	if errors.Is(err, pgx.ErrNoRows) {
		return result{}, fail(codeNotFound)
	}
	if err != nil {
		return result{}, fmt.Errorf("load lesson: %w", err)
	}
	owns := rq.me.CoachID != nil && *rq.me.CoachID == l.CoachID
	if !owns && !rq.me.Roles[roleManager] {
		return result{}, fail(codeNotFound)
	}
	view, err := a.lessonView(ctx, a.pool, l)
	if err != nil {
		return result{}, err
	}
	return ok(view), nil
}
