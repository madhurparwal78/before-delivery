package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"

	"github.com/jackc/pgx/v5"
)

type journeyMark struct {
	journey string
	steps   []int
}

type writeResult struct {
	status  int
	body    any
	journey []journeyMark
}

type writeRunner func(ctx context.Context, tx pgx.Tx, now int, raw []byte, result *writeResult) error

// runWrite applies the published error precedence to every write route.
func (a *app) runWrite(w http.ResponseWriter, r *http.Request, route string, idempotent bool, runner writeRunner) {
	if !a.ready.Load() {
		writeFailure(w, errDatabaseUnavailable)
		return
	}
	raw, err := readWriteBody(r)
	if err != nil {
		writeFailure(w, err)
		return
	}
	key := ""
	if idempotent {
		key = r.Header.Get("Idempotency-Key")
		if key != "" && !idempotencyKeyWithinLimits(key) {
			writeFailure(w, fieldFailure(fieldErrors{
				"idempotency_key": "must be 1 to 64 letters, digits, hyphens or underscores",
			}))
			return
		}
	}

	ctx, cancel := withTimeout(r.Context())
	defer cancel()
	tx, err := a.store.pool.Begin(ctx)
	if err != nil {
		writeFailure(w, errDatabaseUnavailable)
		return
	}
	defer tx.Rollback(ctx)

	now := nowMinutes()
	if key != "" {
		stored, err := loadIdempotencyRecord(ctx, tx, key)
		if err != nil {
			writeFailure(w, errDatabaseUnavailable)
			return
		}
		if stored != nil {
			if stored.route != route || !sameRequestBody(stored.request, raw) {
				writeFailure(w, fieldFailure(fieldErrors{
					"idempotency_key": "was used with a different request",
				}))
				return
			}
			w.Header().Set("Idempotent-Replayed", "true")
			writeJSON(w, stored.status, json.RawMessage(stored.response))
			return
		}
	}

	result := &writeResult{}
	if runErr := runner(ctx, tx, now, raw, result); runErr != nil {
		tx.Rollback(ctx)
		a.recordJourneyMarks(r.Context(), result.journey, now)
		writeFailure(w, runErr)
		return
	}
	if key != "" {
		if err := saveIdempotencyRecord(ctx, tx, key, route, raw, result.status, result.body); err != nil {
			writeFailure(w, errDatabaseUnavailable)
			return
		}
	}
	if err := tx.Commit(ctx); err != nil {
		writeFailure(w, errDatabaseUnavailable)
		return
	}
	a.recordJourneyMarks(r.Context(), result.journey, now)
	writeJSON(w, result.status, result.body)
}

func stringField(fields map[string]json.RawMessage, name string) string {
	raw, present := fields[name]
	if !present || isJSONNull(raw) {
		return ""
	}
	value, ok := asString(raw)
	if !ok {
		return ""
	}
	return value
}

func nextPromotionCode(ctx context.Context, tx pgx.Tx) (string, error) {
	var sequence int
	err := tx.QueryRow(ctx,
		`UPDATE promotion_counter SET next_sequence_number = next_sequence_number + 1
		 WHERE counter_code = 'PRM' RETURNING next_sequence_number - 1`).Scan(&sequence)
	if err != nil {
		return "", err
	}
	return promotionCodeFor(sequence), nil
}

func (a *app) handlePromote(w http.ResponseWriter, r *http.Request) {
	a.runWrite(w, r, "POST /api/promotion", true, promotionRunner(false))
}

func (a *app) handleForceEnable(w http.ResponseWriter, r *http.Request) {
	a.runWrite(w, r, "POST /api/promotion/force-enable", true, promotionRunner(true))
}

// promotionRunner serves both the standard promotion and the force-enable
// control, which skips DP-04 only.
func promotionRunner(force bool) writeRunner {
	return func(ctx context.Context, tx pgx.Tx, now int, raw []byte, result *writeResult) error {
		allowed := []string{"flag_code", "cohort_code", "attestation_reference"}
		if force {
			allowed = []string{"flag_code", "cohort_code"}
		}
		fields, errors := parseFields(raw, allowed, []string{"flag_code", "cohort_code"})
		if fields == nil {
			return fieldFailure(errors)
		}
		flagCode := stringField(fields, "flag_code")
		cohortCode := stringField(fields, "cohort_code")

		reference := ""
		if raw, present := fields["attestation_reference"]; present && !isJSONNull(raw) && !force {
			text, ok := asString(raw)
			if !ok {
				errors.add("attestation_reference", "must be 1 to 64 printable characters")
			} else {
				reference = trimReference(text)
				if reference != "" && !referenceWithinLimits(reference) {
					errors.add("attestation_reference", "must be 1 to 64 printable characters")
				}
			}
		}

		if flagCode != "" {
			if err := takeLock(ctx, tx, flagLockNamespace, flagCode); err != nil {
				return err
			}
		}
		if reference != "" {
			if err := takeLock(ctx, tx, referenceLockNamespace, reference); err != nil {
				return err
			}
		}
		state, err := readSnapshot(ctx, tx, now)
		if err != nil {
			return err
		}
		flag := state.flagByCode(flagCode)
		if flag == nil {
			errors.add("flag_code", "is not a known flag")
		}
		cohort := state.cohortByCode(cohortCode)
		if cohort == nil {
			errors.add("cohort_code", "is not a known cohort")
		} else if flag != nil && state.activePromotionAtRung(flagCode, cohort.RungIndexCount) != nil {
			errors.add("cohort_code", fmt.Sprintf("rung %d is already active", cohort.RungIndexCount))
		}
		if reference != "" && referenceWithinLimits(reference) && referenceAlreadyUsed(state, reference) {
			errors.add("attestation_reference", "has already been used")
		}
		if errors.any() {
			return fieldFailure(errors)
		}

		rung := cohort.RungIndexCount
		highestActive := state.highestActiveRung(flagCode)
		if refusal := state.checkGates(flagCode, rung, reference, !force); refusal != nil {
			if force {
				result.journey = append(result.journey, journeyMark{"WF-02", []int{1}})
			} else if refusal.Rule == "DP-01" && rung >= highestActive+2 {
				result.journey = append(result.journey, journeyMark{"WF-01", []int{1, 2}})
			}
			return refusalFailure(refusal)
		}

		promotionCode, err := nextPromotionCode(ctx, tx)
		if err != nil {
			return err
		}
		var storedReference *string
		if !force {
			storedReference = &reference
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO promotion (promotion_code, flag_code, cohort_code, promoted_at_minutes, demoted_at_minutes, attestation_reference)
			 VALUES ($1, $2, $3, $4, NULL, $5)`,
			promotionCode, flagCode, cohort.CohortCode, now, storedReference); err != nil {
			return err
		}
		result.status = http.StatusCreated
		result.body = promotionRecord{
			PromotionCode:        promotionCode,
			FlagCode:             flagCode,
			CohortCode:           cohort.CohortCode,
			PromotedAtMinutes:    now,
			AttestationReference: storedReference,
		}
		if force {
			result.journey = append(result.journey, journeyMark{"WF-02", []int{1}})
		} else if rung == highestActive+1 {
			result.journey = append(result.journey, journeyMark{"WF-01", []int{3}})
		}
		return nil
	}
}

func referenceAlreadyUsed(state *snapshot, reference string) bool {
	for _, promotion := range state.promotions {
		if promotion.AttestationReference != nil && *promotion.AttestationReference == reference {
			return true
		}
	}
	return false
}

func (a *app) handleRollback(w http.ResponseWriter, r *http.Request) {
	a.runWrite(w, r, "POST /api/promotion/rollback", true,
		func(ctx context.Context, tx pgx.Tx, now int, raw []byte, result *writeResult) error {
			fields, errors := parseFields(raw, []string{"flag_code"}, []string{"flag_code"})
			if fields == nil {
				return fieldFailure(errors)
			}
			flagCode := stringField(fields, "flag_code")
			if flagCode != "" {
				if err := takeLock(ctx, tx, flagLockNamespace, flagCode); err != nil {
					return err
				}
			}
			state, err := readSnapshot(ctx, tx, now)
			if err != nil {
				return err
			}
			flag := state.flagByCode(flagCode)
			if flag == nil {
				errors.add("flag_code", "is not a known flag")
			}
			if errors.any() {
				return fieldFailure(errors)
			}
			highest := state.highestActiveRung(flagCode)
			if highest == 0 {
				return refusalFailure(&gateRefusal{
					Rule: "DP-05",
					Copy: fmt.Sprintf("Refused: %s has no active rung to roll back (DP-05).", flag.FlagLabel),
				})
			}
			promotion := state.activePromotionAtRung(flagCode, highest)
			if _, err := tx.Exec(ctx,
				`UPDATE promotion SET demoted_at_minutes = $1 WHERE promotion_code = $2`,
				now, promotion.PromotionCode); err != nil {
				return err
			}
			demoted := *promotion
			demotedAt := now
			demoted.DemotedAtMinutes = &demotedAt
			result.status = http.StatusOK
			result.body = demoted
			result.journey = append(result.journey, journeyMark{"WF-03", []int{1}})
			return nil
		})
}

func (a *app) handleAdverseEventCreate(w http.ResponseWriter, r *http.Request) {
	a.runWrite(w, r, "POST /api/adverse_event", false,
		func(ctx context.Context, tx pgx.Tx, now int, raw []byte, result *writeResult) error {
			allowed := []string{"event_code", "device_code", "flag_code", "occurred_at_minutes", "severity_band_code"}
			fields, errors := parseFields(raw, allowed, allowed)
			if fields == nil {
				return fieldFailure(errors)
			}
			eventCode := normaliseEventCode(stringField(fields, "event_code"))
			deviceCode := stringField(fields, "device_code")
			flagCode := stringField(fields, "flag_code")
			severityBand := stringField(fields, "severity_band_code")

			if raw, present := fields["event_code"]; present && !isJSONNull(raw) && !eventCodeWithinLimits(eventCode) {
				errors.add("event_code", "must be 1 to 32 letters, digits or hyphens")
			}
			occurredAt := 0
			if raw, present := fields["occurred_at_minutes"]; present && !isJSONNull(raw) {
				value, ok := asWholeNumber(raw)
				switch {
				case !ok || value < 0:
					errors.add("occurred_at_minutes", "must be a whole number of minutes")
				case value > now:
					errors.add("occurred_at_minutes", "cannot be in the future")
				default:
					occurredAt = value
				}
			}
			if raw, present := fields["severity_band_code"]; present && !isJSONNull(raw) && !isSeverityBand(severityBand) {
				errors.add("severity_band_code", "must be BAND-LOW, BAND-MED or BAND-HIGH")
			}

			if flagCode != "" {
				if err := takeLock(ctx, tx, flagLockNamespace, flagCode); err != nil {
					return err
				}
			}
			if eventCode != "" {
				if err := takeLock(ctx, tx, eventCodeLockNamespace, eventCode); err != nil {
					return err
				}
			}
			state, err := readSnapshot(ctx, tx, now)
			if err != nil {
				return err
			}
			if state.flagByCode(flagCode) == nil {
				errors.add("flag_code", "is not a known flag")
			}
			device := state.deviceByCode(deviceCode)
			if device == nil {
				errors.add("device_code", "is not a known device")
			}
			for _, event := range state.events {
				if event.EventCode == eventCode {
					errors.add("event_code", "has already been recorded")
				}
			}
			if errors.any() {
				return fieldFailure(errors)
			}

			record := adverseEventRecord{
				EventCode:         eventCode,
				DeviceCode:        deviceCode,
				FlagCode:          flagCode,
				OccurredAtMinutes: occurredAt,
				SeverityBandCode:  severityBand,
			}
			if _, err := tx.Exec(ctx,
				`INSERT INTO adverse_event (event_code, device_code, flag_code, occurred_at_minutes, severity_band_code)
				 VALUES ($1, $2, $3, $4, $5)`,
				record.EventCode, record.DeviceCode, record.FlagCode, record.OccurredAtMinutes, record.SeverityBandCode); err != nil {
				return err
			}

			maximum := state.flagByCode(flagCode).MaxAdverseRateBP
			rateBefore := state.rateBP(flagCode, device.CohortCode)
			state.events = append(state.events, record)
			rateAfter := state.rateBP(flagCode, device.CohortCode)
			if rateBefore <= maximum && rateAfter > maximum {
				result.journey = append(result.journey, journeyMark{"WF-04", []int{1}})
			}
			if err := reassessFlag(ctx, tx, state, flagCode); err != nil {
				return err
			}
			result.status = http.StatusCreated
			result.body = record
			return nil
		})
}

func (a *app) handleFlagPatch(w http.ResponseWriter, r *http.Request) {
	flagCode := r.PathValue("flag_code")
	a.runWrite(w, r, "PATCH /api/capability_flag/"+flagCode, false,
		func(ctx context.Context, tx pgx.Tx, now int, raw []byte, result *writeResult) error {
			if err := takeLock(ctx, tx, flagLockNamespace, flagCode); err != nil {
				return err
			}
			state, err := readSnapshot(ctx, tx, now)
			if err != nil {
				return err
			}
			flag := state.flagByCode(flagCode)
			if flag == nil {
				return failure(http.StatusNotFound, "not found")
			}
			fields, errors := parseFields(raw, []string{"max_adverse_rate_bp"}, []string{"max_adverse_rate_bp"})
			if fields == nil {
				return fieldFailure(errors)
			}
			maximum := 0
			if raw, present := fields["max_adverse_rate_bp"]; present && !isJSONNull(raw) {
				value, ok := asWholeNumber(raw)
				if !ok || value < 0 || value > 10000 {
					errors.add("max_adverse_rate_bp", "must be a whole number from 0 to 10000")
				} else {
					maximum = value
				}
			}
			if errors.any() {
				return fieldFailure(errors)
			}
			if _, err := tx.Exec(ctx,
				`UPDATE capability_flag SET max_adverse_rate_bp = $1 WHERE flag_code = $2`,
				maximum, flagCode); err != nil {
				return err
			}
			flag.MaxAdverseRateBP = maximum
			if err := reassessFlag(ctx, tx, state, flagCode); err != nil {
				return err
			}
			result.status = http.StatusOK
			result.body = *flag
			return nil
		})
}

func (a *app) handleCohortPatch(w http.ResponseWriter, r *http.Request) {
	cohortCode := r.PathValue("cohort_code")
	a.runWrite(w, r, "PATCH /api/cohort/"+cohortCode, false,
		func(ctx context.Context, tx pgx.Tx, now int, raw []byte, result *writeResult) error {
			lockOrder := append([]string{}, seedFlagOrder...)
			sort.Strings(lockOrder)
			for _, flagCode := range lockOrder {
				if err := takeLock(ctx, tx, flagLockNamespace, flagCode); err != nil {
					return err
				}
			}
			state, err := readSnapshot(ctx, tx, now)
			if err != nil {
				return err
			}
			cohort := state.cohortByCode(cohortCode)
			if cohort == nil {
				return failure(http.StatusNotFound, "not found")
			}
			fields, errors := parseFields(raw, []string{"min_soak_minutes"}, []string{"min_soak_minutes"})
			if fields == nil {
				return fieldFailure(errors)
			}
			minimum := 0
			if raw, present := fields["min_soak_minutes"]; present && !isJSONNull(raw) {
				value, ok := asWholeNumber(raw)
				if !ok || value < 0 || value > 525600 {
					errors.add("min_soak_minutes", "must be a whole number from 0 to 525600")
				} else {
					minimum = value
				}
			}
			if errors.any() {
				return fieldFailure(errors)
			}
			if _, err := tx.Exec(ctx,
				`UPDATE cohort SET min_soak_minutes = $1 WHERE cohort_code = $2`,
				minimum, cohortCode); err != nil {
				return err
			}
			cohort.MinSoakMinutes = minimum
			for _, flag := range state.flags {
				if err := reassessFlag(ctx, tx, state, flag.FlagCode); err != nil {
					return err
				}
			}
			result.status = http.StatusOK
			result.body = *cohort
			return nil
		})
}

// reassessFlag runs the breach cascade (DP-06) inside the flag's serialised step.
func reassessFlag(ctx context.Context, tx pgx.Tx, state *snapshot, flagCode string) error {
	maximum := state.flagByCode(flagCode).MaxAdverseRateBP
	lowestBreach := 0
	for rung := 1; rung <= rungCount; rung++ {
		if state.activePromotionAtRung(flagCode, rung) == nil {
			continue
		}
		if state.rateBP(flagCode, state.cohortByRung(rung).CohortCode) > maximum {
			lowestBreach = rung
			break
		}
	}
	if lowestBreach == 0 {
		return nil
	}
	instant := state.Now
	for rung := rungCount; rung > lowestBreach; rung-- {
		promotion := state.activePromotionAtRung(flagCode, rung)
		if promotion == nil {
			continue
		}
		if _, err := tx.Exec(ctx,
			`UPDATE promotion SET demoted_at_minutes = $1 WHERE promotion_code = $2`,
			instant, promotion.PromotionCode); err != nil {
			return err
		}
		demotedAt := instant
		promotion.DemotedAtMinutes = &demotedAt
		instant++
	}
	return nil
}
