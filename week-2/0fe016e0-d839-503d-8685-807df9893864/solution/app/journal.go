package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"reflect"
	"strconv"
)

// storedResponse is an idempotency record found for a key.
type storedResponse struct {
	route    string
	sameBody bool
	status   int
	body     []byte
}

// lookupIdempotencyKey serialises every request carrying the key, then reads its record.
// Bodies are compared as parsed JSON; a body that is not valid JSON never equals a stored one.
func lookupIdempotencyKey(ctx context.Context, tx *sql.Tx, key string, raw []byte) (*storedResponse, error) {
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock($1, hashtext($2))`, lockIdempotencyKey, key); err != nil {
		return nil, err
	}
	var stored storedResponse
	var storedBody, body string
	err := tx.QueryRowContext(ctx, `SELECT route, request_body::text, response_status, response_body FROM idempotency_record WHERE idempotency_key = $1`, key).
		Scan(&stored.route, &storedBody, &stored.status, &body)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var storedValue, requestValue any
	json.Unmarshal([]byte(storedBody), &storedValue)
	stored.sameBody = json.Unmarshal(raw, &requestValue) == nil && reflect.DeepEqual(storedValue, requestValue)
	stored.body = []byte(body)
	return &stored, nil
}

func storeIdempotencyKey(ctx context.Context, tx *sql.Tx, key, route string, raw []byte, status int, payload []byte) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO idempotency_record (idempotency_key, route, request_body, response_status, response_body) VALUES ($1, $2, $3::jsonb, $4, $5)`,
		key, route, string(raw), status, string(payload))
	return err
}

// recordJourneySteps appends trace steps. Step 1 starts a new run of its journey; a later step
// is appended only when the previous step is the last one recorded.
func recordJourneySteps(ctx context.Context, tx *sql.Tx, steps []string) error {
	if len(steps) == 0 {
		return nil
	}
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock($1, 0)`, lockJourneyTrace); err != nil {
		return err
	}
	now := currentMinute()
	for _, step := range steps {
		journey := step[:5]
		number, _ := strconv.Atoi(step[6:])
		if number == 1 {
			if _, err := tx.ExecContext(ctx, `DELETE FROM journey_step WHERE journey_code = $1`, journey); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO journey_step (journey_code, step_number, step_name, at_minutes)
			SELECT $1, $2, $3, $4
			WHERE $2 = 1 OR (SELECT max(step_number) FROM journey_step WHERE journey_code = $1) = $2 - 1
			ON CONFLICT DO NOTHING`, journey, number, step, now); err != nil {
			return err
		}
	}
	return nil
}

// recordJourneyStepsAlone records steps outside a request's own transaction: for reads, and
// for the refusals whose journey step the brief records although the refusal writes nothing.
func (a *App) recordJourneyStepsAlone(ctx context.Context, steps []string) error {
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := recordJourneySteps(ctx, tx, steps); err != nil {
		return err
	}
	return tx.Commit()
}

// JourneyStep is one entry of a journey trace.
type JourneyStep struct {
	Name      string `json:"name"`
	AtMinutes int    `json:"at_minutes"`
}

func (a *App) journeyTrace(journey string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		a.respondList(w, r, func(ctx context.Context, tx *sql.Tx) (any, error) {
			rows, err := tx.QueryContext(ctx, `SELECT step_name, at_minutes FROM journey_step WHERE journey_code = $1 ORDER BY step_number`, journey)
			if err != nil {
				return nil, err
			}
			defer rows.Close()
			trace := []JourneyStep{}
			for rows.Next() {
				var step JourneyStep
				if err := rows.Scan(&step.Name, &step.AtMinutes); err != nil {
					return nil, err
				}
				trace = append(trace, step)
			}
			return trace, rows.Err()
		})
	}
}
