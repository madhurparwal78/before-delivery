package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// domainErr is the single error shape used across the API. Exactly one of
// rule, fields or down is set. A refused request returns before any write.
type domainErr struct {
	status  int
	rule    string
	message string
	extra   map[string]any
	fields  map[string]string
	down    bool
}

func (e *domainErr) Error() string { return e.message }

func refusal(rule, message string, extra map[string]any) *domainErr {
	return &domainErr{status: 409, rule: rule, message: message, extra: extra}
}

func fieldErrs(fields map[string]string) *domainErr {
	return &domainErr{status: 422, fields: fields}
}

func storeDown() *domainErr {
	return &domainErr{status: 503, message: "database unavailable", down: true}
}

// serverClock is the one clock. Every instant is a whole number of minutes
// since 1970-01-01 00:00 UTC on the server clock.
type serverClock struct{}

// clockOverrideSeconds, when set, replaces the live clock. It exists so the
// documented journeys can be exercised deterministically; it is empty in
// normal operation.
var clockOverrideSeconds int64

func init() {
	if v := os.Getenv("RUNGL_CLOCK_OVERRIDE_SECONDS"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			clockOverrideSeconds = n
		}
	}
}

func (serverClock) now() int64 {
	if clockOverrideSeconds != 0 {
		return clockOverrideSeconds / 60
	}
	return time.Now().UTC().Unix() / 60
}

// trimReference trims spaces, tabs, carriage returns and line feeds. This is
// the one attestation normalisation.
func trimReference(s string) string {
	return strings.Trim(s, " \t\r\n")
}

// normalizeEventCode trims then upper-cases. This is the one event code
// normalisation, applied before every check.
func normalizeEventCode(s string) string {
	return strings.ToUpper(trimReference(s))
}

func validEventCode(s string) bool {
	if len(s) < 1 || len(s) > 32 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if !(c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-') {
			return false
		}
	}
	return true
}

// validReference reports whether the trimmed reference is 1 to 64 printable
// ASCII characters, counted as characters.
func validReference(s string) bool {
	if len(s) < 1 || len(s) > 64 {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < ' ' || s[i] > '~' {
			return false
		}
	}
	return true
}

func validIdempotencyKey(k string) bool {
	if len(k) < 1 || len(k) > 64 {
		return false
	}
	for i := 0; i < len(k); i++ {
		c := k[i]
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}

// loadFlagSnapshot reads one flag's whole ladder from one querier, so read
// paths, the gate and the console share exactly one derivation.
func loadFlagSnapshot(q querier, flagCode string, now int64) (*stateSnapshot, error) {
	var f flagRow
	err := q.QueryRow(`SELECT flag_code, flag_label, risk_class_code, max_adverse_rate_bp FROM capability_flag WHERE flag_code = $1`, flagCode).
		Scan(&f.flagCode, &f.flagLabel, &f.riskClassCode, &f.maxAdverseRateBp)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	cohorts, err := loadCohorts(q)
	if err != nil {
		return nil, err
	}
	promos, err := loadPromotions(q, `SELECT sequence_number, promotion_code, flag_code, cohort_code, promoted_at_minutes, demoted_at_minutes, attestation_reference FROM promotion WHERE flag_code = $1`, flagCode)
	if err != nil {
		return nil, err
	}
	events, err := loadEvents(q, `SELECT e.event_code, e.device_code, d.cohort_code, e.flag_code, e.occurred_at_minutes, e.severity_band_code
		FROM adverse_event e JOIN device d ON d.device_code = e.device_code
		WHERE e.flag_code = $1`, flagCode)
	if err != nil {
		return nil, err
	}
	return buildStateSnapshot(f, cohorts, promos, events, now), nil
}

func loadCohorts(q querier) ([]cohortRow, error) {
	rows, err := q.Query(`SELECT cohort_code, rung_index_count, cohort_label, device_count, min_soak_minutes FROM cohort`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []cohortRow
	for rows.Next() {
		var c cohortRow
		if err := rows.Scan(&c.cohortCode, &c.rungIndexCount, &c.cohortLabel, &c.deviceCount, &c.minSoakMinutes); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func loadPromotions(q querier, query string, args ...any) ([]promotionRow, error) {
	rows, err := q.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []promotionRow
	for rows.Next() {
		var p promotionRow
		if err := rows.Scan(&p.sequenceNumber, &p.promotionCode, &p.flagCode, &p.cohortCode, &p.promotedAtMinutes, &p.demotedAtMinutes, &p.attestationReference); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func loadEvents(q querier, query string, args ...any) ([]eventRow, error) {
	rows, err := q.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []eventRow
	for rows.Next() {
		var e eventRow
		if err := rows.Scan(&e.eventCode, &e.deviceCode, &e.cohortCode, &e.flagCode, &e.occurredAtMinutes, &e.severityBandCode); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func loadFlags(q querier) ([]flagRow, error) {
	rows, err := q.Query(`SELECT flag_code, flag_label, risk_class_code, max_adverse_rate_bp FROM capability_flag ORDER BY flag_code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []flagRow
	for rows.Next() {
		var f flagRow
		if err := rows.Scan(&f.flagCode, &f.flagLabel, &f.riskClassCode, &f.maxAdverseRateBp); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// gateOutcome carries the figures a refusal names.
type gateOutcome struct {
	missingRung int
	elapsed     int64
	minimum     int64
	remaining   int64
	rateBp      int
	maxBp       int
}

func (s *stateSnapshot) rungOfCohort(cohortCode string) int {
	for _, c := range s.cohorts {
		if c.cohortCode == cohortCode {
			return c.rungIndexCount
		}
	}
	return 0
}

// decidePromotion runs the gates DP-01 to DP-04, in order, on one flag's
// snapshot. It returns the first failing rule, or "" when the promotion may
// proceed. skipAttestation is the force-enable control: it skips DP-04 only.
func (s *stateSnapshot) decidePromotion(targetCohort string, reference *string, skipAttestation bool) (string, *gateOutcome) {
	target := s.rungOfCohort(targetCohort)
	out := &gateOutcome{maxBp: s.flag.maxAdverseRateBp}
	// DP-01: an active promotion at every rung below the target, rung 1
	// needs none.
	missing := 0
	for r := 1; r < target; r++ {
		if s.activePromotion(s.cohortByRung[r].cohortCode) == nil {
			missing = r
			break
		}
	}
	if missing > 0 {
		out.missingRung = missing
		return "DP-01", out
	}
	if target > 1 {
		below := s.cohortByRung[target-1]
		bp := s.activePromotion(below.cohortCode)
		// DP-02: the rung below's current active promotion has soaked at
		// least its minimum soak minutes, with exactly the minimum allowed,
		// measured on the server clock.
		elapsed := s.now - bp.promotedAtMinutes
		out.elapsed = elapsed
		out.minimum = int64(below.minSoakMinutes)
		out.remaining = out.minimum - elapsed
		if elapsed < int64(below.minSoakMinutes) {
			return "DP-02", out
		}
		// DP-03: the rung below's rate sits at or below the flag maximum.
		out.rateBp = s.rateBp(below.cohortCode)
		if out.rateBp > s.flag.maxAdverseRateBp {
			return "DP-03", out
		}
	}
	if !skipAttestation && (reference == nil || trimReference(*reference) == "") {
		return "DP-04", out
	}
	return "", out
}

func refusalCopy(rule string, target int, o *gateOutcome, flagLabel string) (string, map[string]any) {
	switch rule {
	case "DP-01":
		return fmt.Sprintf("Refused: rung %d needs an active promotion at rung %d first (DP-01).", target, o.missingRung),
			map[string]any{"missing_rung_index_count": o.missingRung}
	case "DP-02":
		return fmt.Sprintf("Refused: rung %d has soaked %d minutes of %d minutes; %d minutes remain (DP-02).", target-1, o.elapsed, o.minimum, o.remaining),
			map[string]any{"elapsed_minutes": o.elapsed, "minimum_minutes": o.minimum, "remaining_minutes": o.remaining}
	case "DP-03":
		return fmt.Sprintf("Refused: rung %d adverse rate is %d basis points, above the maximum of %d basis points (DP-03).", target-1, o.rateBp, o.maxBp),
			map[string]any{"rate_bp": o.rateBp, "max_adverse_rate_bp": o.maxBp}
	case "DP-04":
		return fmt.Sprintf("Refused: an attestation reference is required for rung %d (DP-04).", target), nil
	case "DP-05":
		return fmt.Sprintf("Refused: %s has no active rung to roll back (DP-05).", flagLabel), nil
	}
	return "", nil
}

// service is the domain core. Its write methods run inside one transaction
// per request, taking the per-flag advisory lock first, so a lost race maps
// to its published 422 and never to a 5xx.
type service struct {
	db    *sql.DB
	clock serverClock
}

// withFlagLocks begins a transaction, takes the advisory locks for the given
// flags in the given order, and hands the transaction to fn. A refusal path
// returns errRefuseTx instead of an error: it has written no domain record,
// so the transaction commits and keeps only its journey trace steps.
func (svc *service) withFlagLocks(flagCodes []string, fn func(*sql.Tx) error) error {
	tx, err := svc.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := beginFlagLocks(tx, flagCodes); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		if errors.Is(err, errRefuseTx) {
			// A refusal has written no domain record, so the transaction
			// commits and keeps only its journey trace steps.
			if cerr := tx.Commit(); cerr != nil {
				return cerr
			}
			return errRefuseTx
		}
		return err
	}
	return tx.Commit()
}

// withJourneyLock begins a transaction that holds the global journey lock.
// The journey lock is always taken last among advisory locks, so this
// ordering never cycles.
func (svc *service) withJourneyLock(fn func(*sql.Tx) error) error {
	tx, err := svc.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := takeJourneyLock(tx); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

func takeJourneyLock(tx *sql.Tx) error {
	_, err := tx.Exec(`SELECT pg_advisory_xact_lock($1)`, int64(0x4A524E59))
	return err
}

// referenceUsed reports whether the trimmed reference equals any existing
// promotion row's reference, active or demoted, across every flag.
func referenceUsed(tx *sql.Tx, ref string) (bool, error) {
	var n int
	if err := tx.QueryRow(`SELECT count(*) FROM promotion WHERE attestation_reference = $1`, ref).Scan(&n); err != nil {
		return false, err
	}
	return n > 0, nil
}

// promote runs a standard promotion or a force enable inside the flag's
// serialised step. Field errors and refusals are decided here, before any
// write.
func (svc *service) promote(tx *sql.Tx, flagCode, cohortCode string, reference *string, skipAttestation bool) (*promotionRow, *domainErr, error) {
	now := svc.clock.now()
	snap, err := loadFlagSnapshot(tx, flagCode, now)
	if err != nil {
		return nil, nil, err
	}
	target := snap.rungOfCohort(cohortCode)
	var trimmed *string
	if reference != nil {
		t := trimReference(*reference)
		trimmed = &t
	}
	// Limit and reuse failures are answered before any gate refusal.
	if !skipAttestation && trimmed != nil && *trimmed != "" {
		if !validReference(*trimmed) {
			return nil, fieldErrs(map[string]string{"attestation_reference": "must be 1 to 64 printable characters"}), nil
		}
		used, err := referenceUsed(tx, *trimmed)
		if err != nil {
			return nil, nil, err
		}
		if used {
			return nil, fieldErrs(map[string]string{"attestation_reference": "has already been used"}), nil
		}
	}
	prevHighest := snap.highestActiveRung()
	rule, o := snap.decidePromotion(cohortCode, trimmed, skipAttestation)
	if serr := takeJourneyLock(tx); serr != nil {
		return nil, nil, serr
	}
	if rule != "" {
		// A DP-01 refusal whose target is two or more rungs above the
		// flag's highest active rung starts a new WF-01 run at once.
		if rule == "DP-01" && !skipAttestation && target >= prevHighest+2 {
			if serr := startJourneyRun(tx, "WF-01", now); serr != nil {
				return nil, nil, serr
			}
		}
		// WF-02-1 is recorded for a force enable answered 201 or 409.
		if skipAttestation {
			if serr := appendJourneyStep(tx, "WF-02", "WF-02-1", now); serr != nil {
				return nil, nil, serr
			}
		}
		msg, extra := refusalCopy(rule, target, o, snap.flag.flagLabel)
		return nil, refusal(rule, msg, extra), nil
	}
	seq, err := nextPromotionNumber(tx)
	if err != nil {
		return nil, nil, err
	}
	p := &promotionRow{
		sequenceNumber:    seq,
		promotionCode:     promotionCode(seq),
		flagCode:          flagCode,
		cohortCode:        cohortCode,
		promotedAtMinutes: now,
	}
	if !skipAttestation {
		p.attestationReference = trimmed
	}
	if _, err := tx.Exec(`INSERT INTO promotion (sequence_number, promotion_code, flag_code, cohort_code, promoted_at_minutes, demoted_at_minutes, attestation_reference) VALUES ($1,$2,$3,$4,$5,NULL,$6)`,
		p.sequenceNumber, p.promotionCode, p.flagCode, p.cohortCode, p.promotedAtMinutes, p.attestationReference); err != nil {
		return nil, nil, err
	}
	if skipAttestation {
		if serr := appendJourneyStep(tx, "WF-02", "WF-02-1", now); serr != nil {
			return nil, nil, serr
		}
	}
	// WF-01-3: a standard promotion one rung above the highest active rung.
	if !skipAttestation && target == prevHighest+1 {
		if serr := appendJourneyStep(tx, "WF-01", "WF-01-3", now); serr != nil {
			return nil, nil, serr
		}
	}
	if rl, err := checkInvariants(tx, flagCode, now); err != nil {
		return nil, nil, err
	} else if rl != nil {
		return nil, nil, rl
	}
	return p, nil, nil
}

// rollback demotes only the flag's highest active rung and keeps the row.
func (svc *service) rollback(tx *sql.Tx, flagCode string) (*promotionRow, *domainErr, error) {
	now := svc.clock.now()
	snap, err := loadFlagSnapshot(tx, flagCode, now)
	if err != nil {
		return nil, nil, err
	}
	highest := snap.highestActiveRung()
	if highest == 0 {
		msg, _ := refusalCopy("DP-05", 0, &gateOutcome{}, snap.flag.flagLabel)
		return nil, refusal("DP-05", msg, nil), nil
	}
	cohortCode := snap.cohortByRung[highest].cohortCode
	p := snap.activePromotion(cohortCode)
	if _, err := tx.Exec(`UPDATE promotion SET demoted_at_minutes = $1 WHERE promotion_code = $2`, now, p.promotionCode); err != nil {
		return nil, nil, err
	}
	p.demotedAtMinutes = &now
	if serr := takeJourneyLock(tx); serr != nil {
		return nil, nil, serr
	}
	if serr := startJourneyRun(tx, "WF-03", now); serr != nil {
		return nil, nil, serr
	}
	if rl, err := checkInvariants(tx, flagCode, now); err != nil {
		return nil, nil, err
	} else if rl != nil {
		return nil, nil, rl
	}
	return p, nil, nil
}

// recordAdverseEvent stores one event, records the breach journey step and
// runs the breach cascade on the event's flag, all in the same serialised
// step.
func (svc *service) recordAdverseEvent(tx *sql.Tx, code, deviceCode, flagCode string, occurred int64, band string) (*eventRow, error) {
	now := svc.clock.now()
	if _, err := tx.Exec(`INSERT INTO adverse_event (event_code, device_code, flag_code, occurred_at_minutes, severity_band_code) VALUES ($1,$2,$3,$4,$5)`,
		code, deviceCode, flagCode, occurred, band); err != nil {
		return nil, err
	}
	if serr := takeJourneyLock(tx); serr != nil {
		return nil, serr
	}
	if serr := svc.maybeRecordBreachJourney(tx, flagCode, deviceCode, now); serr != nil {
		return nil, serr
	}
	if _, err := svc.cascade(tx, flagCode, now); err != nil {
		return nil, err
	}
	if rl, err := checkInvariants(tx, flagCode, now); err != nil {
		return nil, err
	} else if rl != nil {
		return nil, rl
	}
	return &eventRow{
		eventCode:         code,
		deviceCode:        deviceCode,
		flagCode:          flagCode,
		occurredAtMinutes: occurred,
		severityBandCode:  band,
	}, nil
}

// maybeRecordBreachJourney appends WF-04-1 when the new event moves its own
// rung's rate from at or below the flag maximum to above it. An event on a
// rung already above the maximum does not record it.
func (svc *service) maybeRecordBreachJourney(tx *sql.Tx, flagCode, deviceCode string, now int64) error {
	snap, err := loadFlagSnapshot(tx, flagCode, now)
	if err != nil {
		return err
	}
	deviceCohort := snap.deviceCohort(deviceCode)
	if deviceCohort == "" {
		return nil
	}
	after := snap.rateBp(deviceCohort)
	if after <= snap.flag.maxAdverseRateBp {
		return nil
	}
	c := snap.cohortOf(deviceCohort)
	if c == nil || c.deviceCount == 0 {
		return nil
	}
	without := (snap.eventCount(deviceCohort) - 1) * 10000 / c.deviceCount
	if without > snap.flag.maxAdverseRateBp {
		return nil
	}
	return appendJourneyStep(tx, "WF-04", "WF-04-1", now)
}

// deviceCohort resolves a device's cohort inside this snapshot's event set.
func (s *stateSnapshot) deviceCohort(deviceCode string) string {
	for _, e := range s.events {
		if e.deviceCode == deviceCode {
			return e.cohortCode
		}
	}
	return ""
}

// cohortOf finds the cohort row in this snapshot.
func (s *stateSnapshot) cohortOf(cohortCode string) *cohortRow {
	for i := range s.cohorts {
		if s.cohorts[i].cohortCode == cohortCode {
			return &s.cohorts[i]
		}
	}
	return nil
}

// cascade is the one breach cascade. It demotes every active rung above the
// lowest breaching rung, highest first, each exactly once with its own
// instant: the highest takes now and each lower one takes the next minute
// after the one above it. The breaching rung itself stays active.
func (svc *service) cascade(tx *sql.Tx, flagCode string, now int64) (bool, error) {
	snap, err := loadFlagSnapshot(tx, flagCode, now)
	if err != nil {
		return false, err
	}
	lowestBreach := 0
	for _, c := range snap.cohorts {
		if snap.activePromotion(c.cohortCode) == nil {
			continue
		}
		if snap.rateBp(c.cohortCode) > snap.flag.maxAdverseRateBp {
			if lowestBreach == 0 || c.rungIndexCount < lowestBreach {
				lowestBreach = c.rungIndexCount
			}
		}
	}
	if lowestBreach == 0 {
		return false, nil
	}
	demoted := false
	instant := now
	for r := len(snap.cohorts); r > lowestBreach; r-- {
		c := snap.cohortByRung[r]
		p := snap.activePromotion(c.cohortCode)
		if p == nil {
			continue
		}
		if _, err := tx.Exec(`UPDATE promotion SET demoted_at_minutes = $1 WHERE promotion_code = $2 AND demoted_at_minutes IS NULL`, instant, p.promotionCode); err != nil {
			return false, err
		}
		demoted = true
		instant++
	}
	return demoted, nil
}

// journeyStepOrder is each journey's step sequence. A later step is appended
// only when the previous step is the last one recorded.
var journeyStepOrder = map[string][]string{
	"WF-01": {"WF-01-1", "WF-01-2", "WF-01-3", "WF-01-4"},
	"WF-02": {"WF-02-1", "WF-02-2", "WF-02-3"},
	"WF-03": {"WF-03-1", "WF-03-2", "WF-03-3"},
	"WF-04": {"WF-04-1", "WF-04-2", "WF-04-3"},
}

// startJourneyRun begins a new run of a journey: it replaces the trace with
// step 1. A WF-01 run also appends WF-01-2 at once.
func startJourneyRun(tx *sql.Tx, journey string, now int64) error {
	if _, err := tx.Exec(`DELETE FROM journey_step WHERE journey_code = $1`, journey); err != nil {
		return err
	}
	order := journeyStepOrder[journey]
	if _, err := tx.Exec(`INSERT INTO journey_step (journey_code, step_number, step_name, at_minutes) VALUES ($1,$2,$3,$4)`, journey, 1, order[0], now); err != nil {
		return err
	}
	if journey == "WF-01" {
		if _, err := tx.Exec(`INSERT INTO journey_step (journey_code, step_number, step_name, at_minutes) VALUES ($1,$2,$3,$4)`, journey, 2, order[1], now); err != nil {
			return err
		}
	}
	return nil
}

// appendJourneyStep records one step. Step 1 starts a new run, replacing
// the trace; a later step is appended only when the previous step is the
// last one recorded.
func appendJourneyStep(tx *sql.Tx, journey, step string, now int64) error {
	order := journeyStepOrder[journey]
	idx := -1
	for i, name := range order {
		if name == step {
			idx = i
		}
	}
	if idx < 0 {
		return nil
	}
	if idx == 0 {
		return startJourneyRun(tx, journey, now)
	}
	previous := order[idx-1]
	var lastName string
	var lastNumber int
	err := tx.QueryRow(`SELECT step_name, step_number FROM journey_step WHERE journey_code = $1 ORDER BY step_number DESC LIMIT 1`, journey).Scan(&lastName, &lastNumber)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	if lastName != previous || lastNumber != idx {
		return nil
	}
	_, err = tx.Exec(`INSERT INTO journey_step (journey_code, step_number, step_name, at_minutes) VALUES ($1,$2,$3,$4)`, journey, idx+1, step, now)
	return err
}

// recordReadJourney records the read-side journey steps. It runs in its own
// short transaction under the journey lock, so it never interleaves with a
// write path's steps.
func (svc *service) recordReadJourney(kind string) {
	now := svc.clock.now()
	_ = svc.withJourneyLock(func(tx *sql.Tx) error {
		switch kind {
		case "evidence_pack":
			if err := appendJourneyStep(tx, "WF-01", "WF-01-4", now); err != nil {
				return err
			}
			return appendJourneyStep(tx, "WF-02", "WF-02-3", now)
		case "flag_detail":
			if err := appendJourneyStep(tx, "WF-02", "WF-02-2", now); err != nil {
				return err
			}
			if err := appendJourneyStep(tx, "WF-03", "WF-03-2", now); err != nil {
				return err
			}
			return appendJourneyStep(tx, "WF-04", "WF-04-2", now)
		case "flag_promotions":
			if err := appendJourneyStep(tx, "WF-03", "WF-03-3", now); err != nil {
				return err
			}
			return appendJourneyStep(tx, "WF-04", "WF-04-3", now)
		}
		return nil
	})
}

// jsonEqual compares two JSON values, ignoring key order and whitespace. A
// body that is not valid JSON never equals a stored one.
func jsonEqual(a, b string) bool {
	var av, bv any
	if err := json.Unmarshal([]byte(a), &av); err != nil {
		return false
	}
	if err := json.Unmarshal([]byte(b), &bv); err != nil {
		return false
	}
	ab, err := json.Marshal(av)
	if err != nil {
		return false
	}
	bb, err := json.Marshal(bv)
	if err != nil {
		return false
	}
	return string(ab) == string(bb)
}
