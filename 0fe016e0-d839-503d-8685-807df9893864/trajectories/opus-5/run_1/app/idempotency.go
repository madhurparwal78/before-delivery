package main

import (
	"context"
	"encoding/json"
	"errors"
	"hash/fnv"
	"reflect"

	"github.com/jackc/pgx/v5"
)

// Lock namespaces, always taken in this order inside one transaction.
const (
	idempotencyLockNamespace = 11
	flagLockNamespace        = 12
	referenceLockNamespace   = 13
	eventCodeLockNamespace   = 14
	journeyLockNamespace     = 15
)

func lockKeyFor(value string) int32 {
	hash := fnv.New32a()
	hash.Write([]byte(value))
	return int32(hash.Sum32() & 0x7fffffff)
}

// takeLock serialises the rest of the transaction on one value.
func takeLock(ctx context.Context, tx pgx.Tx, namespace int, value string) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1, $2)`, namespace, lockKeyFor(value))
	return err
}

type storedResponse struct {
	route    string
	request  []byte
	status   int
	response []byte
}

// loadIdempotencyRecord locks the key for the rest of the transaction and
// returns the stored response, if any.
func loadIdempotencyRecord(ctx context.Context, tx pgx.Tx, key string) (*storedResponse, error) {
	if err := takeLock(ctx, tx, idempotencyLockNamespace, key); err != nil {
		return nil, err
	}
	var record storedResponse
	err := tx.QueryRow(ctx,
		`SELECT route, request_body, response_status, response_body FROM idempotency_record WHERE idempotency_key = $1`,
		key).Scan(&record.route, &record.request, &record.status, &record.response)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &record, nil
}

func saveIdempotencyRecord(ctx context.Context, tx pgx.Tx, key, route string, request []byte, status int, body any) error {
	response, err := json.Marshal(body)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO idempotency_record (idempotency_key, route, request_body, response_status, response_body)
		 VALUES ($1, $2, $3, $4, $5)`,
		key, route, request, status, response)
	return err
}

// sameRequestBody compares two bodies as JSON values, ignoring key order and
// whitespace. A body that is not valid JSON never equals a stored one.
func sameRequestBody(stored, incoming []byte) bool {
	var storedValue, incomingValue any
	if err := json.Unmarshal(stored, &storedValue); err != nil {
		return false
	}
	if err := json.Unmarshal(incoming, &incomingValue); err != nil {
		return false
	}
	return reflect.DeepEqual(storedValue, incomingValue)
}
