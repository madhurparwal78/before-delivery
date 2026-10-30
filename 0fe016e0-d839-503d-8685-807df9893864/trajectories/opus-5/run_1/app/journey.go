package main

import (
	"context"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5"
)

var journeyCodes = []string{"WF-01", "WF-02", "WF-03", "WF-04"}

type journeyStepRecord struct {
	Name      string `json:"name"`
	AtMinutes int    `json:"at_minutes"`
}

// recordJourneyMarks keeps the steps of each journey's latest run.
func (a *app) recordJourneyMarks(ctx context.Context, marks []journeyMark, now int) {
	if len(marks) == 0 || !a.ready.Load() {
		return
	}
	stepCtx, cancel := withTimeout(context.WithoutCancel(ctx))
	defer cancel()
	tx, err := a.store.pool.Begin(stepCtx)
	if err != nil {
		return
	}
	defer tx.Rollback(stepCtx)
	for _, mark := range marks {
		for _, step := range mark.steps {
			if err := appendJourneyStep(stepCtx, tx, mark.journey, step, now); err != nil {
				return
			}
		}
	}
	tx.Commit(stepCtx)
}

func appendJourneyStep(ctx context.Context, tx pgx.Tx, journey string, step, now int) error {
	if err := takeLock(ctx, tx, journeyLockNamespace, journey); err != nil {
		return err
	}
	name := fmt.Sprintf("%s-%d", journey, step)
	if step == 1 {
		if _, err := tx.Exec(ctx, `DELETE FROM journey_step WHERE journey_code = $1`, journey); err != nil {
			return err
		}
	} else {
		var lastPosition int
		if err := tx.QueryRow(ctx,
			`SELECT coalesce(max(step_position), 0) FROM journey_step WHERE journey_code = $1`,
			journey).Scan(&lastPosition); err != nil {
			return err
		}
		if lastPosition != step-1 {
			return nil
		}
	}
	_, err := tx.Exec(ctx,
		`INSERT INTO journey_step (journey_code, step_position, step_name, at_minutes) VALUES ($1, $2, $3, $4)`,
		journey, step, name, now)
	return err
}

func (a *app) handleJourneyEvents(journey string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !a.ready.Load() {
			writeFailure(w, errDatabaseUnavailable)
			return
		}
		ctx, cancel := withTimeout(r.Context())
		defer cancel()
		rows, err := a.store.pool.Query(ctx,
			`SELECT step_name, at_minutes FROM journey_step WHERE journey_code = $1 ORDER BY step_position`,
			journey)
		if err != nil {
			writeFailure(w, errDatabaseUnavailable)
			return
		}
		defer rows.Close()
		trace := []journeyStepRecord{}
		for rows.Next() {
			var record journeyStepRecord
			if err := rows.Scan(&record.Name, &record.AtMinutes); err != nil {
				writeFailure(w, errDatabaseUnavailable)
				return
			}
			trace = append(trace, record)
		}
		if rows.Err() != nil {
			writeFailure(w, errDatabaseUnavailable)
			return
		}
		writeJSON(w, http.StatusOK, trace)
	}
}
