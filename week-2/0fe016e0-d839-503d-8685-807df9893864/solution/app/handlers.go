package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sort"
	"time"
)

const requestTimeout = 15 * time.Second

var databaseUnavailable = map[string]string{"error": "database unavailable"}

// outcome is a write handler's answer. Steps are journey trace steps the answer records.
type outcome struct {
	status int
	body   any
	steps  []string
}

func fieldErrorOutcome(errors fieldErrors) outcome {
	return outcome{status: http.StatusUnprocessableEntity, body: map[string]any{"errors": errors}}
}

func notFoundOutcome(what string) outcome {
	return outcome{status: http.StatusNotFound, body: map[string]string{"error": what + " not found"}}
}

type writeHandler func(ctx context.Context, tx *sql.Tx, r *http.Request, raw []byte) (outcome, error)

func (a *App) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", a.health)

	mux.Handle("GET /api/capability_flag", a.api(a.listFlags))
	mux.Handle("GET /api/cohort", a.api(a.listCohorts))
	mux.Handle("GET /api/device", a.api(a.listDevices))
	mux.Handle("GET /api/adverse_event", a.api(a.listAdverseEvents))
	mux.Handle("GET /api/promotion", a.api(a.listPromotions))
	mux.Handle("GET /api/evidence_pack", a.api(a.listEvidencePacks))
	for _, entity := range readerEntities {
		mux.Handle("GET /api/"+entity.Name+"/summary", a.api(a.summary(entity)))
	}
	mux.Handle("GET /api/capability_flag/{flag_code}", a.api(a.flagDetail))
	for _, export := range exports {
		mux.Handle("POST /api/"+export.requirement+"/render", a.api(a.write("render "+export.requirement, false, a.renderExport(export))))
		mux.Handle("GET /api/"+export.requirement+"/latest", a.api(a.latestExport(export)))
	}
	for _, journey := range []string{"WF-01", "WF-02", "WF-03", "WF-04"} {
		mux.Handle("GET /api/"+journey+"/events", a.api(a.journeyTrace(journey)))
	}

	mux.Handle("PATCH /api/capability_flag/{flag_code}", a.api(a.write("PATCH capability_flag", false, a.patchFlag)))
	mux.Handle("PATCH /api/cohort/{cohort_code}", a.api(a.write("PATCH cohort", false, a.patchCohort)))
	mux.Handle("POST /api/promotion", a.api(a.write("POST /api/promotion", true, a.promote(false))))
	mux.Handle("POST /api/promotion/force-enable", a.api(a.write("POST /api/promotion/force-enable", true, a.promote(true))))
	mux.Handle("POST /api/promotion/rollback", a.api(a.write("POST /api/promotion/rollback", true, a.rollback)))
	mux.Handle("POST /api/adverse_event", a.api(a.write("POST /api/adverse_event", false, a.recordAdverseEvent)))
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such route"})
	})

	a.pageRoutes(mux)
	return securityHeaders(mux)
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

// api answers 503 until the store is ready.
func (a *App) api(next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !a.ready.Load() {
			writeJSON(w, http.StatusServiceUnavailable, databaseUnavailable)
			return
		}
		next(w, r)
	})
}

func (a *App) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if !a.ready.Load() || a.db.PingContext(ctx) != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func unavailable(w http.ResponseWriter, err error) {
	log.Printf("database error: %T", err)
	writeJSON(w, http.StatusServiceUnavailable, databaseUnavailable)
}

// write runs one write route: content type and size, the idempotency key, then the handler
// inside one transaction that commits only a 200 or 201 answer.
func (a *App) write(route string, idempotent bool, handle writeHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		raw, ok := readWriteBody(w, r)
		if !ok {
			return
		}
		keys := r.Header.Values("Idempotency-Key")
		keyGiven := idempotent && len(keys) > 0
		key := ""
		if keyGiven {
			key = keys[0]
			if len(keys) > 1 || !validIdempotencyKey(key) {
				writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"errors": fieldErrors{"idempotency_key": msgIdempotencyKey}})
				return
			}
		}
		// The answer may be lost on the way back; the write still completes.
		ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), requestTimeout)
		defer cancel()
		tx, err := a.db.BeginTx(ctx, nil)
		if err != nil {
			unavailable(w, err)
			return
		}
		defer tx.Rollback()
		if keyGiven {
			stored, err := lookupIdempotencyKey(ctx, tx, key, raw)
			if err != nil {
				unavailable(w, err)
				return
			}
			if stored != nil {
				if stored.route != route || !stored.sameBody {
					writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"errors": fieldErrors{"idempotency_key": msgKeyMismatch}})
					return
				}
				w.Header().Set("Idempotent-Replayed", "true")
				writeJSONBytes(w, stored.status, stored.body)
				return
			}
		}
		result, err := handle(ctx, tx, r, raw)
		if err != nil {
			unavailable(w, err)
			return
		}
		payload, _ := json.Marshal(result.body)
		if result.status == http.StatusOK || result.status == http.StatusCreated {
			if keyGiven {
				if err := storeIdempotencyKey(ctx, tx, key, route, raw, result.status, payload); err != nil {
					unavailable(w, err)
					return
				}
			}
			if err := recordJourneySteps(ctx, tx, result.steps); err != nil {
				unavailable(w, err)
				return
			}
			if err := tx.Commit(); err != nil {
				unavailable(w, err)
				return
			}
		} else if len(result.steps) > 0 {
			tx.Rollback()
			if err := a.recordJourneyStepsAlone(ctx, result.steps); err != nil {
				unavailable(w, err)
				return
			}
		}
		writeJSONBytes(w, result.status, payload)
	}
}

// promote serves the standard promotion and the force-enable control through one gate.
func (a *App) promote(force bool) writeHandler {
	accepted := []string{"flag_code", "cohort_code", "attestation_reference"}
	if force {
		accepted = accepted[:2]
	}
	return func(ctx context.Context, tx *sql.Tx, r *http.Request, raw []byte) (outcome, error) {
		fields, isObject := decodeFields(raw, accepted...)
		if !isObject {
			return fieldErrorOutcome(fields.errors), nil
		}
		var flag *Flag
		if value, given := fields.required("flag_code"); given {
			code, _ := text(value)
			locked, err := lockFlag(ctx, tx, code)
			if err != nil {
				return outcome{}, err
			}
			if locked == nil {
				fields.errors.add("flag_code", msgUnknownFlag)
			}
			flag = locked
		}
		now := currentMinute()
		cohorts, err := loadCohorts(ctx, tx)
		if err != nil {
			return outcome{}, err
		}
		ladder := &Ladder{Cohorts: cohorts, Now: now}
		if flag != nil {
			if ladder, err = loadLadder(ctx, tx, *flag, now); err != nil {
				return outcome{}, err
			}
		}
		var target Cohort
		if value, given := fields.required("cohort_code"); given {
			code, _ := text(value)
			cohort, known := ladder.cohortByCode(code)
			switch {
			case !known:
				fields.errors.add("cohort_code", msgUnknownCohort)
			case flag != nil && ladder.activePromotion(cohort.RungIndex) != nil:
				fields.errors.add("cohort_code", fmt.Sprintf("rung %d is already active", cohort.RungIndex))
			}
			target = cohort
		}
		reference := ""
		if value, given := fields.given("attestation_reference"); given {
			typed, isText := text(value)
			reference = trimAttestation(typed)
			if !isText || (reference != "" && !attestationWithinLimits(reference)) {
				fields.errors.add("attestation_reference", msgReference)
			} else if reference != "" {
				used, err := attestationUsed(ctx, tx, reference)
				if err != nil {
					return outcome{}, err
				}
				if used {
					fields.errors.add("attestation_reference", msgReferenceUsed)
				}
			}
		}
		if len(fields.errors) > 0 {
			return fieldErrorOutcome(fields.errors), nil
		}

		if refusal := ladder.gate(target, reference, !force); refusal != nil {
			result := outcome{status: http.StatusConflict, body: refusal.body()}
			switch {
			case force:
				result.steps = []string{"WF-02-1"}
			case refusal.Rule == "DP-01":
				result.steps = []string{"WF-01-1", "WF-01-2"}
			}
			return result, nil
		}

		code, sequence, err := nextPromotionCode(ctx, tx)
		if err != nil {
			return outcome{}, err
		}
		promotion := Promotion{Code: code, Sequence: sequence, FlagCode: flag.Code, CohortCode: target.Code, PromotedAt: now}
		if !force {
			promotion.AttestationReference = &reference
		}
		inserted, err := insertPromotion(ctx, tx, promotion)
		if err != nil {
			return outcome{}, err
		}
		if !inserted {
			return fieldErrorOutcome(fieldErrors{"attestation_reference": msgReferenceUsed}), nil
		}
		steps := []string{"WF-01-3"}
		if force {
			steps = []string{"WF-02-1"}
		}
		return outcome{status: http.StatusCreated, body: promotion, steps: steps}, nil
	}
}

// rollback demotes only the flag's highest active rung.
func (a *App) rollback(ctx context.Context, tx *sql.Tx, r *http.Request, raw []byte) (outcome, error) {
	fields, isObject := decodeFields(raw, "flag_code")
	if !isObject {
		return fieldErrorOutcome(fields.errors), nil
	}
	var flag *Flag
	if value, given := fields.required("flag_code"); given {
		code, _ := text(value)
		locked, err := lockFlag(ctx, tx, code)
		if err != nil {
			return outcome{}, err
		}
		if locked == nil {
			fields.errors.add("flag_code", msgUnknownFlag)
		}
		flag = locked
	}
	if len(fields.errors) > 0 {
		return fieldErrorOutcome(fields.errors), nil
	}
	ladder, err := loadLadder(ctx, tx, *flag, currentMinute())
	if err != nil {
		return outcome{}, err
	}
	highest := ladder.highestActiveRung()
	if highest == 0 {
		refusal := &Refusal{Rule: "DP-05", Copy: fmt.Sprintf("Refused: %s has no active rung to roll back (DP-05).", flag.Label)}
		return outcome{status: http.StatusConflict, body: refusal.body()}, nil
	}
	promotion := *ladder.activePromotion(highest)
	if err := demotePromotion(ctx, tx, promotion.Code, ladder.Now); err != nil {
		return outcome{}, err
	}
	promotion.DemotedAt = &ladder.Now
	return outcome{status: http.StatusOK, body: promotion, steps: []string{"WF-03-1"}}, nil
}

func (a *App) recordAdverseEvent(ctx context.Context, tx *sql.Tx, r *http.Request, raw []byte) (outcome, error) {
	fields, isObject := decodeFields(raw, "event_code", "device_code", "flag_code", "occurred_at_minutes", "severity_band_code")
	if !isObject {
		return fieldErrorOutcome(fields.errors), nil
	}
	event := AdverseEvent{}
	var flag *Flag
	if value, given := fields.required("flag_code"); given {
		code, _ := text(value)
		locked, err := lockFlag(ctx, tx, code)
		if err != nil {
			return outcome{}, err
		}
		if locked == nil {
			fields.errors.add("flag_code", msgUnknownFlag)
		} else {
			event.FlagCode = locked.Code
		}
		flag = locked
	}
	now := currentMinute()
	if value, given := fields.required("event_code"); given {
		typed, isText := text(value)
		event.Code = normaliseEventCode(typed)
		if !isText || !eventCodePattern.MatchString(event.Code) {
			fields.errors.add("event_code", msgEventCode)
		} else {
			recorded, err := eventRecorded(ctx, tx, event.Code)
			if err != nil {
				return outcome{}, err
			}
			if recorded {
				fields.errors.add("event_code", msgEventRecorded)
			}
		}
	}
	if value, given := fields.required("device_code"); given {
		code, _ := text(value)
		device, err := findDevice(ctx, tx, code)
		if err != nil {
			return outcome{}, err
		}
		if device == nil {
			fields.errors.add("device_code", msgUnknownDevice)
		} else {
			event.DeviceCode, event.CohortCode = device.Code, device.CohortCode
		}
	}
	if value, given := fields.required("occurred_at_minutes"); given {
		if !wholeNumberPattern.Match(value) {
			fields.errors.add("occurred_at_minutes", msgOccurredAt)
		} else if minute, inRange := wholeNumber(value, 0, now); inRange {
			event.OccurredAt = minute
		} else if value[0] == '-' {
			fields.errors.add("occurred_at_minutes", msgOccurredAt)
		} else {
			fields.errors.add("occurred_at_minutes", msgOccurredInFuture)
		}
	}
	if value, given := fields.required("severity_band_code"); given {
		band, _ := text(value)
		if band != "BAND-LOW" && band != "BAND-MED" && band != "BAND-HIGH" {
			fields.errors.add("severity_band_code", msgSeverityBand)
		}
		event.SeverityBand = band
	}
	if len(fields.errors) > 0 {
		return fieldErrorOutcome(fields.errors), nil
	}

	ladder, err := loadLadder(ctx, tx, *flag, now)
	if err != nil {
		return outcome{}, err
	}
	cohort, _ := ladder.cohortByCode(event.CohortCode)
	_, rateBefore := ladder.adverseFigures(cohort)
	inserted, err := insertAdverseEvent(ctx, tx, event)
	if err != nil {
		return outcome{}, err
	}
	if !inserted {
		return fieldErrorOutcome(fieldErrors{"event_code": msgEventRecorded}), nil
	}
	ladder.Events = append(ladder.Events, event)
	_, rateAfter := ladder.adverseFigures(cohort)
	if err := reassess(ctx, tx, ladder); err != nil {
		return outcome{}, err
	}
	result := outcome{status: http.StatusCreated, body: event}
	if ladder.withinMaximum(rateBefore) && !ladder.withinMaximum(rateAfter) {
		result.steps = []string{"WF-04-1"}
	}
	return result, nil
}

func (a *App) patchFlag(ctx context.Context, tx *sql.Tx, r *http.Request, raw []byte) (outcome, error) {
	flag, err := lockFlag(ctx, tx, r.PathValue("flag_code"))
	if err != nil {
		return outcome{}, err
	}
	if flag == nil {
		return notFoundOutcome("flag"), nil
	}
	fields, isObject := decodeFields(raw, "max_adverse_rate_bp")
	if !isObject {
		return fieldErrorOutcome(fields.errors), nil
	}
	if value, given := fields.required("max_adverse_rate_bp"); given {
		maximum, valid := wholeNumber(value, 0, 10000)
		if !valid {
			fields.errors.add("max_adverse_rate_bp", msgMaxAdverseRate)
		}
		flag.MaxAdverseRateBP = maximum
	}
	if len(fields.errors) > 0 {
		return fieldErrorOutcome(fields.errors), nil
	}
	if _, err := tx.ExecContext(ctx, `UPDATE capability_flag SET max_adverse_rate_bp = $1 WHERE flag_code = $2`, flag.MaxAdverseRateBP, flag.Code); err != nil {
		return outcome{}, err
	}
	ladder, err := loadLadder(ctx, tx, *flag, currentMinute())
	if err != nil {
		return outcome{}, err
	}
	if err := reassess(ctx, tx, ladder); err != nil {
		return outcome{}, err
	}
	return outcome{status: http.StatusOK, body: flag}, nil
}

func (a *App) patchCohort(ctx context.Context, tx *sql.Tx, r *http.Request, raw []byte) (outcome, error) {
	cohorts, err := loadCohorts(ctx, tx)
	if err != nil {
		return outcome{}, err
	}
	ladder := &Ladder{Cohorts: cohorts}
	cohort, known := ladder.cohortByCode(r.PathValue("cohort_code"))
	if !known {
		return notFoundOutcome("cohort"), nil
	}
	flags, err := lockEveryFlag(ctx, tx)
	if err != nil {
		return outcome{}, err
	}
	fields, isObject := decodeFields(raw, "min_soak_minutes")
	if !isObject {
		return fieldErrorOutcome(fields.errors), nil
	}
	if value, given := fields.required("min_soak_minutes"); given {
		minimum, valid := wholeNumber(value, 0, 525600)
		if !valid {
			fields.errors.add("min_soak_minutes", msgMinSoak)
		}
		cohort.MinSoakMinutes = minimum
	}
	if len(fields.errors) > 0 {
		return fieldErrorOutcome(fields.errors), nil
	}
	if _, err := tx.ExecContext(ctx, `UPDATE cohort SET min_soak_minutes = $1 WHERE cohort_code = $2`, cohort.MinSoakMinutes, cohort.Code); err != nil {
		return outcome{}, err
	}
	ladders, err := loadLadders(ctx, tx, flags, currentMinute())
	if err != nil {
		return outcome{}, err
	}
	for _, flagLadder := range ladders {
		if err := reassess(ctx, tx, flagLadder); err != nil {
			return outcome{}, err
		}
	}
	return outcome{status: http.StatusOK, body: cohort}, nil
}

// read waits for every flag's serialised steps already queued, then reads while holding a
// share lock on every flag row, so no write lands mid-read and every surface sees one moment.
func (a *App) read(ctx context.Context, view func(tx *sql.Tx) error) error {
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := shareEveryFlag(ctx, tx); err != nil {
		return err
	}
	if err := view(tx); err != nil {
		return err
	}
	return tx.Commit()
}

// shareEveryFlag waits for the serialised steps already queued on every flag and keeps new
// ones out until the transaction ends.
func shareEveryFlag(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, `SELECT flag_code FROM capability_flag ORDER BY flag_code COLLATE "C" FOR SHARE`)
	return err
}

// allLadders reads every flag's ladder in flag code order.
func allLadders(ctx context.Context, tx *sql.Tx) ([]*Ladder, error) {
	flags, err := loadFlags(ctx, tx)
	if err != nil {
		return nil, err
	}
	return loadLadders(ctx, tx, flags, currentMinute())
}

func evidencePacks(ladders []*Ladder) []EvidencePack {
	packs := make([]EvidencePack, 0, len(ladders))
	for _, ladder := range ladders {
		packs = append(packs, ladder.evidencePack())
	}
	return packs
}

func (a *App) respondList(w http.ResponseWriter, r *http.Request, load func(ctx context.Context, tx *sql.Tx) (any, error), steps ...string) {
	var body any
	err := a.read(r.Context(), func(tx *sql.Tx) error {
		var err error
		body, err = load(r.Context(), tx)
		return err
	})
	if err == nil && len(steps) > 0 {
		err = a.recordJourneyStepsAlone(r.Context(), steps)
	}
	if err != nil {
		unavailable(w, err)
		return
	}
	writeJSON(w, http.StatusOK, body)
}

func (a *App) listFlags(w http.ResponseWriter, r *http.Request) {
	a.respondList(w, r, func(ctx context.Context, tx *sql.Tx) (any, error) { return nonNull(loadFlags(ctx, tx)) })
}

func (a *App) listCohorts(w http.ResponseWriter, r *http.Request) {
	a.respondList(w, r, func(ctx context.Context, tx *sql.Tx) (any, error) { return cohortsByCode(ctx, tx) })
}

func (a *App) listDevices(w http.ResponseWriter, r *http.Request) {
	a.respondList(w, r, func(ctx context.Context, tx *sql.Tx) (any, error) { return nonNull(loadDevices(ctx, tx)) })
}

func (a *App) listAdverseEvents(w http.ResponseWriter, r *http.Request) {
	a.respondList(w, r, func(ctx context.Context, tx *sql.Tx) (any, error) { return nonNull(loadAdverseEvents(ctx, tx)) })
}

func (a *App) listEvidencePacks(w http.ResponseWriter, r *http.Request) {
	a.respondList(w, r, func(ctx context.Context, tx *sql.Tx) (any, error) {
		ladders, err := allLadders(ctx, tx)
		return evidencePacks(ladders), err
	}, "WF-01-4", "WF-02-3")
}

func (a *App) listPromotions(w http.ResponseWriter, r *http.Request) {
	flagCode, filtered := r.URL.Query()["flag_code"]
	if !filtered {
		a.respondList(w, r, func(ctx context.Context, tx *sql.Tx) (any, error) { return nonNull(loadPromotions(ctx, tx)) })
		return
	}
	a.respondList(w, r, func(ctx context.Context, tx *sql.Tx) (any, error) {
		return flagHistory(ctx, tx, flagCode[0])
	}, "WF-03-3", "WF-04-3")
}

// flagHistory is one flag's promotions, demoted rows included, by promoted_at then sequence.
func flagHistory(ctx context.Context, tx *sql.Tx, flagCode string) ([]Promotion, error) {
	promotions, err := loadPromotions(ctx, tx)
	if err != nil {
		return nil, err
	}
	history := []Promotion{}
	for _, promotion := range promotions {
		if promotion.FlagCode == flagCode {
			history = append(history, promotion)
		}
	}
	sort.SliceStable(history, func(i, j int) bool { return history[i].PromotedAt < history[j].PromotedAt })
	return history, nil
}

func cohortsByCode(ctx context.Context, tx *sql.Tx) ([]Cohort, error) {
	cohorts, err := nonNull(loadCohorts(ctx, tx))
	sort.Slice(cohorts, func(i, j int) bool { return cohorts[i].Code < cohorts[j].Code })
	return cohorts, err
}

// nonNull keeps an empty list a JSON array.
func nonNull[T any](list []T, err error) ([]T, error) {
	if list == nil {
		list = []T{}
	}
	return list, err
}

func (a *App) summary(entity readerEntity) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var total int
		err := a.read(r.Context(), func(tx *sql.Tx) error {
			table, err := entity.table(r.Context(), tx)
			total = len(table.rows)
			return err
		})
		if err != nil {
			unavailable(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]int{"total": total})
	}
}

func (a *App) flagDetail(w http.ResponseWriter, r *http.Request) {
	var detail *FlagDetail
	err := a.read(r.Context(), func(tx *sql.Tx) error {
		flags, err := loadFlags(r.Context(), tx)
		if err != nil {
			return err
		}
		for _, flag := range flags {
			if flag.Code == r.PathValue("flag_code") {
				ladder, err := loadLadder(r.Context(), tx, flag, currentMinute())
				if err != nil {
					return err
				}
				found := ladder.detail()
				detail = &found
			}
		}
		return nil
	})
	if err == nil && detail != nil {
		err = a.recordJourneyStepsAlone(r.Context(), []string{"WF-02-2", "WF-03-2", "WF-04-2"})
	}
	if err != nil {
		unavailable(w, err)
		return
	}
	if detail == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "flag not found"})
		return
	}
	writeJSON(w, http.StatusOK, detail)
}
