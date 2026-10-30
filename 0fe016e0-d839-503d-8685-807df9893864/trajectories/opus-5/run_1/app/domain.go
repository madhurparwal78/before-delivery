package main

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
)

// Seed order drives the console regions and every "seed order" listing.
var seedFlagOrder = []string{"FLG-ADAPTIVE", "FLG-TELEM", "FLG-ALERT"}

const rungCount = 5

type flagRecord struct {
	FlagCode         string `json:"flag_code"`
	FlagLabel        string `json:"flag_label"`
	RiskClassCode    string `json:"risk_class_code"`
	MaxAdverseRateBP int    `json:"max_adverse_rate_bp"`
}

type cohortRecord struct {
	CohortCode     string `json:"cohort_code"`
	RungIndexCount int    `json:"rung_index_count"`
	CohortLabel    string `json:"cohort_label"`
	DeviceCount    int    `json:"device_count"`
	MinSoakMinutes int    `json:"min_soak_minutes"`
}

type deviceRecord struct {
	DeviceCode           string `json:"device_code"`
	CohortCode           string `json:"cohort_code"`
	SerialReference      string `json:"serial_reference"`
	FirmwareVersionLabel string `json:"firmware_version_label"`
}

type promotionRecord struct {
	PromotionCode        string  `json:"promotion_code"`
	FlagCode             string  `json:"flag_code"`
	CohortCode           string  `json:"cohort_code"`
	PromotedAtMinutes    int     `json:"promoted_at_minutes"`
	DemotedAtMinutes     *int    `json:"demoted_at_minutes"`
	AttestationReference *string `json:"attestation_reference"`
}

type adverseEventRecord struct {
	EventCode         string `json:"event_code"`
	DeviceCode        string `json:"device_code"`
	FlagCode          string `json:"flag_code"`
	OccurredAtMinutes int    `json:"occurred_at_minutes"`
	SeverityBandCode  string `json:"severity_band_code"`
}

type evidencePackRecord struct {
	PackCode                     string `json:"pack_code"`
	FlagCode                     string `json:"flag_code"`
	HighestRungIndexCount        int    `json:"highest_rung_index_count"`
	GapRungIndexCounts           []int  `json:"gap_rung_index_counts"`
	SoakSatisfiedRungIndexCounts []int  `json:"soak_satisfied_rung_index_counts"`
	RateSatisfiedRungIndexCounts []int  `json:"rate_satisfied_rung_index_counts"`
}

type rungDetail struct {
	RungIndexCount       int     `json:"rung_index_count"`
	CohortCode           string  `json:"cohort_code"`
	CohortLabel          string  `json:"cohort_label"`
	MinSoakMinutes       int     `json:"min_soak_minutes"`
	DeviceCount          int     `json:"device_count"`
	State                string  `json:"state"`
	Attested             bool    `json:"attested"`
	PromotionCode        *string `json:"promotion_code"`
	PromotedAtMinutes    *int    `json:"promoted_at_minutes"`
	DemotedAtMinutes     *int    `json:"demoted_at_minutes"`
	AttestationReference *string `json:"attestation_reference"`
	SoakElapsedMinutes   *int    `json:"soak_elapsed_minutes"`
	EventCount           int     `json:"event_count"`
	RateBP               int     `json:"rate_bp"`
	MaxAdverseRateBP     int     `json:"max_adverse_rate_bp"`
}

type flagDetail struct {
	FlagCode              string       `json:"flag_code"`
	FlagLabel             string       `json:"flag_label"`
	RiskClassCode         string       `json:"risk_class_code"`
	MaxAdverseRateBP      int          `json:"max_adverse_rate_bp"`
	HighestRungIndexCount int          `json:"highest_rung_index_count"`
	Rungs                 []rungDetail `json:"rungs"`
}

// Rung state words, in the published order of precedence.
const (
	stateNotPromoted = "Not promoted"
	stateDemoted     = "Demoted"
	stateGap         = "Gap"
	stateSoaking     = "Soaking"
	stateActive      = "Active"
)

func nowMinutes() int { return int(time.Now().Unix() / 60) }

// snapshot is one reading of live state, taken at one server minute.
type snapshot struct {
	Now        int
	flags      []flagRecord
	cohorts    []cohortRecord
	devices    []deviceRecord
	promotions []promotionRecord
	events     []adverseEventRecord
}

// rowQuerier is satisfied by both the pool and a transaction.
type rowQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// collectRecords reads every row of one query into its record type, whose
// fields sit in the order the query selects them.
func collectRecords[T any](ctx context.Context, q rowQuerier, sql string) ([]T, error) {
	rows, err := q.Query(ctx, sql)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[T])
}

// readSnapshot takes one reading of live state at one server minute.
func readSnapshot(ctx context.Context, q rowQuerier, now int) (*snapshot, error) {
	s := &snapshot{Now: now}
	var err error
	if s.flags, err = collectRecords[flagRecord](ctx, q,
		`SELECT flag_code, flag_label, risk_class_code, max_adverse_rate_bp
		 FROM capability_flag ORDER BY flag_code`); err != nil {
		return nil, err
	}
	if s.cohorts, err = collectRecords[cohortRecord](ctx, q,
		`SELECT cohort_code, rung_index_count, cohort_label, device_count, min_soak_minutes
		 FROM cohort ORDER BY cohort_code`); err != nil {
		return nil, err
	}
	if s.devices, err = collectRecords[deviceRecord](ctx, q,
		`SELECT device_code, cohort_code, serial_reference, firmware_version_label
		 FROM device ORDER BY device_code`); err != nil {
		return nil, err
	}
	if s.promotions, err = collectRecords[promotionRecord](ctx, q,
		`SELECT promotion_code, flag_code, cohort_code, promoted_at_minutes, demoted_at_minutes,
		        attestation_reference
		 FROM promotion`); err != nil {
		return nil, err
	}
	sort.Slice(s.promotions, func(i, j int) bool {
		return sequenceNumber(s.promotions[i].PromotionCode) < sequenceNumber(s.promotions[j].PromotionCode)
	})
	if s.events, err = collectRecords[adverseEventRecord](ctx, q,
		`SELECT event_code, device_code, flag_code, occurred_at_minutes, severity_band_code
		 FROM adverse_event ORDER BY event_code`); err != nil {
		return nil, err
	}
	return s, nil
}

func sequenceNumber(promotionCode string) int {
	var number int
	fmt.Sscanf(promotionCode, "PRM-%d", &number)
	return number
}

func promotionCodeFor(sequence int) string { return fmt.Sprintf("PRM-%02d", sequence) }

func (s *snapshot) flagByCode(flagCode string) *flagRecord {
	for i := range s.flags {
		if s.flags[i].FlagCode == flagCode {
			return &s.flags[i]
		}
	}
	return nil
}

func (s *snapshot) cohortByCode(cohortCode string) *cohortRecord {
	for i := range s.cohorts {
		if s.cohorts[i].CohortCode == cohortCode {
			return &s.cohorts[i]
		}
	}
	return nil
}

func (s *snapshot) cohortByRung(rung int) *cohortRecord {
	for i := range s.cohorts {
		if s.cohorts[i].RungIndexCount == rung {
			return &s.cohorts[i]
		}
	}
	return nil
}

func (s *snapshot) deviceByCode(deviceCode string) *deviceRecord {
	for i := range s.devices {
		if s.devices[i].DeviceCode == deviceCode {
			return &s.devices[i]
		}
	}
	return nil
}

func (s *snapshot) flagsInSeedOrder() []flagRecord {
	ordered := make([]flagRecord, 0, len(s.flags))
	for _, flagCode := range seedFlagOrder {
		if record := s.flagByCode(flagCode); record != nil {
			ordered = append(ordered, *record)
		}
	}
	return ordered
}

// latestPromotion is the pair's promotion with the largest promoted_at_minutes,
// ties broken by the larger sequence number.
func (s *snapshot) latestPromotion(flagCode, cohortCode string) *promotionRecord {
	var latest *promotionRecord
	for i := range s.promotions {
		candidate := &s.promotions[i]
		if candidate.FlagCode != flagCode || candidate.CohortCode != cohortCode {
			continue
		}
		if latest == nil || candidate.PromotedAtMinutes > latest.PromotedAtMinutes ||
			(candidate.PromotedAtMinutes == latest.PromotedAtMinutes &&
				sequenceNumber(candidate.PromotionCode) > sequenceNumber(latest.PromotionCode)) {
			latest = candidate
		}
	}
	return latest
}

func (s *snapshot) activePromotionAtRung(flagCode string, rung int) *promotionRecord {
	cohort := s.cohortByRung(rung)
	if cohort == nil {
		return nil
	}
	latest := s.latestPromotion(flagCode, cohort.CohortCode)
	if latest == nil || latest.DemotedAtMinutes != nil {
		return nil
	}
	return latest
}

func (s *snapshot) highestActiveRung(flagCode string) int {
	highest := 0
	for rung := 1; rung <= rungCount; rung++ {
		if s.activePromotionAtRung(flagCode, rung) != nil {
			highest = rung
		}
	}
	return highest
}

// eventCount counts the flag's adverse events on the cohort's devices that fall
// inside any interval in which the flag was active at that cohort.
func (s *snapshot) eventCount(flagCode, cohortCode string) int {
	type interval struct{ from, to int }
	var intervals []interval
	for _, promotion := range s.promotions {
		if promotion.FlagCode != flagCode || promotion.CohortCode != cohortCode {
			continue
		}
		// The bound is exclusive at a demotion instant and inclusive of the
		// current minute while the promotion is still active.
		to := s.Now + 1
		if promotion.DemotedAtMinutes != nil {
			to = *promotion.DemotedAtMinutes
		}
		intervals = append(intervals, interval{from: promotion.PromotedAtMinutes, to: to})
	}
	total := 0
	for _, event := range s.events {
		if event.FlagCode != flagCode {
			continue
		}
		device := s.deviceByCode(event.DeviceCode)
		if device == nil || device.CohortCode != cohortCode {
			continue
		}
		for _, window := range intervals {
			if event.OccurredAtMinutes >= window.from && event.OccurredAtMinutes < window.to {
				total++
				break
			}
		}
	}
	return total
}

func (s *snapshot) rateBP(flagCode, cohortCode string) int {
	cohort := s.cohortByCode(cohortCode)
	if cohort == nil || cohort.DeviceCount == 0 {
		return 0
	}
	return s.eventCount(flagCode, cohortCode) * 10000 / cohort.DeviceCount
}

// gateRefusal carries the first failing gate of a promotion.
type gateRefusal struct {
	Rule   string
	Copy   string
	Fields map[string]int
}

// checkGates decides DP-01 to DP-04 for promoting a flag to one rung. It is the
// only place the promotion gate is decided: the standard promotion, the
// force-enable control and the evidence pack all reach it here.
func (s *snapshot) checkGates(flagCode string, rung int, reference string, requireAttestation bool) *gateRefusal {
	for below := 1; below < rung; below++ {
		if s.activePromotionAtRung(flagCode, below) == nil {
			return &gateRefusal{
				Rule:   "DP-01",
				Copy:   fmt.Sprintf("Refused: rung %d needs an active promotion at rung %d first (DP-01).", rung, below),
				Fields: map[string]int{"missing_rung_index_count": below},
			}
		}
	}
	if rung > 1 {
		belowRung := rung - 1
		belowCohort := s.cohortByRung(belowRung)
		belowPromotion := s.activePromotionAtRung(flagCode, belowRung)
		elapsed := s.Now - belowPromotion.PromotedAtMinutes
		if elapsed < belowCohort.MinSoakMinutes {
			remaining := belowCohort.MinSoakMinutes - elapsed
			return &gateRefusal{
				Rule: "DP-02",
				Copy: fmt.Sprintf("Refused: rung %d has soaked %d minutes of %d minutes; %d minutes remain (DP-02).",
					belowRung, elapsed, belowCohort.MinSoakMinutes, remaining),
				Fields: map[string]int{
					"elapsed_minutes":   elapsed,
					"minimum_minutes":   belowCohort.MinSoakMinutes,
					"remaining_minutes": remaining,
				},
			}
		}
		rate := s.rateBP(flagCode, belowCohort.CohortCode)
		maximum := s.flagByCode(flagCode).MaxAdverseRateBP
		if rate > maximum {
			return &gateRefusal{
				Rule: "DP-03",
				Copy: fmt.Sprintf("Refused: rung %d adverse rate is %d basis points, above the maximum of %d basis points (DP-03).",
					belowRung, rate, maximum),
				Fields: map[string]int{"rate_bp": rate, "max_adverse_rate_bp": maximum},
			}
		}
	}
	if requireAttestation && reference == "" {
		return &gateRefusal{
			Rule:   "DP-04",
			Copy:   fmt.Sprintf("Refused: an attestation reference is required for rung %d (DP-04).", rung),
			Fields: map[string]int{},
		}
	}
	return nil
}

// recordBelowComplete reports whether an active rung carries a complete soak,
// rate and attestation record below it (DP-07).
func (s *snapshot) recordBelowComplete(flagCode string, rung int) bool {
	promotion := s.activePromotionAtRung(flagCode, rung)
	if promotion == nil || promotion.AttestationReference == nil || *promotion.AttestationReference == "" {
		return false
	}
	return s.checkGates(flagCode, rung, *promotion.AttestationReference, true) == nil
}

func (s *snapshot) rungState(flagCode string, rung int) string {
	cohort := s.cohortByRung(rung)
	latest := s.latestPromotion(flagCode, cohort.CohortCode)
	switch {
	case latest == nil:
		return stateNotPromoted
	case latest.DemotedAtMinutes != nil:
		return stateDemoted
	case !s.recordBelowComplete(flagCode, rung):
		return stateGap
	case s.Now-latest.PromotedAtMinutes < cohort.MinSoakMinutes:
		return stateSoaking
	default:
		return stateActive
	}
}

func (s *snapshot) rungDetailFor(flagCode string, rung int) rungDetail {
	cohort := s.cohortByRung(rung)
	flag := s.flagByCode(flagCode)
	latest := s.latestPromotion(flagCode, cohort.CohortCode)
	state := s.rungState(flagCode, rung)
	detail := rungDetail{
		RungIndexCount:   rung,
		CohortCode:       cohort.CohortCode,
		CohortLabel:      cohort.CohortLabel,
		MinSoakMinutes:   cohort.MinSoakMinutes,
		DeviceCount:      cohort.DeviceCount,
		State:            state,
		EventCount:       s.eventCount(flagCode, cohort.CohortCode),
		RateBP:           s.rateBP(flagCode, cohort.CohortCode),
		MaxAdverseRateBP: flag.MaxAdverseRateBP,
	}
	if latest != nil {
		code := latest.PromotionCode
		promotedAt := latest.PromotedAtMinutes
		detail.PromotionCode = &code
		detail.PromotedAtMinutes = &promotedAt
		detail.DemotedAtMinutes = latest.DemotedAtMinutes
		detail.AttestationReference = latest.AttestationReference
		if latest.DemotedAtMinutes == nil {
			elapsed := s.Now - latest.PromotedAtMinutes
			detail.SoakElapsedMinutes = &elapsed
		}
		detail.Attested = (state == stateActive || state == stateSoaking) && latest.AttestationReference != nil
	}
	return detail
}

func (s *snapshot) flagDetailFor(flagCode string) flagDetail {
	flag := s.flagByCode(flagCode)
	detail := flagDetail{
		FlagCode:              flag.FlagCode,
		FlagLabel:             flag.FlagLabel,
		RiskClassCode:         flag.RiskClassCode,
		MaxAdverseRateBP:      flag.MaxAdverseRateBP,
		HighestRungIndexCount: s.highestActiveRung(flagCode),
		Rungs:                 make([]rungDetail, 0, rungCount),
	}
	for rung := 1; rung <= rungCount; rung++ {
		detail.Rungs = append(detail.Rungs, s.rungDetailFor(flagCode, rung))
	}
	return detail
}

func (s *snapshot) evidencePackFor(flagCode string) evidencePackRecord {
	pack := evidencePackRecord{
		PackCode:                     "PACK-" + flagCode,
		FlagCode:                     flagCode,
		HighestRungIndexCount:        s.highestActiveRung(flagCode),
		GapRungIndexCounts:           []int{},
		SoakSatisfiedRungIndexCounts: []int{},
		RateSatisfiedRungIndexCounts: []int{},
	}
	maximum := s.flagByCode(flagCode).MaxAdverseRateBP
	for rung := 1; rung <= rungCount; rung++ {
		promotion := s.activePromotionAtRung(flagCode, rung)
		if promotion == nil {
			continue
		}
		cohort := s.cohortByRung(rung)
		if !s.recordBelowComplete(flagCode, rung) {
			pack.GapRungIndexCounts = append(pack.GapRungIndexCounts, rung)
		}
		if s.Now-promotion.PromotedAtMinutes >= cohort.MinSoakMinutes {
			pack.SoakSatisfiedRungIndexCounts = append(pack.SoakSatisfiedRungIndexCounts, rung)
		}
		if s.rateBP(flagCode, cohort.CohortCode) <= maximum {
			pack.RateSatisfiedRungIndexCounts = append(pack.RateSatisfiedRungIndexCounts, rung)
		}
	}
	return pack
}

func (s *snapshot) evidencePacks() []evidencePackRecord {
	packs := make([]evidencePackRecord, 0, len(s.flags))
	for _, flag := range s.flags {
		packs = append(packs, s.evidencePackFor(flag.FlagCode))
	}
	sort.Slice(packs, func(i, j int) bool { return packs[i].FlagCode < packs[j].FlagCode })
	return packs
}

// promotionsInSequenceOrder returns every promotion row, demoted rows included.
func (s *snapshot) promotionsInSequenceOrder() []promotionRecord {
	rows := make([]promotionRecord, len(s.promotions))
	copy(rows, s.promotions)
	sort.SliceStable(rows, func(i, j int) bool {
		return sequenceNumber(rows[i].PromotionCode) < sequenceNumber(rows[j].PromotionCode)
	})
	return rows
}

func (s *snapshot) promotionsForFlag(flagCode string) []promotionRecord {
	rows := make([]promotionRecord, 0)
	for _, promotion := range s.promotions {
		if promotion.FlagCode == flagCode {
			rows = append(rows, promotion)
		}
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].PromotedAtMinutes != rows[j].PromotedAtMinutes {
			return rows[i].PromotedAtMinutes < rows[j].PromotedAtMinutes
		}
		return sequenceNumber(rows[i].PromotionCode) < sequenceNumber(rows[j].PromotionCode)
	})
	return rows
}
