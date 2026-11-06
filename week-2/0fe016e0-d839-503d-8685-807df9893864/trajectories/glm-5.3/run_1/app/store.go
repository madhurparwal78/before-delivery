package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"hash/fnv"
	"os"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

// querier is satisfied by both *sql.DB and *sql.Tx, so every domain rule has
// exactly one implementation that works inside and outside a transaction.
type querier interface {
	Exec(query string, args ...any) (sql.Result, error)
	Query(query string, args ...any) (*sql.Rows, error)
	QueryRow(query string, args ...any) *sql.Row
}

const schema = `
CREATE TABLE IF NOT EXISTS capability_flag (
	flag_code        text PRIMARY KEY,
	flag_label       text NOT NULL,
	risk_class_code  text NOT NULL CHECK (risk_class_code IN ('CLASS-I','CLASS-IIA','CLASS-IIB')),
	max_adverse_rate_bp integer NOT NULL
);
CREATE TABLE IF NOT EXISTS cohort (
	cohort_code      text PRIMARY KEY,
	rung_index_count integer NOT NULL,
	cohort_label     text NOT NULL,
	device_count     integer NOT NULL,
	min_soak_minutes integer NOT NULL
);
CREATE TABLE IF NOT EXISTS device (
	device_code           text PRIMARY KEY,
	cohort_code           text NOT NULL REFERENCES cohort(cohort_code),
	serial_reference      text NOT NULL,
	firmware_version_label text NOT NULL
);
CREATE TABLE IF NOT EXISTS promotion (
	sequence_number      bigint PRIMARY KEY,
	promotion_code       text NOT NULL UNIQUE,
	flag_code            text NOT NULL REFERENCES capability_flag(flag_code),
	cohort_code          text NOT NULL REFERENCES cohort(cohort_code),
	promoted_at_minutes  bigint NOT NULL,
	demoted_at_minutes   bigint,
	attestation_reference text UNIQUE
);
CREATE TABLE IF NOT EXISTS adverse_event (
	event_code          text PRIMARY KEY,
	device_code         text NOT NULL REFERENCES device(device_code),
	flag_code           text NOT NULL REFERENCES capability_flag(flag_code),
	occurred_at_minutes bigint NOT NULL,
	severity_band_code  text NOT NULL CHECK (severity_band_code IN ('BAND-LOW','BAND-MED','BAND-HIGH'))
);
CREATE TABLE IF NOT EXISTS evidence_pack (
	pack_code text PRIMARY KEY,
	flag_code  text NOT NULL UNIQUE REFERENCES capability_flag(flag_code)
);
CREATE TABLE IF NOT EXISTS ledger_entry (
	id         bigserial PRIMARY KEY,
	red_line   text NOT NULL,
	detail     text NOT NULL,
	at_minutes bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS promotion_sequence (
	id          integer PRIMARY KEY,
	last_number bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency_record (
	idempotency_key text PRIMARY KEY,
	route           text NOT NULL,
	request_body    text NOT NULL,
	status          integer NOT NULL,
	response_body   text NOT NULL
);
CREATE TABLE IF NOT EXISTS journey_step (
	journey_code text NOT NULL,
	step_number  integer NOT NULL,
	step_name    text NOT NULL,
	at_minutes   bigint NOT NULL,
	PRIMARY KEY (journey_code, step_number)
);
INSERT INTO promotion_sequence (id, last_number) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
`

func openDB() (*sql.DB, error) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		return nil, errors.New("DATABASE_URL is not set")
	}
	// The store is the only backing service, so the connection speaks TLS
	// only when the URL asks for it; a local store answers without.
	dbURL := url
	separator := "?"
	if strings.Contains(dbURL, "?") {
		separator = "&"
	}
	dbURL += separator + "sslmode=disable"
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		return nil, err
	}
	db.SetMaxIdleConns(16)
	return db, nil
}

func ensureSchema(db *sql.DB) error {
	if _, err := db.Exec(schema); err != nil {
		return fmt.Errorf("create schema: %w", err)
	}
	return nil
}

// seedOnce loads the seed into an empty store, exactly once, in one transaction.
func seedOnce(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`SELECT pg_advisory_xact_lock($1)`, int64(0x52554E47)); err != nil {
		return err
	}
	var flags int
	if err := tx.QueryRow(`SELECT count(*) FROM capability_flag`).Scan(&flags); err != nil {
		return err
	}
	if flags > 0 {
		return nil
	}
	for _, f := range []struct {
		code, label, class string
		max                int64
	}{
		{"FLG-ADAPTIVE", "Adaptive dose titration", "CLASS-IIB", 40},
		{"FLG-TELEM", "Extended telemetry upload", "CLASS-I", 300},
		{"FLG-ALERT", "Predictive occlusion alert", "CLASS-IIA", 120},
	} {
		if _, err := tx.Exec(`INSERT INTO capability_flag (flag_code, flag_label, risk_class_code, max_adverse_rate_bp) VALUES ($1,$2,$3,$4)`,
			f.code, f.label, f.class, f.max); err != nil {
			return err
		}
	}
	for _, c := range []struct {
		code    string
		rung    int
		label   string
		devices int64
		minSoak int64
	}{
		{"COH-1", 1, "Bench fleet", 20, 4320},
		{"COH-2", 2, "Clinical pilot", 120, 10080},
		{"COH-3", 3, "Regional cohort", 900, 20160},
		{"COH-4", 4, "National cohort", 6400, 30240},
		{"COH-5", 5, "Full fleet", 21000, 43200},
	} {
		if _, err := tx.Exec(`INSERT INTO cohort (cohort_code, rung_index_count, cohort_label, device_count, min_soak_minutes) VALUES ($1,$2,$3,$4,$5)`,
			c.code, c.rung, c.label, c.devices, c.minSoak); err != nil {
			return err
		}
	}
	for _, d := range []struct{ code, cohort, serial, fw string }{
		{"DEV-0001", "COH-1", "SN-40001", "4.2.1"},
		{"DEV-0002", "COH-1", "SN-40002", "4.2.1"},
		{"DEV-0101", "COH-2", "SN-41001", "4.2.1"},
		{"DEV-0102", "COH-2", "SN-41002", "4.2.0"},
		{"DEV-0301", "COH-3", "SN-43001", "4.2.1"},
		{"DEV-0401", "COH-4", "SN-44001", "4.2.1"},
	} {
		if _, err := tx.Exec(`INSERT INTO device (device_code, cohort_code, serial_reference, firmware_version_label) VALUES ($1,$2,$3,$4)`,
			d.code, d.cohort, d.serial, d.fw); err != nil {
			return err
		}
	}
	for i, p := range []struct {
		flag, cohort string
		at           int64
		ref          string
	}{
		{"FLG-TELEM", "COH-1", 100000, "ATT-TEL-1"},
		{"FLG-TELEM", "COH-2", 111000, "ATT-TEL-2"},
		{"FLG-ADAPTIVE", "COH-1", 104000, "ATT-ADP-1"},
	} {
		if _, err := tx.Exec(`INSERT INTO promotion (sequence_number, promotion_code, flag_code, cohort_code, promoted_at_minutes, demoted_at_minutes, attestation_reference) VALUES ($1,$2,$3,$4,$5,NULL,$6)`,
			int64(i+1), fmt.Sprintf("PRM-%02d", i+1), p.flag, p.cohort, p.at, p.ref); err != nil {
			return err
		}
	}
	for _, e := range []struct {
		code, device, flag string
		at                 int64
		band               string
	}{
		{"AEV-01", "DEV-0101", "FLG-TELEM", 115000, "BAND-LOW"},
		{"AEV-02", "DEV-0002", "FLG-ADAPTIVE", 108000, "BAND-MED"},
	} {
		if _, err := tx.Exec(`INSERT INTO adverse_event (event_code, device_code, flag_code, occurred_at_minutes, severity_band_code) VALUES ($1,$2,$3,$4,$5)`,
			e.code, e.device, e.flag, e.at, e.band); err != nil {
			return err
		}
	}
	for _, f := range []string{"FLG-ADAPTIVE", "FLG-TELEM", "FLG-ALERT"} {
		if _, err := tx.Exec(`INSERT INTO evidence_pack (pack_code, flag_code) VALUES ($1,$2)`, "PACK-"+f, f); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`UPDATE promotion_sequence SET last_number = 3 WHERE id = 1`); err != nil {
		return err
	}
	return tx.Commit()
}

// seeded reports whether the seed rows are in place, so the server can
// answer health once the store has been seeded, whatever later writes the
// store holds.
func seeded(db *sql.DB) (bool, error) {
	var seededFlags, seededCohorts, seededDevices, seededPromotions, seededPacks, seededEvents int
	if err := db.QueryRow(`SELECT
		(SELECT count(*) FROM capability_flag WHERE flag_code IN ('FLG-ADAPTIVE','FLG-TELEM','FLG-ALERT')),
		(SELECT count(*) FROM cohort WHERE cohort_code IN ('COH-1','COH-2','COH-3','COH-4','COH-5')),
		(SELECT count(*) FROM device WHERE device_code IN ('DEV-0001','DEV-0002','DEV-0101','DEV-0102','DEV-0301','DEV-0401')),
		(SELECT count(*) FROM promotion WHERE promotion_code IN ('PRM-01','PRM-02','PRM-03')),
		(SELECT count(*) FROM evidence_pack WHERE pack_code IN ('PACK-FLG-ADAPTIVE','PACK-FLG-TELEM','PACK-FLG-ALERT')),
		(SELECT count(*) FROM adverse_event WHERE event_code IN ('AEV-01','AEV-02'))`).
		Scan(&seededFlags, &seededCohorts, &seededDevices, &seededPromotions, &seededPacks, &seededEvents); err != nil {
		return false, err
	}
	return seededFlags == 3 && seededCohorts == 5 && seededDevices == 6 &&
		seededPromotions == 3 && seededPacks == 3 && seededEvents == 2, nil
}

func hash64(s string) int64 {
	h := fnv.New64a()
	h.Write([]byte(s))
	return int64(h.Sum64())
}

// flagLockID and idemLockID occupy disjoint hash spaces of the advisory lock
// keyspace, so a flag step and an idempotency step never wait on each other's
// namespace by accident.
func flagLockID(flagCode string) int64 { return hash64("rungl:flag:" + flagCode) }
func idemLockID(key string) int64      { return hash64("rungl:idem:" + key) }

func beginFlagLocks(tx *sql.Tx, flagCodes []string) error {
	for _, c := range flagCodes {
		if _, err := tx.Exec(`SELECT pg_advisory_xact_lock($1)`, flagLockID(c)); err != nil {
			return err
		}
	}
	return nil
}

// nextPromotionNumber assigns the next promotion sequence number. The row lock
// on promotion_sequence makes assignment gapless and commit-ordered: a rolled
// back transaction returns its number to the pool.
func nextPromotionNumber(tx *sql.Tx) (int64, error) {
	var n int64
	if err := tx.QueryRow(`UPDATE promotion_sequence SET last_number = last_number + 1 WHERE id = 1 RETURNING last_number`).Scan(&n); err != nil {
		return 0, err
	}
	return n, nil
}

func promotionCode(n int64) string {
	return fmt.Sprintf("PRM-%02d", n)
}

func dbDown(db *sql.DB, err error) bool {
	if err == nil {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return db.PingContext(ctx) != nil
}
