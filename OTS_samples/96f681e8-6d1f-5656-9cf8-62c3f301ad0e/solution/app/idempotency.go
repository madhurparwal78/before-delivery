package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
)

const idempotencyPoll = 100 * time.Millisecond

// idempotencyAbandoned is how long a running key may sit before a new request takes it over.
const idempotencyAbandoned = 2 * time.Minute

func validKey(key string) bool {
	if len(key) < 1 || len(key) > 100 {
		return false
	}
	for _, c := range key {
		if c < 0x21 || c > 0x7e {
			return false
		}
	}
	return true
}

// bodyHash identifies a request body independent of key order and spacing.
func bodyHash(body []byte) string {
	var parsed any
	canonical := body
	if json.Unmarshal(body, &parsed) == nil {
		if encoded, err := json.Marshal(parsed); err == nil {
			canonical = encoded
		}
	}
	sum := sha256.Sum256(canonical)
	return hex.EncodeToString(sum[:])
}

// storedAnswer is the one place it is decided which answers are kept with their key: those given once the route has
// begun its own work (2xx, 402, 409 other than IDEMPOTENCY_CONFLICT, and 502). Every other answer, 503 included,
// leaves the key unused, so a repeat runs afresh.
func storedAnswer(res result) bool {
	switch {
	case res.status >= 200 && res.status <= 299:
		return true
	case res.status == 402 || res.status == 502:
		return true
	case res.status == 409:
		body, isError := res.body.(map[string]any)
		return !isError || body["code"] != codeIdempotency
	}
	return false
}

// withIdempotency runs fn once per key: a repeat with the same body replays a stored answer, and a different body
// is refused. A repeat that arrives while the first still runs waits for it, then replays it if it was stored and
// otherwise runs afresh. Stored keys are kept for the life of the database.
func (a *App) withIdempotency(ctx context.Context, rq *request, fn func() (result, error)) (result, error) {
	key, present := rq.r.Header["Idempotency-Key"]
	if !present {
		return fn()
	}
	if len(key) != 1 || !validKey(key[0]) {
		return result{}, failValidation(map[string]string{"Idempotency-Key": msgIdempotency})
	}
	route := rq.r.Method + " " + rq.r.URL.Path
	hash := bodyHash(rq.body)
	for {
		claimed, err := a.claimKey(ctx, rq.me.Username, route, key[0], hash)
		if err != nil {
			return result{}, err
		}
		switch claimed.state {
		case keyClaimed:
			res, err := fn()
			var api *apiError
			if err != nil && !errors.As(err, &api) {
				return result{}, errors.Join(err, a.releaseKey(ctx, rq.me.Username, route, key[0]))
			}
			kept := res
			if api != nil {
				kept = api.answer()
			}
			if !storedAnswer(kept) {
				return res, errors.Join(err, a.releaseKey(ctx, rq.me.Username, route, key[0]))
			}
			if storeErr := a.storeKey(ctx, rq.me.Username, route, key[0], kept); storeErr != nil {
				log.Printf("keep idempotent response: %v", storeErr)
			}
			return res, err
		case keyReplay:
			return claimed.stored, nil
		case keyConflict:
			return result{}, fail(codeIdempotency)
		}
		select {
		case <-ctx.Done():
			return result{}, fmt.Errorf("wait for first request: %w", ctx.Err())
		case <-time.After(idempotencyPoll):
		}
	}
}

type keyState int

const (
	keyClaimed keyState = iota
	keyReplay
	keyConflict
	keyRunning
)

type claimedKey struct {
	state  keyState
	stored result
}

func (a *App) claimKey(ctx context.Context, username, route, key, hash string) (claimedKey, error) {
	tag, err := a.pool.Exec(ctx, `INSERT INTO idempotency_keys (username, route, key, body_hash, state) VALUES ($1, $2, $3, $4, 'running')
		ON CONFLICT (username, route, key) DO UPDATE SET created_at = clock_timestamp(), body_hash = EXCLUDED.body_hash
		WHERE idempotency_keys.state = 'running' AND idempotency_keys.created_at < clock_timestamp() - $5::interval`,
		username, route, key, hash, fmt.Sprintf("%d seconds", int(idempotencyAbandoned.Seconds())))
	if err != nil {
		return claimedKey{}, fmt.Errorf("claim idempotency key: %w", err)
	}
	if tag.RowsAffected() == 1 {
		return claimedKey{state: keyClaimed}, nil
	}
	var storedHash, state string
	var status *int
	var response *string
	err = a.pool.QueryRow(ctx, "SELECT body_hash, state, status, response FROM idempotency_keys WHERE username = $1 AND route = $2 AND key = $3",
		username, route, key).Scan(&storedHash, &state, &status, &response)
	if errors.Is(err, pgx.ErrNoRows) {
		return claimedKey{state: keyRunning}, nil
	}
	if err != nil {
		return claimedKey{}, fmt.Errorf("read idempotency key: %w", err)
	}
	if state != "done" || status == nil || response == nil {
		return claimedKey{state: keyRunning}, nil
	}
	if storedHash != hash {
		return claimedKey{state: keyConflict}, nil
	}
	return claimedKey{state: keyReplay, stored: result{status: *status, body: json.RawMessage(*response), replayed: true}}, nil
}

func (a *App) storeKey(ctx context.Context, username, route, key string, res result) error {
	encoded, err := json.Marshal(res.body)
	if err != nil {
		return fmt.Errorf("encode stored response: %w", err)
	}
	if _, err := a.pool.Exec(ctx, "UPDATE idempotency_keys SET state = 'done', status = $4, response = $5 WHERE username = $1 AND route = $2 AND key = $3",
		username, route, key, res.status, string(encoded)); err != nil {
		return fmt.Errorf("store idempotent response: %w", err)
	}
	return nil
}

func (a *App) releaseKey(ctx context.Context, username, route, key string) error {
	if _, err := a.pool.Exec(ctx, "DELETE FROM idempotency_keys WHERE username = $1 AND route = $2 AND key = $3 AND state = 'running'",
		username, route, key); err != nil {
		return fmt.Errorf("release idempotency key: %w", err)
	}
	return nil
}
