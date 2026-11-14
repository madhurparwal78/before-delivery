package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// staleRunning is how long a key whose first request vanished stays claimed.
const staleRunning = 2 * time.Minute

func validIdempotencyKey(k string) bool {
	if len(k) < 1 || len(k) > 100 {
		return false
	}
	for i := 0; i < len(k); i++ {
		if k[i] < 0x21 || k[i] > 0x7e {
			return false
		}
	}
	return true
}

// storedAnswer is the one place that decides which idempotent answers are stored.
func storedAnswer(status int, err error) bool {
	if err != nil {
		var ae *apiError
		if !errors.As(err, &ae) {
			return false
		}
		status = ae.Status
		if ae.Code == "IDEMPOTENCY_CONFLICT" {
			return false
		}
	}
	return (status >= 200 && status < 300) || status == 402 || status == 409 || status == 502
}

func canonicalBodyHash(body []byte) string {
	var v any = map[string]any{}
	if len(bytes.TrimSpace(body)) > 0 {
		if err := json.Unmarshal(body, &v); err != nil {
			v = string(body)
		}
	}
	b, _ := json.Marshal(v)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func (a *app) idempotent(c *call, handle func(*call) (int, any, error)) (int, any, bool, error) {
	key := c.r.Header.Get("Idempotency-Key")
	if !validIdempotencyKey(key) {
		return 0, nil, false, invalidField("Idempotency-Key", msgIdempotencyKey)
	}
	routeKey := c.r.Method + " " + c.r.URL.Path
	hash := canonicalBodyHash(c.body)
	for {
		tag, err := a.db.Exec(c.ctx, `INSERT INTO idempotency_key (username, route, key, body_hash, state)
			VALUES ($1, $2, $3, $4, 'running') ON CONFLICT DO NOTHING`, c.user.Username, routeKey, key, hash)
		if err != nil {
			return 0, nil, false, fmt.Errorf("claim idempotency key: %w", err)
		}
		if tag.RowsAffected() == 1 {
			return a.runAndStore(c, handle, routeKey, key)
		}
		var storedHash, state string
		var status *int
		var response []byte
		var stale bool
		err = a.db.QueryRow(c.ctx, `SELECT body_hash, state, status, response, started_at < now() - make_interval(secs => $4)
			FROM idempotency_key WHERE username = $1 AND route = $2 AND key = $3`,
			c.user.Username, routeKey, key, staleRunning.Seconds()).Scan(&storedHash, &state, &status, &response, &stale)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return 0, nil, false, fmt.Errorf("read idempotency key: %w", err)
		}
		switch {
		case state == "stored" && storedHash != hash:
			return 0, nil, false, fail("IDEMPOTENCY_CONFLICT")
		case state == "stored":
			return *status, json.RawMessage(response), true, nil
		case stale:
			if _, err := a.db.Exec(c.ctx, `DELETE FROM idempotency_key WHERE username = $1 AND route = $2 AND key = $3 AND state = 'running'`,
				c.user.Username, routeKey, key); err != nil {
				return 0, nil, false, fmt.Errorf("drop stale idempotency key: %w", err)
			}
		default:
			time.Sleep(100 * time.Millisecond)
		}
	}
}

func (a *app) runAndStore(c *call, handle func(*call) (int, any, error), routeKey, key string) (int, any, bool, error) {
	status, body, err := handle(c)
	if !storedAnswer(status, err) {
		if _, derr := a.db.Exec(c.ctx, `DELETE FROM idempotency_key WHERE username = $1 AND route = $2 AND key = $3`,
			c.user.Username, routeKey, key); derr != nil {
			return 0, nil, false, fmt.Errorf("release idempotency key: %w", derr)
		}
		return status, body, false, err
	}
	answer := body
	if err != nil {
		ae := asAPIError(err)
		status, answer = ae.Status, ae
	}
	raw, merr := json.Marshal(answer)
	if merr != nil {
		return 0, nil, false, fmt.Errorf("encode idempotent answer: %w", merr)
	}
	if _, uerr := a.db.Exec(c.ctx, `UPDATE idempotency_key SET state = 'stored', status = $4, response = $5
		WHERE username = $1 AND route = $2 AND key = $3`, c.user.Username, routeKey, key, status, raw); uerr != nil {
		return 0, nil, false, fmt.Errorf("store idempotent answer: %w", uerr)
	}
	return status, body, false, err
}
