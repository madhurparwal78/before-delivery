package main

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
)

const schemaSQL = `
CREATE TABLE IF NOT EXISTS capability_flag (
	flag_code text PRIMARY KEY,
	flag_label text NOT NULL,
	risk_class_code text NOT NULL CHECK (risk_class_code IN ('CLASS-I', 'CLASS-IIA', 'CLASS-IIB')),
	max_adverse_rate_bp integer NOT NULL CHECK (max_adverse_rate_bp BETWEEN 0 AND 10000)
);
CREATE TABLE IF NOT EXISTS cohort (
	cohort_code text PRIMARY KEY,
	rung_index_count integer NOT NULL UNIQUE,
	cohort_label text NOT NULL,
	device_count integer NOT NULL CHECK (device_count > 0),
	min_soak_minutes integer NOT NULL CHECK (min_soak_minutes BETWEEN 0 AND 525600)
);
CREATE TABLE IF NOT EXISTS device (
	device_code text PRIMARY KEY,
	cohort_code text NOT NULL REFERENCES cohort (cohort_code),
	serial_reference text NOT NULL,
	firmware_version_label text NOT NULL
);
CREATE TABLE IF NOT EXISTS promotion (
	promotion_code text PRIMARY KEY,
	sequence_number integer NOT NULL UNIQUE,
	flag_code text NOT NULL REFERENCES capability_flag (flag_code),
	cohort_code text NOT NULL REFERENCES cohort (cohort_code),
	promoted_at_minutes integer NOT NULL,
	demoted_at_minutes integer,
	attestation_reference text UNIQUE
);
CREATE INDEX IF NOT EXISTS promotion_flag_cohort ON promotion (flag_code, cohort_code);
CREATE TABLE IF NOT EXISTS adverse_event (
	event_code text PRIMARY KEY,
	device_code text NOT NULL REFERENCES device (device_code),
	flag_code text NOT NULL REFERENCES capability_flag (flag_code),
	occurred_at_minutes integer NOT NULL,
	severity_band_code text NOT NULL CHECK (severity_band_code IN ('BAND-LOW', 'BAND-MED', 'BAND-HIGH'))
);
CREATE TABLE IF NOT EXISTS evidence_pack (
	pack_code text PRIMARY KEY,
	flag_code text NOT NULL UNIQUE REFERENCES capability_flag (flag_code)
);
CREATE TABLE IF NOT EXISTS ledger_entry (
	ledger_entry_id bigserial PRIMARY KEY,
	red_line text NOT NULL,
	recorded_at_minutes integer NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency_record (
	idempotency_key text PRIMARY KEY,
	route text NOT NULL,
	request_body jsonb NOT NULL,
	response_status integer NOT NULL,
	response_body text NOT NULL
);
CREATE TABLE IF NOT EXISTS journey_step (
	journey_code text NOT NULL,
	step_number integer NOT NULL,
	step_name text NOT NULL,
	at_minutes integer NOT NULL,
	PRIMARY KEY (journey_code, step_number)
);
`

// Advisory lock classes; each serialises one kind of step inside its transaction.
const (
	lockIdempotencyKey = 1
	lockPromotionCode  = 2
	lockStoreSetup     = 3
	lockJourneyTrace   = 4
)

// Flag is a capability flag row.
type Flag struct {
	Code             string `json:"flag_code"`
	Label            string `json:"flag_label"`
	RiskClass        string `json:"risk_class_code"`
	MaxAdverseRateBP int    `json:"max_adverse_rate_bp"`
}

// Cohort is one rung of every ladder.
type Cohort struct {
	Code           string `json:"cohort_code"`
	RungIndex      int    `json:"rung_index_count"`
	Label          string `json:"cohort_label"`
	DeviceCount    int    `json:"device_count"`
	MinSoakMinutes int    `json:"min_soak_minutes"`
}

// Device belongs to one cohort.
type Device struct {
	Code            string `json:"device_code"`
	CohortCode      string `json:"cohort_code"`
	SerialReference string `json:"serial_reference"`
	FirmwareVersion string `json:"firmware_version_label"`
}

// Promotion is one promotion row; it is never deleted.
type Promotion struct {
	Code                 string  `json:"promotion_code"`
	FlagCode             string  `json:"flag_code"`
	CohortCode           string  `json:"cohort_code"`
	PromotedAt           int     `json:"promoted_at_minutes"`
	DemotedAt            *int    `json:"demoted_at_minutes"`
	AttestationReference *string `json:"attestation_reference"`
	Sequence             int     `json:"-"`
}

// AdverseEvent is a recorded complaint; CohortCode is its device's cohort.
type AdverseEvent struct {
	Code         string `json:"event_code"`
	DeviceCode   string `json:"device_code"`
	FlagCode     string `json:"flag_code"`
	OccurredAt   int    `json:"occurred_at_minutes"`
	SeverityBand string `json:"severity_band_code"`
	CohortCode   string `json:"-"`
}

var (
	seedFlags = []Flag{
		{"FLG-ADAPTIVE", "Adaptive dose titration", "CLASS-IIB", 40},
		{"FLG-TELEM", "Extended telemetry upload", "CLASS-I", 300},
		{"FLG-ALERT", "Predictive occlusion alert", "CLASS-IIA", 120},
	}
	seedCohorts = []Cohort{
		{"COH-1", 1, "Bench fleet", 20, 4320},
		{"COH-2", 2, "Clinical pilot", 120, 10080},
		{"COH-3", 3, "Regional cohort", 900, 20160},
		{"COH-4", 4, "National cohort", 6400, 30240},
		{"COH-5", 5, "Full fleet", 21000, 43200},
	}
	seedDevices = []Device{
		{"DEV-0001", "COH-1", "SN-40001", "4.2.1"},
		{"DEV-0002", "COH-1", "SN-40002", "4.2.1"},
		{"DEV-0101", "COH-2", "SN-41001", "4.2.1"},
		{"DEV-0102", "COH-2", "SN-41002", "4.2.0"},
		{"DEV-0301", "COH-3", "SN-43001", "4.2.1"},
		{"DEV-0401", "COH-4", "SN-44001", "4.2.1"},
	}
	seedPromotions = []Promotion{
		{Code: "PRM-01", Sequence: 1, FlagCode: "FLG-TELEM", CohortCode: "COH-1", PromotedAt: 100000, AttestationReference: textPointer("ATT-TEL-1")},
		{Code: "PRM-02", Sequence: 2, FlagCode: "FLG-TELEM", CohortCode: "COH-2", PromotedAt: 111000, AttestationReference: textPointer("ATT-TEL-2")},
		{Code: "PRM-03", Sequence: 3, FlagCode: "FLG-ADAPTIVE", CohortCode: "COH-1", PromotedAt: 104000, AttestationReference: textPointer("ATT-ADP-1")},
	}
	seedEvents = []AdverseEvent{
		{Code: "AEV-01", DeviceCode: "DEV-0101", FlagCode: "FLG-TELEM", OccurredAt: 115000, SeverityBand: "BAND-LOW"},
		{Code: "AEV-02", DeviceCode: "DEV-0002", FlagCode: "FLG-ADAPTIVE", OccurredAt: 108000, SeverityBand: "BAND-MED"},
	}
)

func textPointer(text string) *string { return &text }

// ensureStore creates missing tables and loads the seed the first time it meets an empty store.
func ensureStore(ctx context.Context, db *sql.DB) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock($1, 0)`, lockStoreSetup); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, schemaSQL); err != nil {
		return err
	}
	var flagCount int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM capability_flag`).Scan(&flagCount); err != nil {
		return err
	}
	if flagCount == 0 {
		if err := loadSeed(ctx, tx); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func loadSeed(ctx context.Context, tx *sql.Tx) error {
	for _, flag := range seedFlags {
		if _, err := tx.ExecContext(ctx, `INSERT INTO capability_flag (flag_code, flag_label, risk_class_code, max_adverse_rate_bp) VALUES ($1, $2, $3, $4)`,
			flag.Code, flag.Label, flag.RiskClass, flag.MaxAdverseRateBP); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO evidence_pack (pack_code, flag_code) VALUES ($1, $2)`, packCode(flag.Code), flag.Code); err != nil {
			return err
		}
	}
	for _, cohort := range seedCohorts {
		if _, err := tx.ExecContext(ctx, `INSERT INTO cohort (cohort_code, rung_index_count, cohort_label, device_count, min_soak_minutes) VALUES ($1, $2, $3, $4, $5)`,
			cohort.Code, cohort.RungIndex, cohort.Label, cohort.DeviceCount, cohort.MinSoakMinutes); err != nil {
			return err
		}
	}
	for _, device := range seedDevices {
		if _, err := tx.ExecContext(ctx, `INSERT INTO device (device_code, cohort_code, serial_reference, firmware_version_label) VALUES ($1, $2, $3, $4)`,
			device.Code, device.CohortCode, device.SerialReference, device.FirmwareVersion); err != nil {
			return err
		}
	}
	for _, promotion := range seedPromotions {
		if _, err := insertPromotion(ctx, tx, promotion); err != nil {
			return err
		}
	}
	for _, event := range seedEvents {
		if _, err := insertAdverseEvent(ctx, tx, event); err != nil {
			return err
		}
	}
	return nil
}

func packCode(flagCode string) string { return "PACK-" + flagCode }

// consoleOrder sorts flags into seed order, the order the console shows them in.
func consoleOrder(flags []Flag) []Flag {
	position := map[string]int{}
	for index, flag := range seedFlags {
		position[flag.Code] = index
	}
	ordered := append([]Flag(nil), flags...)
	sort.SliceStable(ordered, func(i, j int) bool { return position[ordered[i].Code] < position[ordered[j].Code] })
	return ordered
}

const flagColumns = `SELECT flag_code, flag_label, risk_class_code, max_adverse_rate_bp FROM capability_flag`

func scanFlags(rows *sql.Rows, err error) ([]Flag, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var flags []Flag
	for rows.Next() {
		var flag Flag
		if err := rows.Scan(&flag.Code, &flag.Label, &flag.RiskClass, &flag.MaxAdverseRateBP); err != nil {
			return nil, err
		}
		flags = append(flags, flag)
	}
	return flags, rows.Err()
}

func loadFlags(ctx context.Context, tx *sql.Tx) ([]Flag, error) {
	return scanFlags(tx.QueryContext(ctx, flagColumns+` ORDER BY flag_code COLLATE "C"`))
}

// lockFlag takes the flag's serialised step: the row lock is held until the transaction ends.
// A code holding a NUL byte can name no flag and never reaches the database.
func lockFlag(ctx context.Context, tx *sql.Tx, code string) (*Flag, error) {
	if strings.ContainsRune(code, 0) {
		return nil, nil
	}
	flags, err := scanFlags(tx.QueryContext(ctx, flagColumns+` WHERE flag_code = $1 FOR UPDATE`, code))
	if err != nil || len(flags) == 0 {
		return nil, err
	}
	return &flags[0], nil
}

// lockEveryFlag serialises a step that affects every flag, locking rows in code order.
func lockEveryFlag(ctx context.Context, tx *sql.Tx) ([]Flag, error) {
	return scanFlags(tx.QueryContext(ctx, flagColumns+` ORDER BY flag_code COLLATE "C" FOR UPDATE`))
}

func loadCohorts(ctx context.Context, tx *sql.Tx) ([]Cohort, error) {
	rows, err := tx.QueryContext(ctx, `SELECT cohort_code, rung_index_count, cohort_label, device_count, min_soak_minutes FROM cohort ORDER BY rung_index_count`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var cohorts []Cohort
	for rows.Next() {
		var cohort Cohort
		if err := rows.Scan(&cohort.Code, &cohort.RungIndex, &cohort.Label, &cohort.DeviceCount, &cohort.MinSoakMinutes); err != nil {
			return nil, err
		}
		cohorts = append(cohorts, cohort)
	}
	return cohorts, rows.Err()
}

func loadDevices(ctx context.Context, tx *sql.Tx) ([]Device, error) {
	rows, err := tx.QueryContext(ctx, `SELECT device_code, cohort_code, serial_reference, firmware_version_label FROM device ORDER BY device_code COLLATE "C"`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var devices []Device
	for rows.Next() {
		var device Device
		if err := rows.Scan(&device.Code, &device.CohortCode, &device.SerialReference, &device.FirmwareVersion); err != nil {
			return nil, err
		}
		devices = append(devices, device)
	}
	return devices, rows.Err()
}

// loadPromotions returns every promotion row in sequence order.
func loadPromotions(ctx context.Context, tx *sql.Tx) ([]Promotion, error) {
	rows, err := tx.QueryContext(ctx, `SELECT promotion_code, sequence_number, flag_code, cohort_code, promoted_at_minutes, demoted_at_minutes, attestation_reference
		FROM promotion ORDER BY sequence_number`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var promotions []Promotion
	for rows.Next() {
		var promotion Promotion
		var demotedAt sql.NullInt64
		var reference sql.NullString
		if err := rows.Scan(&promotion.Code, &promotion.Sequence, &promotion.FlagCode, &promotion.CohortCode, &promotion.PromotedAt, &demotedAt, &reference); err != nil {
			return nil, err
		}
		if demotedAt.Valid {
			instant := int(demotedAt.Int64)
			promotion.DemotedAt = &instant
		}
		if reference.Valid {
			promotion.AttestationReference = &reference.String
		}
		promotions = append(promotions, promotion)
	}
	return promotions, rows.Err()
}

// loadAdverseEvents returns every event in code order, with its device's cohort.
func loadAdverseEvents(ctx context.Context, tx *sql.Tx) ([]AdverseEvent, error) {
	rows, err := tx.QueryContext(ctx, `SELECT e.event_code, e.device_code, e.flag_code, e.occurred_at_minutes, e.severity_band_code, d.cohort_code
		FROM adverse_event e JOIN device d ON d.device_code = e.device_code ORDER BY e.event_code COLLATE "C"`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var events []AdverseEvent
	for rows.Next() {
		var event AdverseEvent
		if err := rows.Scan(&event.Code, &event.DeviceCode, &event.FlagCode, &event.OccurredAt, &event.SeverityBand, &event.CohortCode); err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

// loadLadders builds one ladder per given flag from the live rows, in the order given.
func loadLadders(ctx context.Context, tx *sql.Tx, flags []Flag, now int) ([]*Ladder, error) {
	cohorts, err := loadCohorts(ctx, tx)
	if err != nil {
		return nil, err
	}
	promotions, err := loadPromotions(ctx, tx)
	if err != nil {
		return nil, err
	}
	events, err := loadAdverseEvents(ctx, tx)
	if err != nil {
		return nil, err
	}
	ladders := make([]*Ladder, 0, len(flags))
	for _, flag := range flags {
		ladder := &Ladder{Flag: flag, Cohorts: cohorts, Now: now}
		for _, promotion := range promotions {
			if promotion.FlagCode == flag.Code {
				ladder.Promotions = append(ladder.Promotions, promotion)
			}
		}
		for _, event := range events {
			if event.FlagCode == flag.Code {
				ladder.Events = append(ladder.Events, event)
			}
		}
		ladders = append(ladders, ladder)
	}
	return ladders, nil
}

func loadLadder(ctx context.Context, tx *sql.Tx, flag Flag, now int) (*Ladder, error) {
	ladders, err := loadLadders(ctx, tx, []Flag{flag}, now)
	if err != nil {
		return nil, err
	}
	return ladders[0], nil
}

// nextPromotionCode assigns the next sequence number. The advisory lock is held until the
// transaction ends, so numbers follow commit order and a rolled back request consumes none.
func nextPromotionCode(ctx context.Context, tx *sql.Tx) (string, int, error) {
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock($1, 0)`, lockPromotionCode); err != nil {
		return "", 0, err
	}
	var sequence int
	if err := tx.QueryRowContext(ctx, `SELECT coalesce(max(sequence_number), 0) + 1 FROM promotion`).Scan(&sequence); err != nil {
		return "", 0, err
	}
	return fmt.Sprintf("PRM-%02d", sequence), sequence, nil
}

// insertPromotion stores the row; it reports false when another promotion already used its reference.
func insertPromotion(ctx context.Context, tx *sql.Tx, promotion Promotion) (bool, error) {
	result, err := tx.ExecContext(ctx, `INSERT INTO promotion (promotion_code, sequence_number, flag_code, cohort_code, promoted_at_minutes, demoted_at_minutes, attestation_reference)
		VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (attestation_reference) DO NOTHING`,
		promotion.Code, promotion.Sequence, promotion.FlagCode, promotion.CohortCode, promotion.PromotedAt, promotion.DemotedAt, promotion.AttestationReference)
	if err != nil {
		return false, err
	}
	inserted, err := result.RowsAffected()
	return inserted == 1, err
}

// insertAdverseEvent stores the event; it reports false when the code was already recorded.
func insertAdverseEvent(ctx context.Context, tx *sql.Tx, event AdverseEvent) (bool, error) {
	result, err := tx.ExecContext(ctx, `INSERT INTO adverse_event (event_code, device_code, flag_code, occurred_at_minutes, severity_band_code)
		VALUES ($1, $2, $3, $4, $5) ON CONFLICT (event_code) DO NOTHING`,
		event.Code, event.DeviceCode, event.FlagCode, event.OccurredAt, event.SeverityBand)
	if err != nil {
		return false, err
	}
	inserted, err := result.RowsAffected()
	return inserted == 1, err
}

func demotePromotion(ctx context.Context, tx *sql.Tx, promotionCode string, instant int) error {
	_, err := tx.ExecContext(ctx, `UPDATE promotion SET demoted_at_minutes = $1 WHERE promotion_code = $2 AND demoted_at_minutes IS NULL`, instant, promotionCode)
	return err
}

// reassess runs the breach cascade for one locked flag and records each demotion once.
func reassess(ctx context.Context, tx *sql.Tx, ladder *Ladder) error {
	for offset, promotion := range ladder.cascadeDemotions() {
		if err := demotePromotion(ctx, tx, promotion.Code, ladder.Now+offset); err != nil {
			return err
		}
	}
	return nil
}

func attestationUsed(ctx context.Context, tx *sql.Tx, reference string) (bool, error) {
	var used bool
	err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM promotion WHERE attestation_reference = $1)`, reference).Scan(&used)
	return used, err
}

func eventRecorded(ctx context.Context, tx *sql.Tx, code string) (bool, error) {
	var recorded bool
	err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM adverse_event WHERE event_code = $1)`, code).Scan(&recorded)
	return recorded, err
}

func findDevice(ctx context.Context, tx *sql.Tx, code string) (*Device, error) {
	if strings.ContainsRune(code, 0) {
		return nil, nil
	}
	var device Device
	err := tx.QueryRowContext(ctx, `SELECT device_code, cohort_code, serial_reference, firmware_version_label FROM device WHERE device_code = $1`, code).
		Scan(&device.Code, &device.CohortCode, &device.SerialReference, &device.FirmwareVersion)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &device, nil
}
