package main

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const schemaSQL = `
DO $$ BEGIN
	CREATE TYPE risk_class AS ENUM ('CLASS-I', 'CLASS-IIA', 'CLASS-IIB');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	CREATE TYPE severity_band AS ENUM ('BAND-LOW', 'BAND-MED', 'BAND-HIGH');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS capability_flag (
	flag_code text PRIMARY KEY,
	flag_label text NOT NULL,
	risk_class_code risk_class NOT NULL,
	max_adverse_rate_bp integer NOT NULL
);

CREATE TABLE IF NOT EXISTS cohort (
	cohort_code text PRIMARY KEY,
	rung_index_count integer NOT NULL UNIQUE,
	cohort_label text NOT NULL,
	device_count integer NOT NULL,
	min_soak_minutes integer NOT NULL
);

CREATE TABLE IF NOT EXISTS device (
	device_code text PRIMARY KEY,
	cohort_code text NOT NULL REFERENCES cohort (cohort_code),
	serial_reference text NOT NULL,
	firmware_version_label text NOT NULL
);

CREATE TABLE IF NOT EXISTS promotion (
	promotion_code text PRIMARY KEY,
	flag_code text NOT NULL REFERENCES capability_flag (flag_code),
	cohort_code text NOT NULL REFERENCES cohort (cohort_code),
	promoted_at_minutes integer NOT NULL,
	demoted_at_minutes integer,
	attestation_reference text
);

-- A signed bench attestation covers exactly one rung, once (DP-04).
CREATE UNIQUE INDEX IF NOT EXISTS promotion_attestation_reference_key
	ON promotion (attestation_reference);

CREATE TABLE IF NOT EXISTS adverse_event (
	event_code text PRIMARY KEY,
	device_code text NOT NULL REFERENCES device (device_code),
	flag_code text NOT NULL REFERENCES capability_flag (flag_code),
	occurred_at_minutes integer NOT NULL,
	severity_band_code severity_band NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence_pack (
	pack_code text PRIMARY KEY,
	flag_code text NOT NULL REFERENCES capability_flag (flag_code)
);

CREATE TABLE IF NOT EXISTS ledger_entry (
	ledger_entry_id bigserial PRIMARY KEY,
	red_line text NOT NULL,
	noted_at_minutes integer NOT NULL
);

CREATE TABLE IF NOT EXISTS promotion_counter (
	counter_code text PRIMARY KEY,
	next_sequence_number integer NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_record (
	idempotency_key text PRIMARY KEY,
	route text NOT NULL,
	request_body jsonb NOT NULL,
	response_status integer NOT NULL,
	response_body jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS journey_step (
	journey_code text NOT NULL,
	step_position integer NOT NULL,
	step_name text NOT NULL,
	at_minutes integer NOT NULL,
	PRIMARY KEY (journey_code, step_position)
);
`

type store struct {
	pool *pgxpool.Pool
}

func openStore(ctx context.Context, url string) (*store, error) {
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	config.MaxConns = 16
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, err
	}
	return &store{pool: pool}, nil
}

// prepare creates missing tables and loads the seed the first time it meets an
// empty store.
func (s *store) prepare(ctx context.Context) error {
	if _, err := s.pool.Exec(ctx, schemaSQL); err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, seedLockKey); err != nil {
		return err
	}
	var flagTotal int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM capability_flag`).Scan(&flagTotal); err != nil {
		return err
	}
	if flagTotal == 0 {
		if err := loadSeed(ctx, tx); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *store) ping(ctx context.Context) error {
	var ready bool
	return s.pool.QueryRow(ctx, `SELECT count(*) = 3 FROM capability_flag`).Scan(&ready)
}

const seedLockKey = int64(8742301)

func loadSeed(ctx context.Context, tx pgx.Tx) error {
	statements := []struct {
		sql  string
		rows [][]any
	}{
		{
			`INSERT INTO capability_flag (flag_code, flag_label, risk_class_code, max_adverse_rate_bp) VALUES ($1, $2, $3, $4)`,
			[][]any{
				{"FLG-ADAPTIVE", "Adaptive dose titration", "CLASS-IIB", 40},
				{"FLG-TELEM", "Extended telemetry upload", "CLASS-I", 300},
				{"FLG-ALERT", "Predictive occlusion alert", "CLASS-IIA", 120},
			},
		},
		{
			`INSERT INTO cohort (cohort_code, rung_index_count, cohort_label, device_count, min_soak_minutes) VALUES ($1, $2, $3, $4, $5)`,
			[][]any{
				{"COH-1", 1, "Bench fleet", 20, 4320},
				{"COH-2", 2, "Clinical pilot", 120, 10080},
				{"COH-3", 3, "Regional cohort", 900, 20160},
				{"COH-4", 4, "National cohort", 6400, 30240},
				{"COH-5", 5, "Full fleet", 21000, 43200},
			},
		},
		{
			`INSERT INTO device (device_code, cohort_code, serial_reference, firmware_version_label) VALUES ($1, $2, $3, $4)`,
			[][]any{
				{"DEV-0001", "COH-1", "SN-40001", "4.2.1"},
				{"DEV-0002", "COH-1", "SN-40002", "4.2.1"},
				{"DEV-0101", "COH-2", "SN-41001", "4.2.1"},
				{"DEV-0102", "COH-2", "SN-41002", "4.2.0"},
				{"DEV-0301", "COH-3", "SN-43001", "4.2.1"},
				{"DEV-0401", "COH-4", "SN-44001", "4.2.1"},
			},
		},
		{
			`INSERT INTO promotion (promotion_code, flag_code, cohort_code, promoted_at_minutes, demoted_at_minutes, attestation_reference) VALUES ($1, $2, $3, $4, NULL, $5)`,
			[][]any{
				{"PRM-01", "FLG-TELEM", "COH-1", 100000, "ATT-TEL-1"},
				{"PRM-02", "FLG-TELEM", "COH-2", 111000, "ATT-TEL-2"},
				{"PRM-03", "FLG-ADAPTIVE", "COH-1", 104000, "ATT-ADP-1"},
			},
		},
		{
			`INSERT INTO adverse_event (event_code, device_code, flag_code, occurred_at_minutes, severity_band_code) VALUES ($1, $2, $3, $4, $5)`,
			[][]any{
				{"AEV-01", "DEV-0101", "FLG-TELEM", 115000, "BAND-LOW"},
				{"AEV-02", "DEV-0002", "FLG-ADAPTIVE", 108000, "BAND-MED"},
			},
		},
		{
			`INSERT INTO evidence_pack (pack_code, flag_code) VALUES ($1, $2)`,
			[][]any{
				{"PACK-FLG-ADAPTIVE", "FLG-ADAPTIVE"},
				{"PACK-FLG-TELEM", "FLG-TELEM"},
				{"PACK-FLG-ALERT", "FLG-ALERT"},
			},
		},
		{
			`INSERT INTO promotion_counter (counter_code, next_sequence_number) VALUES ($1, $2)`,
			[][]any{{"PRM", 4}},
		},
	}
	for _, statement := range statements {
		for _, row := range statement.rows {
			if _, err := tx.Exec(ctx, statement.sql, row...); err != nil {
				return err
			}
		}
	}
	return nil
}

// unavailable reports whether an error means the database could not serve the
// request.
func unavailable(err error) bool {
	if err == nil {
		return false
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return false
	}
	return true
}

func withTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, 5*time.Second)
}
