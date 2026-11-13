package core

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// StoredResponse answers a replayed idempotency key with its stored response,
// before any state check, and refuses the same key with a different body.
func (a *App) StoredResponse(ctx context.Context, route, key string, body []byte) (json.RawMessage, int, bool, error) {
	sum := sha256.Sum256(body)
	hash := hex.EncodeToString(sum[:])
	var storedHash string
	var status int
	var response []byte
	err := a.pool.QueryRow(ctx, `SELECT body_hash, status, response FROM idempotency WHERE route=$1 AND key=$2`,
		route, key).Scan(&storedHash, &status, &response)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, 0, false, nil
	}
	if err != nil {
		return nil, 0, false, fmt.Errorf("read idempotency key: %w", err)
	}
	if storedHash != hash {
		return nil, 0, false, errCode(409, "idempotency_conflict")
	}
	return response, status, true, nil
}

func (a *App) StoreResponse(ctx context.Context, route, key string, body []byte, value any, status int) error {
	sum := sha256.Sum256(body)
	response, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("write stored response: %w", err)
	}
	if _, err := a.pool.Exec(ctx, `INSERT INTO idempotency (route, key, body_hash, status, response, created_at)
		VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (route, key) DO NOTHING`,
		route, key, hex.EncodeToString(sum[:]), status, response, a.Clock.Now()); err != nil {
		return fmt.Errorf("store response: %w", err)
	}
	return nil
}
