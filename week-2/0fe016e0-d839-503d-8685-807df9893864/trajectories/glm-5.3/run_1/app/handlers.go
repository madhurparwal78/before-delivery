package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"sync/atomic"

	"github.com/lib/pq"
)

// app serves the pages and the JSON API from one origin.
type app struct {
	svc   *service
	db    *sql.DB
	ready atomic.Bool
}

const maxBodyBytes = 16384

// wholeNumberRegexp matches a JSON number written with no fraction part and
// no exponent.
var wholeNumberRegexp = regexp.MustCompile(`^-?[0-9]+$`)

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// writeDomainErr renders the one consistent error shape. It never carries a
// stack trace or database error text.
func (a *app) writeDomainErr(w http.ResponseWriter, err *domainErr) {
	switch {
	case err == nil:
		writeError(w, 500, "internal error")
	case err.status == 503:
		writeError(w, 503, "database unavailable")
	case err.fields != nil:
		writeJSON(w, 422, map[string]any{"errors": err.fields})
	case err.rule != "":
		body := map[string]any{"error": err.message, "rule": err.rule}
		for k, v := range err.extra {
			body[k] = v
		}
		writeJSON(w, 409, body)
	default:
		writeError(w, err.status, err.message)
	}
}

// classifyErr maps an error to the published answers: a lost race to its
// 422, an unreachable store to 503, anything else to a plain 500 that never
// carries a stack trace or database error text.
func (a *app) classifyErr(err error) *domainErr {
	if err == nil {
		return nil
	}
	var pqErr *pq.Error
	if errors.As(err, &pqErr) && string(pqErr.Code) == "23505" {
		switch pqErr.Constraint {
		case "promotion_attestation_reference_key":
			return fieldErrs(map[string]string{"attestation_reference": "has already been used"})
		case "adverse_event_pkey":
			return fieldErrs(map[string]string{"event_code": "has already been recorded"})
		case "promotion_pkey", "promotion_promotion_code_key":
			// Two promotions raced for one sequence number outside the flag
			// step; the loser re-reads under the lock, so this cannot be
			// reached through the API. It is refused, never a 5xx.
			return fieldErrs(map[string]string{"request": "was not accepted"})
		}
	}
	if dbDown(a.db, err) {
		return storeDown()
	}
	return &domainErr{status: 500, message: "internal error"}
}

// writeBoundary enforces the write-route boundary: content type, then size.
// It answers the client itself when the boundary fails.
func writeBoundary(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	if ct := r.Header.Get("Content-Type"); !isJSONContentType(ct) {
		writeError(w, 415, "Content-Type must be application/json")
		return nil, false
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes+1))
	if err != nil {
		writeError(w, 400, "body unreadable")
		return nil, false
	}
	if len(body) > maxBodyBytes {
		writeError(w, 413, "body too large")
		return nil, false
	}
	return body, true
}

func isJSONContentType(ct string) bool {
	parts := strings.SplitN(ct, ";", 2)
	return strings.TrimSpace(parts[0]) == "application/json"
}

// bodyDoc is a strictly decoded write body: a JSON object holding only the
// fields of the route's published request shape, with every failing field
// collected before the single 422 is written.
type bodyDoc struct {
	raw    map[string]json.RawMessage
	fields map[string]string
}

func (b *bodyDoc) fail(field, message string) {
	if b.fields == nil {
		b.fields = map[string]string{}
	}
	if _, seen := b.fields[field]; !seen {
		b.fields[field] = message
	}
}

// parseBody decodes the body against the route's shape. allowed lists the
// accepted fields; required lists the fields that must be present and not
// null.
func parseBody(body []byte, allowed map[string]bool, required []string) (*bodyDoc, *domainErr) {
	doc := &bodyDoc{raw: map[string]json.RawMessage{}}
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(body, &obj); err != nil || obj == nil {
		return doc, fieldErrs(map[string]string{"body": "must be a JSON object"})
	}
	for k, v := range obj {
		if !allowed[k] {
			doc.fail(k, "is not an accepted field")
			continue
		}
		doc.raw[k] = v
	}
	for _, f := range required {
		v, present := doc.raw[f]
		if !present || string(v) == "null" {
			doc.fail(f, "is required")
		}
	}
	if len(doc.fields) > 0 {
		return doc, fieldErrs(doc.fields)
	}
	return doc, nil
}

func (b *bodyDoc) string(field string) *string {
	v, ok := b.raw[field]
	if !ok {
		return nil
	}
	var s string
	if err := json.Unmarshal(v, &s); err != nil {
		return nil
	}
	return &s
}

// wholeNumber reads a JSON number written with no fraction part and no
// exponent, or nil when the value is not one.
func (b *bodyDoc) wholeNumber(field string) *int64 {
	v, ok := b.raw[field]
	if !ok {
		return nil
	}
	return asInt(v)
}

// asInt reports whether the raw value is a whole number and returns it.
func asInt(v json.RawMessage) *int64 {
	if v == nil || !wholeNumberRegexp.Match(v) {
		return nil
	}
	var n int64
	if err := json.Unmarshal(v, &n); err != nil {
		return nil
	}
	return &n
}

func (a *app) handleHealth(w http.ResponseWriter, r *http.Request) {
	if !a.ready.Load() || a.db.Ping() != nil {
		writeJSON(w, 503, map[string]string{"status": "unavailable"})
		return
	}
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

// ---- JSON record shapes ----

type flagJSON struct {
	FlagCode         string `json:"flag_code"`
	FlagLabel        string `json:"flag_label"`
	RiskClassCode    string `json:"risk_class_code"`
	MaxAdverseRateBp int    `json:"max_adverse_rate_bp"`
}

type cohortJSON struct {
	CohortCode     string `json:"cohort_code"`
	RungIndexCount int    `json:"rung_index_count"`
	CohortLabel    string `json:"cohort_label"`
	DeviceCount    int    `json:"device_count"`
	MinSoakMinutes int    `json:"min_soak_minutes"`
}

type deviceJSON struct {
	DeviceCode           string `json:"device_code"`
	CohortCode           string `json:"cohort_code"`
	SerialReference      string `json:"serial_reference"`
	FirmwareVersionLabel string `json:"firmware_version_label"`
}

type promotionJSON struct {
	PromotionCode        string  `json:"promotion_code"`
	FlagCode             string  `json:"flag_code"`
	CohortCode           string  `json:"cohort_code"`
	PromotedAtMinutes    int64   `json:"promoted_at_minutes"`
	DemotedAtMinutes     *int64  `json:"demoted_at_minutes"`
	AttestationReference *string `json:"attestation_reference"`
}

func promotionToJSON(p *promotionRow) promotionJSON {
	return promotionJSON{
		PromotionCode:        p.promotionCode,
		FlagCode:             p.flagCode,
		CohortCode:           p.cohortCode,
		PromotedAtMinutes:    p.promotedAtMinutes,
		DemotedAtMinutes:     p.demotedAtMinutes,
		AttestationReference: p.attestationReference,
	}
}

func marshalPromotion(p *promotionRow) string {
	b, err := json.Marshal(promotionToJSON(p))
	if err != nil {
		return "{}"
	}
	return string(b)
}

type eventJSON struct {
	EventCode         string `json:"event_code"`
	DeviceCode        string `json:"device_code"`
	FlagCode          string `json:"flag_code"`
	OccurredAtMinutes int64  `json:"occurred_at_minutes"`
	SeverityBandCode  string `json:"severity_band_code"`
}

type evidencePackJSON struct {
	PackCode                     string `json:"pack_code"`
	FlagCode                     string `json:"flag_code"`
	HighestRungIndexCount        int    `json:"highest_rung_index_count"`
	GapRungIndexCounts           []int  `json:"gap_rung_index_counts"`
	SoakSatisfiedRungIndexCounts []int  `json:"soak_satisfied_rung_index_counts"`
	RateSatisfiedRungIndexCounts []int  `json:"rate_satisfied_rung_index_counts"`
}

type rungJSON struct {
	RungIndexCount       int     `json:"rung_index_count"`
	CohortCode           string  `json:"cohort_code"`
	CohortLabel          string  `json:"cohort_label"`
	MinSoakMinutes       int     `json:"min_soak_minutes"`
	DeviceCount          int     `json:"device_count"`
	State                string  `json:"state"`
	Attested             bool    `json:"attested"`
	PromotionCode        *string `json:"promotion_code"`
	PromotedAtMinutes    *int64  `json:"promoted_at_minutes"`
	DemotedAtMinutes     *int64  `json:"demoted_at_minutes"`
	AttestationReference *string `json:"attestation_reference"`
	SoakElapsedMinutes   *int    `json:"soak_elapsed_minutes"`
	EventCount           int     `json:"event_count"`
	RateBp               int     `json:"rate_bp"`
	MaxAdverseRateBp     int     `json:"max_adverse_rate_bp"`
}

type flagDetailJSON struct {
	FlagCode              string     `json:"flag_code"`
	FlagLabel             string     `json:"flag_label"`
	RiskClassCode         string     `json:"risk_class_code"`
	MaxAdverseRateBp      int        `json:"max_adverse_rate_bp"`
	HighestRungIndexCount int        `json:"highest_rung_index_count"`
	Rungs                 []rungJSON `json:"rungs"`
}

func (a *app) flagDetail(snap *stateSnapshot) flagDetailJSON {
	detail := flagDetailJSON{
		FlagCode:              snap.flag.flagCode,
		FlagLabel:             snap.flag.flagLabel,
		RiskClassCode:         snap.flag.riskClassCode,
		MaxAdverseRateBp:      snap.flag.maxAdverseRateBp,
		HighestRungIndexCount: snap.highestActiveRung(),
		Rungs:                 make([]rungJSON, 0, len(snap.cohorts)),
	}
	for _, c := range snap.cohorts {
		p := snap.latest(c.cohortCode)
		r := rungJSON{
			RungIndexCount:   c.rungIndexCount,
			CohortCode:       c.cohortCode,
			CohortLabel:      c.cohortLabel,
			MinSoakMinutes:   c.minSoakMinutes,
			DeviceCount:      c.deviceCount,
			State:            snap.stateWord(c.cohortCode),
			Attested:         snap.attested(c.cohortCode),
			EventCount:       snap.eventCount(c.cohortCode),
			RateBp:           snap.rateBp(c.cohortCode),
			MaxAdverseRateBp: snap.flag.maxAdverseRateBp,
		}
		if p != nil {
			code := p.promotionCode
			r.PromotionCode = &code
			r.PromotedAtMinutes = &p.promotedAtMinutes
			r.DemotedAtMinutes = p.demotedAtMinutes
			r.AttestationReference = p.attestationReference
		}
		r.SoakElapsedMinutes = snap.soakElapsed(c.cohortCode)
		detail.Rungs = append(detail.Rungs, r)
	}
	return detail
}

// evidencePackRecords builds every flag's pack in flag_code order.
func (a *app) evidencePackRecords() ([]evidencePackJSON, error) {
	flags, err := loadFlags(a.db)
	if err != nil {
		return nil, err
	}
	out := make([]evidencePackJSON, 0, len(flags))
	for _, f := range flags {
		snap, err := loadFlagSnapshot(a.db, f.flagCode, a.svc.clock.now())
		if err != nil {
			return nil, err
		}
		out = append(out, evidencePackJSON{
			PackCode:                     "PACK-" + f.flagCode,
			FlagCode:                     f.flagCode,
			HighestRungIndexCount:        snap.highestActiveRung(),
			GapRungIndexCounts:           withEmptyList(snap.gapRungs()),
			SoakSatisfiedRungIndexCounts: withEmptyList(snap.soakSatisfiedRungs()),
			RateSatisfiedRungIndexCounts: withEmptyList(snap.rateSatisfiedRungs()),
		})
	}
	return out, nil
}

func withEmptyList(v []int) []int {
	if v == nil {
		return []int{}
	}
	return v
}

// ---- list routes ----

func (a *app) handleFlagList(w http.ResponseWriter, r *http.Request) {
	flags, err := loadFlags(a.db)
	if err != nil {
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	out := make([]flagJSON, 0, len(flags))
	for _, f := range flags {
		out = append(out, flagJSON{f.flagCode, f.flagLabel, f.riskClassCode, f.maxAdverseRateBp})
	}
	writeJSON(w, 200, out)
}

func (a *app) handleCohortList(w http.ResponseWriter, r *http.Request) {
	cohorts, err := loadCohorts(a.db)
	if err != nil {
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	sort.Slice(cohorts, func(i, j int) bool { return cohorts[i].cohortCode < cohorts[j].cohortCode })
	out := make([]cohortJSON, 0, len(cohorts))
	for _, c := range cohorts {
		out = append(out, cohortJSON{c.cohortCode, c.rungIndexCount, c.cohortLabel, c.deviceCount, c.minSoakMinutes})
	}
	writeJSON(w, 200, out)
}

func (a *app) handleDeviceList(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.Query(`SELECT device_code, cohort_code, serial_reference, firmware_version_label FROM device ORDER BY device_code`)
	if err != nil {
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	defer rows.Close()
	out := []deviceJSON{}
	for rows.Next() {
		var d deviceJSON
		if err := rows.Scan(&d.DeviceCode, &d.CohortCode, &d.SerialReference, &d.FirmwareVersionLabel); err != nil {
			a.writeDomainErr(w, a.classifyErr(err))
			return
		}
		out = append(out, d)
	}
	if err := rows.Err(); err != nil {
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	writeJSON(w, 200, out)
}

func (a *app) handleEventList(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.Query(`SELECT event_code, device_code, flag_code, occurred_at_minutes, severity_band_code FROM adverse_event ORDER BY event_code`)
	if err != nil {
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	defer rows.Close()
	out := []eventJSON{}
	for rows.Next() {
		var e eventJSON
		if err := rows.Scan(&e.EventCode, &e.DeviceCode, &e.FlagCode, &e.OccurredAtMinutes, &e.SeverityBandCode); err != nil {
			a.writeDomainErr(w, a.classifyErr(err))
			return
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	writeJSON(w, 200, out)
}

func (a *app) handlePromotionList(w http.ResponseWriter, r *http.Request) {
	flagCode := r.URL.Query().Get("flag_code")
	var rows []promotionRow
	var err error
	if flagCode == "" {
		rows, err = loadPromotions(a.db, `SELECT sequence_number, promotion_code, flag_code, cohort_code, promoted_at_minutes, demoted_at_minutes, attestation_reference FROM promotion ORDER BY sequence_number`)
	} else {
		var snap *stateSnapshot
		snap, err = loadFlagSnapshot(a.db, flagCode, a.svc.clock.now())
		if err == nil && snap == nil {
			writeError(w, 404, "unknown flag")
			return
		}
		if err == nil {
			rows, err = loadPromotions(a.db, `SELECT sequence_number, promotion_code, flag_code, cohort_code, promoted_at_minutes, demoted_at_minutes, attestation_reference FROM promotion WHERE flag_code = $1 ORDER BY promoted_at_minutes, sequence_number`, flagCode)
		}
	}
	if err != nil {
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	out := make([]promotionJSON, 0, len(rows))
	for i := range rows {
		out = append(out, promotionToJSON(&rows[i]))
	}
	writeJSON(w, 200, out)
	if flagCode != "" {
		a.svc.recordReadJourney("flag_promotions")
	}
}

func (a *app) handleEvidencePackList(w http.ResponseWriter, r *http.Request) {
	packs, err := a.evidencePackRecords()
	if err != nil {
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	writeJSON(w, 200, packs)
	a.svc.recordReadJourney("evidence_pack")
}

func (a *app) handleFlagDetailRoute(w http.ResponseWriter, r *http.Request) {
	flagCode := r.PathValue("flag_code")
	snap, err := loadFlagSnapshot(a.db, flagCode, a.svc.clock.now())
	if err != nil {
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	if snap == nil {
		writeError(w, 404, "unknown flag")
		return
	}
	writeJSON(w, 200, a.flagDetail(snap))
	a.svc.recordReadJourney("flag_detail")
}

func (a *app) handleSummary(w http.ResponseWriter, r *http.Request, entity string) {
	var n int
	if err := a.db.QueryRow(`SELECT count(*) FROM ` + entity).Scan(&n); err != nil {
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	writeJSON(w, 200, map[string]int{"total": n})
}

// ---- idempotency ----

// lookupIdempotency returns a stored response for the key when the route
// and the parsed body match, and reports a mismatch otherwise.
func lookupIdempotency(tx *sql.Tx, key, route, body string) (storedRoute string, status int, payload string, found bool, mismatch bool, err error) {
	var reqBody string
	err = tx.QueryRow(`SELECT route, request_body, status, response_body FROM idempotency_record WHERE idempotency_key = $1`, key).
		Scan(&storedRoute, &reqBody, &status, &payload)
	if err == sql.ErrNoRows {
		return "", 0, "", false, false, nil
	}
	if err != nil {
		return "", 0, "", false, false, err
	}
	if storedRoute != route || !jsonEqual(reqBody, body) {
		return "", 0, "", false, true, nil
	}
	return storedRoute, status, payload, true, false, nil
}

// storeIdempotency records a 200 or 201 response under its key. It runs in
// the same transaction as the write, so a rolled back write stores nothing.
func storeIdempotency(tx *sql.Tx, key, route, body string, status int, payload string) error {
	_, err := tx.Exec(`INSERT INTO idempotency_record (idempotency_key, route, request_body, status, response_body) VALUES ($1,$2,$3,$4,$5)`,
		key, route, body, status, payload)
	return err
}

// ---- promotion write routes ----

// promotionRequest is one promotion write, shared by the standard promotion
// and the force-enable control.
type promotionRequest struct {
	route           string
	allowed         map[string]bool
	required        []string
	skipAttestation bool
}

func (a *app) handlePromotionWrite(w http.ResponseWriter, r *http.Request, req promotionRequest) {
	body, ok := writeBoundary(w, r)
	if !ok {
		return
	}
	doc, ferr := parseBody(body, req.allowed, req.required)
	if ferr != nil {
		a.writeDomainErr(w, ferr)
		return
	}
	key := r.Header.Get("Idempotency-Key")
	if key != "" && !validIdempotencyKey(key) {
		a.writeDomainErr(w, fieldErrs(map[string]string{"idempotency_key": "must be 1 to 64 letters, digits, hyphens or underscores"}))
		return
	}
	flagCode := docCode(doc, "flag_code")
	cohortCode := docCode(doc, "cohort_code")
	var reference *string
	if !req.skipAttestation {
		reference = doc.string("attestation_reference")
		// A reference that is present, not null and not a string is a
		// format failure, decided before any gate.
		if reference == nil {
			if raw, present := doc.raw["attestation_reference"]; present && string(raw) != "null" {
				a.writeDomainErr(w, fieldErrs(map[string]string{"attestation_reference": "must be 1 to 64 printable characters"}))
				return
			}
		}
	}
	var payload string
	var derrOut *domainErr
	var replayed *storedReplay
	err := a.svc.withFlagLocks([]string{flagCode}, func(tx *sql.Tx) error {
		if key != "" {
			if _, err := tx.Exec(`SELECT pg_advisory_xact_lock($1)`, idemLockID(key)); err != nil {
				return err
			}
			_, status, storedPayload, found, mismatch, err := lookupIdempotency(tx, key, req.route, string(body))
			if err != nil {
				return err
			}
			if found {
				replayed = &storedReplay{status: status, payload: storedPayload}
				return nil
			}
			if mismatch {
				derrOut = fieldErrs(map[string]string{"idempotency_key": "was used with a different request"})
				return errRefuseTx
			}
		}
		p, derr, err := a.promoteValidated(tx, flagCode, cohortCode, reference, req.skipAttestation)
		if err != nil {
			return err
		}
		if derr != nil {
			derrOut = derr
			return errRefuseTx
		}
		payload = marshalPromotion(p)
		if key != "" {
			if err := storeIdempotency(tx, key, req.route, string(body), 201, payload); err != nil {
				return err
			}
		}
		return nil
	})
	if err == errRefuseTx {
		a.writeDomainErr(w, derrOut)
		return
	}
	if err != nil {
		if a.redLineResponse(w, err) {
			return
		}
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	if replayed != nil {
		w.Header().Set("Idempotent-Replayed", "true")
		writeRaw(w, replayed.status, replayed.payload)
		return
	}
	writeRaw(w, 201, payload)
}

type storedReplay struct {
	status  int
	payload string
}

func writeRaw(w http.ResponseWriter, status int, payload string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(payload))
}

// docCode reads a code field as a string, or "" when it is not one.
func docCode(doc *bodyDoc, field string) string {
	if v := doc.string(field); v != nil {
		return *v
	}
	return ""
}

// redLineResponse answers a refused never-state write and records it in the
// ledger. Because the gates refuse such writes first, it is never reached
// through the API and the ledger stays empty.
func (a *app) redLineResponse(w http.ResponseWriter, err error) bool {
	var rl *redLineAbort
	if !errors.As(err, &rl) {
		return false
	}
	a.recordLedger(rl.redLine, rl.detail)
	writeJSON(w, 409, map[string]any{
		"error": "Refused: the write would break " + rl.redLine + ".",
		"rule":  rl.redLine,
	})
	return true
}

// promoteValidated collects the state-dependent field errors, then runs the
// gate. It returns the new promotion row, or the first failure.
func (a *app) promoteValidated(tx *sql.Tx, flagCode, cohortCode string, reference *string, skipAttestation bool) (*promotionRow, *domainErr, error) {
	snap, err := loadFlagSnapshot(tx, flagCode, a.svc.clock.now())
	if err != nil {
		return nil, nil, err
	}
	fields := map[string]string{}
	if snap == nil {
		fields["flag_code"] = "is not a known flag"
	}
	cohorts, err := loadCohorts(tx)
	if err != nil {
		return nil, nil, err
	}
	cohortRung := 0
	knownCohort := false
	for _, c := range cohorts {
		if c.cohortCode == cohortCode {
			cohortRung = c.rungIndexCount
			knownCohort = true
		}
	}
	if !knownCohort {
		fields["cohort_code"] = "is not a known cohort"
	} else if snap != nil && snap.activePromotion(cohortCode) != nil {
		// The already-active check runs inside the flag's serialised step,
		// so of simultaneous promotions to one rung exactly one succeeds.
		fields["cohort_code"] = fmt.Sprintf("rung %d is already active", cohortRung)
	}
	if !skipAttestation && reference != nil {
		trimmed := trimReference(*reference)
		if trimmed != "" {
			if !validReference(trimmed) {
				fields["attestation_reference"] = "must be 1 to 64 printable characters"
			} else if used, err := referenceUsed(tx, trimmed); err != nil {
				return nil, nil, err
			} else if used {
				fields["attestation_reference"] = "has already been used"
			}
		}
	}
	if len(fields) > 0 {
		return nil, fieldErrs(fields), nil
	}
	return a.svc.promote(tx, flagCode, cohortCode, reference, skipAttestation)
}

// errRefuseTx stops a write transaction after a refusal. The refusing path
// has written no domain record, so the transaction commits and keeps only
// its journey trace steps.
var errRefuseTx = errors.New("refused")

func (a *app) handleRollback(w http.ResponseWriter, r *http.Request) {
	body, ok := writeBoundary(w, r)
	if !ok {
		return
	}
	doc, ferr := parseBody(body, map[string]bool{"flag_code": true}, []string{"flag_code"})
	if ferr != nil {
		a.writeDomainErr(w, ferr)
		return
	}
	key := r.Header.Get("Idempotency-Key")
	if key != "" && !validIdempotencyKey(key) {
		a.writeDomainErr(w, fieldErrs(map[string]string{"idempotency_key": "must be 1 to 64 letters, digits, hyphens or underscores"}))
		return
	}
	flagCode := docCode(doc, "flag_code")
	var payload string
	var derrOut *domainErr
	var replayed *storedReplay
	err := a.svc.withFlagLocks([]string{flagCode}, func(tx *sql.Tx) error {
		if key != "" {
			if _, err := tx.Exec(`SELECT pg_advisory_xact_lock($1)`, idemLockID(key)); err != nil {
				return err
			}
			_, status, storedPayload, found, mismatch, err := lookupIdempotency(tx, key, "POST /api/promotion/rollback", string(body))
			if err != nil {
				return err
			}
			if found {
				replayed = &storedReplay{status: status, payload: storedPayload}
				return nil
			}
			if mismatch {
				derrOut = fieldErrs(map[string]string{"idempotency_key": "was used with a different request"})
				return errRefuseTx
			}
		}
		snap, err := loadFlagSnapshot(tx, flagCode, a.svc.clock.now())
		if err != nil {
			return err
		}
		if snap == nil {
			derrOut = fieldErrs(map[string]string{"flag_code": "is not a known flag"})
			return errRefuseTx
		}
		p, derr, err := a.svc.rollback(tx, flagCode)
		if err != nil {
			return err
		}
		if derr != nil {
			derrOut = derr
			return errRefuseTx
		}
		payload = marshalPromotion(p)
		if key != "" {
			if err := storeIdempotency(tx, key, "POST /api/promotion/rollback", string(body), 200, payload); err != nil {
				return err
			}
		}
		return nil
	})
	if err == errRefuseTx {
		a.writeDomainErr(w, derrOut)
		return
	}
	if err != nil {
		if a.redLineResponse(w, err) {
			return
		}
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	if replayed != nil {
		w.Header().Set("Idempotent-Replayed", "true")
		writeRaw(w, replayed.status, replayed.payload)
		return
	}
	writeRaw(w, 200, payload)
}

func (a *app) handleAdverseEvent(w http.ResponseWriter, r *http.Request) {
	body, ok := writeBoundary(w, r)
	if !ok {
		return
	}
	doc, ferr := parseBody(body, map[string]bool{
		"event_code": true, "device_code": true, "flag_code": true,
		"occurred_at_minutes": true, "severity_band_code": true,
	}, []string{"event_code", "device_code", "flag_code", "occurred_at_minutes", "severity_band_code"})
	if ferr != nil {
		a.writeDomainErr(w, ferr)
		return
	}
	eventCode := ""
	if v := doc.string("event_code"); v != nil {
		eventCode = normalizeEventCode(*v)
	}
	deviceCode := docCode(doc, "device_code")
	flagCode := docCode(doc, "flag_code")
	band := docCode(doc, "severity_band_code")
	var occurred *int64
	if n := doc.wholeNumber("occurred_at_minutes"); n != nil {
		occurred = n
	}
	var stored *eventRow
	var derrOut *domainErr
	err := a.svc.withFlagLocks([]string{flagCode}, func(tx *sql.Tx) error {
		fields := map[string]string{}
		if !validEventCode(eventCode) {
			fields["event_code"] = "must be 1 to 32 letters, digits or hyphens"
		} else {
			var n int
			if err := tx.QueryRow(`SELECT count(*) FROM adverse_event WHERE event_code = $1`, eventCode).Scan(&n); err != nil {
				return err
			}
			if n > 0 {
				fields["event_code"] = "has already been recorded"
			}
		}
		var deviceCohort string
		if err := tx.QueryRow(`SELECT cohort_code FROM device WHERE device_code = $1`, deviceCode).Scan(&deviceCohort); err == sql.ErrNoRows {
			fields["device_code"] = "is not a known device"
		} else if err != nil {
			return err
		}
		snap, err := loadFlagSnapshot(tx, flagCode, a.svc.clock.now())
		if err != nil {
			return err
		}
		if snap == nil {
			fields["flag_code"] = "is not a known flag"
		}
		if occurred == nil {
			fields["occurred_at_minutes"] = "must be a whole number of minutes"
		} else if *occurred < 0 || *occurred > a.svc.clock.now() {
			fields["occurred_at_minutes"] = "cannot be in the future"
		}
		if band != "BAND-LOW" && band != "BAND-MED" && band != "BAND-HIGH" {
			fields["severity_band_code"] = "must be BAND-LOW, BAND-MED or BAND-HIGH"
		}
		if len(fields) > 0 {
			derrOut = fieldErrs(fields)
			return errRefuseTx
		}
		e, err := a.svc.recordAdverseEvent(tx, eventCode, deviceCode, flagCode, *occurred, band)
		if err != nil {
			return err
		}
		stored = e
		return nil
	})
	if err == errRefuseTx {
		a.writeDomainErr(w, derrOut)
		return
	}
	if err != nil {
		if a.redLineResponse(w, err) {
			return
		}
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	writeJSON(w, 201, eventJSON{
		EventCode:         stored.eventCode,
		DeviceCode:        stored.deviceCode,
		FlagCode:          stored.flagCode,
		OccurredAtMinutes: stored.occurredAtMinutes,
		SeverityBandCode:  stored.severityBandCode,
	})
}

func (a *app) handlePatchFlag(w http.ResponseWriter, r *http.Request) {
	flagCode := r.PathValue("flag_code")
	body, ok := writeBoundary(w, r)
	if !ok {
		return
	}
	var exists bool
	if err := a.db.QueryRow(`SELECT EXISTS (SELECT 1 FROM capability_flag WHERE flag_code = $1)`, flagCode).Scan(&exists); err != nil {
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	if !exists {
		writeError(w, 404, "unknown flag")
		return
	}
	doc, ferr := parseBody(body, map[string]bool{"max_adverse_rate_bp": true}, []string{"max_adverse_rate_bp"})
	if ferr != nil {
		a.writeDomainErr(w, ferr)
		return
	}
	value := doc.wholeNumber("max_adverse_rate_bp")
	if value == nil || *value < 0 || *value > 10000 {
		a.writeDomainErr(w, fieldErrs(map[string]string{"max_adverse_rate_bp": "must be a whole number from 0 to 10000"}))
		return
	}
	var updated flagRow
	err := a.svc.withFlagLocks([]string{flagCode}, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`UPDATE capability_flag SET max_adverse_rate_bp = $1 WHERE flag_code = $2`, *value, flagCode); err != nil {
			return err
		}
		// The reassessment runs inside the flag's serialised step, so a
		// saved maximum triggers the breach cascade at once.
		if _, err := a.svc.cascade(tx, flagCode, a.svc.clock.now()); err != nil {
			return err
		}
		if rl, err := checkInvariants(tx, flagCode, a.svc.clock.now()); err != nil {
			return err
		} else if rl != nil {
			return rl
		}
		return tx.QueryRow(`SELECT flag_code, flag_label, risk_class_code, max_adverse_rate_bp FROM capability_flag WHERE flag_code = $1`, flagCode).
			Scan(&updated.flagCode, &updated.flagLabel, &updated.riskClassCode, &updated.maxAdverseRateBp)
	})
	if err != nil {
		if a.redLineResponse(w, err) {
			return
		}
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	writeJSON(w, 200, flagJSON{updated.flagCode, updated.flagLabel, updated.riskClassCode, updated.maxAdverseRateBp})
}

func (a *app) handlePatchCohort(w http.ResponseWriter, r *http.Request) {
	cohortCode := r.PathValue("cohort_code")
	body, ok := writeBoundary(w, r)
	if !ok {
		return
	}
	var exists bool
	if err := a.db.QueryRow(`SELECT EXISTS (SELECT 1 FROM cohort WHERE cohort_code = $1)`, cohortCode).Scan(&exists); err != nil {
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	if !exists {
		writeError(w, 404, "unknown cohort")
		return
	}
	doc, ferr := parseBody(body, map[string]bool{"min_soak_minutes": true}, []string{"min_soak_minutes"})
	if ferr != nil {
		a.writeDomainErr(w, ferr)
		return
	}
	value := doc.wholeNumber("min_soak_minutes")
	if value == nil || *value < 0 || *value > 525600 {
		a.writeDomainErr(w, fieldErrs(map[string]string{"min_soak_minutes": "must be a whole number from 0 to 525600"}))
		return
	}
	flags, err := loadFlags(a.db)
	if err != nil {
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	flagCodes := make([]string, 0, len(flags))
	for _, f := range flags {
		flagCodes = append(flagCodes, f.flagCode)
	}
	var updated cohortRow
	err = a.svc.withFlagLocks(flagCodes, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`UPDATE cohort SET min_soak_minutes = $1 WHERE cohort_code = $2`, *value, cohortCode); err != nil {
			return err
		}
		// A cohort change affects every flag, in a fixed lock order.
		for _, f := range flagCodes {
			if _, err := a.svc.cascade(tx, f, a.svc.clock.now()); err != nil {
				return err
			}
			if rl, err := checkInvariants(tx, f, a.svc.clock.now()); err != nil {
				return err
			} else if rl != nil {
				return rl
			}
		}
		return tx.QueryRow(`SELECT cohort_code, rung_index_count, cohort_label, device_count, min_soak_minutes FROM cohort WHERE cohort_code = $1`, cohortCode).
			Scan(&updated.cohortCode, &updated.rungIndexCount, &updated.cohortLabel, &updated.deviceCount, &updated.minSoakMinutes)
	})
	if err != nil {
		if a.redLineResponse(w, err) {
			return
		}
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	writeJSON(w, 200, cohortJSON{updated.cohortCode, updated.rungIndexCount, updated.cohortLabel, updated.deviceCount, updated.minSoakMinutes})
}

// ---- journey traces ----

func (a *app) handleJourneyEvents(w http.ResponseWriter, r *http.Request, journey string) {
	rows, err := a.db.Query(`SELECT step_name, at_minutes FROM journey_step WHERE journey_code = $1 ORDER BY step_number`, journey)
	if err != nil {
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	defer rows.Close()
	type step struct {
		Name      string `json:"name"`
		AtMinutes int64  `json:"at_minutes"`
	}
	out := []step{}
	for rows.Next() {
		var s step
		if err := rows.Scan(&s.Name, &s.AtMinutes); err != nil {
			a.writeDomainErr(w, a.classifyErr(err))
			return
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	writeJSON(w, 200, out)
}
