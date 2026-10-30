package main

import "fmt"

// Ladder is one flag with the live rows every derived figure is computed from at read time.
type Ladder struct {
	Flag       Flag
	Cohorts    []Cohort // ordered by rung index
	Promotions []Promotion
	Events     []AdverseEvent
	Now        int
}

// Refusal is a rule refusal (409): the copy, the rule and the figures the copy names.
type Refusal struct {
	Rule    string
	Copy    string
	Figures map[string]int
}

func (refusal *Refusal) body() map[string]any {
	body := map[string]any{"error": refusal.Copy, "rule": refusal.Rule}
	for name, figure := range refusal.Figures {
		body[name] = figure
	}
	return body
}

// Rung state words, in the order the first matching condition wins.
const (
	stateNotPromoted = "Not promoted"
	stateDemoted     = "Demoted"
	stateGap         = "Gap"
	stateSoaking     = "Soaking"
	stateActive      = "Active"
)

func (ladder *Ladder) cohortAt(rung int) Cohort {
	return ladder.Cohorts[rung-1]
}

func (ladder *Ladder) cohortByCode(code string) (Cohort, bool) {
	for _, cohort := range ladder.Cohorts {
		if cohort.Code == code {
			return cohort, true
		}
	}
	return Cohort{}, false
}

// latestPromotion is the pair's promotion with the largest promoted_at, ties to the larger sequence.
func (ladder *Ladder) latestPromotion(cohort Cohort) *Promotion {
	var latest *Promotion
	for index := range ladder.Promotions {
		promotion := &ladder.Promotions[index]
		if promotion.CohortCode != cohort.Code {
			continue
		}
		if latest == nil || promotion.PromotedAt > latest.PromotedAt ||
			(promotion.PromotedAt == latest.PromotedAt && promotion.Sequence > latest.Sequence) {
			latest = promotion
		}
	}
	return latest
}

// activePromotion is the pair's promotion without a demotion instant, if any.
func (ladder *Ladder) activePromotion(rung int) *Promotion {
	cohort := ladder.cohortAt(rung)
	for index := range ladder.Promotions {
		promotion := &ladder.Promotions[index]
		if promotion.CohortCode == cohort.Code && promotion.DemotedAt == nil {
			return promotion
		}
	}
	return nil
}

func (ladder *Ladder) highestActiveRung() int {
	highest := 0
	for _, cohort := range ladder.Cohorts {
		if ladder.activePromotion(cohort.RungIndex) != nil {
			highest = cohort.RungIndex
		}
	}
	return highest
}

func (ladder *Ladder) soakElapsed(promotion *Promotion) int {
	return ladder.Now - promotion.PromotedAt
}

// soaked reports whether an active promotion has soaked at least its cohort's minimum; exactly
// the minimum passes.
func (ladder *Ladder) soaked(cohort Cohort, promotion *Promotion) bool {
	return ladder.soakElapsed(promotion) >= cohort.MinSoakMinutes
}

// withinMaximum reports a rate at or below the flag's live maximum.
func (ladder *Ladder) withinMaximum(rateBP int) bool {
	return rateBP <= ladder.Flag.MaxAdverseRateBP
}

// adverseFigures counts each event of the flag on the cohort's devices that occurred inside any
// interval in which the flag was active there, and turns it into whole basis points of the
// cohort's stated fleet size.
func (ladder *Ladder) adverseFigures(cohort Cohort) (eventCount int, rateBP int) {
	for _, event := range ladder.Events {
		if event.CohortCode != cohort.Code {
			continue
		}
		for _, promotion := range ladder.Promotions {
			if promotion.CohortCode == cohort.Code && promotion.PromotedAt <= event.OccurredAt &&
				(promotion.DemotedAt == nil || event.OccurredAt < *promotion.DemotedAt) {
				eventCount++
				break
			}
		}
	}
	return eventCount, eventCount * 10000 / cohort.DeviceCount
}

// gate decides DP-01 to DP-04 for a promotion of the flag to the target rung. Standard
// promotions and the evidence pack check the attestation; a force enable skips only DP-04.
func (ladder *Ladder) gate(target Cohort, attestationReference string, checkAttestation bool) *Refusal {
	rung := target.RungIndex
	for below := 1; below < rung; below++ {
		if ladder.activePromotion(below) == nil {
			return &Refusal{
				Rule:    "DP-01",
				Copy:    fmt.Sprintf("Refused: rung %d needs an active promotion at rung %d first (DP-01).", rung, below),
				Figures: map[string]int{"missing_rung_index_count": below},
			}
		}
	}
	if rung > 1 {
		below := ladder.cohortAt(rung - 1)
		belowPromotion := ladder.activePromotion(below.RungIndex)
		if !ladder.soaked(below, belowPromotion) {
			elapsed := ladder.soakElapsed(belowPromotion)
			remaining := below.MinSoakMinutes - elapsed
			return &Refusal{
				Rule: "DP-02",
				Copy: fmt.Sprintf("Refused: rung %d has soaked %d minutes of %d minutes; %d minutes remain (DP-02).",
					below.RungIndex, elapsed, below.MinSoakMinutes, remaining),
				Figures: map[string]int{"elapsed_minutes": elapsed, "minimum_minutes": below.MinSoakMinutes, "remaining_minutes": remaining},
			}
		}
		if _, rateBP := ladder.adverseFigures(below); !ladder.withinMaximum(rateBP) {
			return &Refusal{
				Rule: "DP-03",
				Copy: fmt.Sprintf("Refused: rung %d adverse rate is %d basis points, above the maximum of %d basis points (DP-03).",
					below.RungIndex, rateBP, ladder.Flag.MaxAdverseRateBP),
				Figures: map[string]int{"rate_bp": rateBP, "max_adverse_rate_bp": ladder.Flag.MaxAdverseRateBP},
			}
		}
	}
	if checkAttestation && attestationReference == "" {
		return &Refusal{
			Rule: "DP-04",
			Copy: fmt.Sprintf("Refused: an attestation reference is required for rung %d (DP-04).", rung),
		}
	}
	return nil
}

// hasGap reports an active rung whose record below is incomplete: the same gate a standard
// promotion of that rung would face now, with the rung's own reference.
func (ladder *Ladder) hasGap(rung int) bool {
	promotion := ladder.activePromotion(rung)
	reference := ""
	if promotion.AttestationReference != nil {
		reference = *promotion.AttestationReference
	}
	return ladder.gate(ladder.cohortAt(rung), reference, true) != nil
}

// rungState is the one state word of a rung.
func (ladder *Ladder) rungState(cohort Cohort) string {
	latest := ladder.latestPromotion(cohort)
	switch {
	case latest == nil:
		return stateNotPromoted
	case latest.DemotedAt != nil:
		return stateDemoted
	case ladder.hasGap(cohort.RungIndex):
		return stateGap
	case !ladder.soaked(cohort, latest):
		return stateSoaking
	default:
		return stateActive
	}
}

// cascadeDemotions lists, highest first, every active rung above the lowest breaching rung.
func (ladder *Ladder) cascadeDemotions() []*Promotion {
	breaching := 0
	for _, cohort := range ladder.Cohorts {
		if ladder.activePromotion(cohort.RungIndex) == nil {
			continue
		}
		if _, rateBP := ladder.adverseFigures(cohort); !ladder.withinMaximum(rateBP) {
			breaching = cohort.RungIndex
			break
		}
	}
	if breaching == 0 {
		return nil
	}
	var demotions []*Promotion
	for rung := len(ladder.Cohorts); rung > breaching; rung-- {
		if promotion := ladder.activePromotion(rung); promotion != nil {
			demotions = append(demotions, promotion)
		}
	}
	return demotions
}

// RungDetail is one entry of the flag detail's rungs.
type RungDetail struct {
	RungIndex            int     `json:"rung_index_count"`
	CohortCode           string  `json:"cohort_code"`
	CohortLabel          string  `json:"cohort_label"`
	MinSoakMinutes       int     `json:"min_soak_minutes"`
	DeviceCount          int     `json:"device_count"`
	State                string  `json:"state"`
	Attested             bool    `json:"attested"`
	PromotionCode        *string `json:"promotion_code"`
	PromotedAt           *int    `json:"promoted_at_minutes"`
	DemotedAt            *int    `json:"demoted_at_minutes"`
	AttestationReference *string `json:"attestation_reference"`
	SoakElapsedMinutes   *int    `json:"soak_elapsed_minutes"`
	EventCount           int     `json:"event_count"`
	RateBP               int     `json:"rate_bp"`
	MaxAdverseRateBP     int     `json:"max_adverse_rate_bp"`
}

// FlagDetail is the response of GET /api/capability_flag/<flag_code>.
type FlagDetail struct {
	Code              string       `json:"flag_code"`
	Label             string       `json:"flag_label"`
	RiskClass         string       `json:"risk_class_code"`
	MaxAdverseRateBP  int          `json:"max_adverse_rate_bp"`
	HighestActiveRung int          `json:"highest_rung_index_count"`
	Rungs             []RungDetail `json:"rungs"`
}

func (ladder *Ladder) detail() FlagDetail {
	detail := FlagDetail{
		Code:              ladder.Flag.Code,
		Label:             ladder.Flag.Label,
		RiskClass:         ladder.Flag.RiskClass,
		MaxAdverseRateBP:  ladder.Flag.MaxAdverseRateBP,
		HighestActiveRung: ladder.highestActiveRung(),
	}
	for _, cohort := range ladder.Cohorts {
		eventCount, rateBP := ladder.adverseFigures(cohort)
		rung := RungDetail{
			RungIndex:        cohort.RungIndex,
			CohortCode:       cohort.Code,
			CohortLabel:      cohort.Label,
			MinSoakMinutes:   cohort.MinSoakMinutes,
			DeviceCount:      cohort.DeviceCount,
			State:            ladder.rungState(cohort),
			EventCount:       eventCount,
			RateBP:           rateBP,
			MaxAdverseRateBP: ladder.Flag.MaxAdverseRateBP,
		}
		if latest := ladder.latestPromotion(cohort); latest != nil {
			rung.PromotionCode = &latest.Code
			rung.PromotedAt = &latest.PromotedAt
			rung.DemotedAt = latest.DemotedAt
			rung.AttestationReference = latest.AttestationReference
			rung.Attested = (rung.State == stateActive || rung.State == stateSoaking) && latest.AttestationReference != nil
			if latest.DemotedAt == nil {
				elapsed := ladder.soakElapsed(latest)
				rung.SoakElapsedMinutes = &elapsed
			}
		}
		detail.Rungs = append(detail.Rungs, rung)
	}
	return detail
}

// EvidencePack is one flag's pack, every list ascending and never null.
type EvidencePack struct {
	PackCode           string `json:"pack_code"`
	FlagCode           string `json:"flag_code"`
	HighestActiveRung  int    `json:"highest_rung_index_count"`
	GapRungs           []int  `json:"gap_rung_index_counts"`
	SoakSatisfiedRungs []int  `json:"soak_satisfied_rung_index_counts"`
	RateSatisfiedRungs []int  `json:"rate_satisfied_rung_index_counts"`
}

func (ladder *Ladder) evidencePack() EvidencePack {
	pack := EvidencePack{
		PackCode:           packCode(ladder.Flag.Code),
		FlagCode:           ladder.Flag.Code,
		HighestActiveRung:  ladder.highestActiveRung(),
		GapRungs:           []int{},
		SoakSatisfiedRungs: []int{},
		RateSatisfiedRungs: []int{},
	}
	for _, cohort := range ladder.Cohorts {
		promotion := ladder.activePromotion(cohort.RungIndex)
		if promotion == nil {
			continue
		}
		if ladder.hasGap(cohort.RungIndex) {
			pack.GapRungs = append(pack.GapRungs, cohort.RungIndex)
		}
		if ladder.soaked(cohort, promotion) {
			pack.SoakSatisfiedRungs = append(pack.SoakSatisfiedRungs, cohort.RungIndex)
		}
		if _, rateBP := ladder.adverseFigures(cohort); ladder.withinMaximum(rateBP) {
			pack.RateSatisfiedRungs = append(pack.RateSatisfiedRungs, cohort.RungIndex)
		}
	}
	return pack
}
