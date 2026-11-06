package main

import "sort"

// cohortRow mirrors the cohort table.
type cohortRow struct {
	cohortCode     string
	rungIndexCount int
	cohortLabel    string
	deviceCount    int
	minSoakMinutes int
}

// flagRow mirrors the capability_flag table.
type flagRow struct {
	flagCode         string
	flagLabel        string
	riskClassCode    string
	maxAdverseRateBp int
}

// deviceRow mirrors the device table.
type deviceRow struct {
	deviceCode           string
	cohortCode           string
	serialReference      string
	firmwareVersionLabel string
}

// promotionRow mirrors the promotion table.
type promotionRow struct {
	sequenceNumber       int64
	promotionCode        string
	flagCode             string
	cohortCode           string
	promotedAtMinutes    int64
	demotedAtMinutes     *int64
	attestationReference *string
}

// eventRow mirrors the adverse_event table, with the device's cohort resolved
// at load time so the adverse rate never needs a second query.
type eventRow struct {
	eventCode         string
	deviceCode        string
	cohortCode        string
	flagCode          string
	occurredAtMinutes int64
	severityBandCode  string
}

// latestPromotion returns the pair's latest promotion as the API defines it:
// the largest promoted_at_minutes, ties broken by the larger sequence number.
func latestPromotion(rows []promotionRow, cohortCode string) *promotionRow {
	var best *promotionRow
	for i := range rows {
		p := &rows[i]
		if p.cohortCode != cohortCode {
			continue
		}
		if best == nil || p.promotedAtMinutes > best.promotedAtMinutes ||
			(p.promotedAtMinutes == best.promotedAtMinutes && p.sequenceNumber > best.sequenceNumber) {
			best = p
		}
	}
	return best
}

func (p *promotionRow) active() bool { return p != nil && p.demotedAtMinutes == nil }

// stateSnapshot is one reading of a flag's whole ladder, taken inside a single
// transaction. Every derived figure on every surface comes from here.
type stateSnapshot struct {
	flag         flagRow
	cohorts      []cohortRow // ordered by rung index
	cohortByRung map[int]cohortRow
	promotions   []promotionRow // every row of the flag, all cohorts
	events       []eventRow     // every event of the flag
	byCohort     map[string][]promotionRow
	now          int64
}

func buildStateSnapshot(flag flagRow, cohorts []cohortRow, promotions []promotionRow, events []eventRow, now int64) *stateSnapshot {
	sort.Slice(cohorts, func(i, j int) bool { return cohorts[i].rungIndexCount < cohorts[j].rungIndexCount })
	s := &stateSnapshot{
		flag:         flag,
		cohorts:      cohorts,
		cohortByRung: make(map[int]cohortRow, len(cohorts)),
		promotions:   promotions,
		events:       events,
		byCohort:     make(map[string][]promotionRow),
		now:          now,
	}
	for _, c := range cohorts {
		s.cohortByRung[c.rungIndexCount] = c
	}
	for _, p := range promotions {
		s.byCohort[p.cohortCode] = append(s.byCohort[p.cohortCode], p)
	}
	return s
}

// latest returns the pair's latest promotion, resolved inside this snapshot.
func (s *stateSnapshot) latest(cohortCode string) *promotionRow {
	rows := s.byCohort[cohortCode]
	var best *promotionRow
	for i := range rows {
		p := &rows[i]
		if best == nil || p.promotedAtMinutes > best.promotedAtMinutes ||
			(p.promotedAtMinutes == best.promotedAtMinutes && p.sequenceNumber > best.sequenceNumber) {
			best = p
		}
	}
	return best
}

// activePromotion returns the pair's active promotion, or nil.
func (s *stateSnapshot) activePromotion(cohortCode string) *promotionRow {
	p := s.latest(cohortCode)
	if p.active() {
		return p
	}
	return nil
}

// highestActiveRung is the flag's highest active rung, or 0.
func (s *stateSnapshot) highestActiveRung() int {
	highest := 0
	for _, c := range s.cohorts {
		if s.activePromotion(c.cohortCode) != nil && c.rungIndexCount > highest {
			highest = c.rungIndexCount
		}
	}
	return highest
}

// eventCount is the pair's adverse figure: events of this flag on this
// cohort's devices whose instant falls inside any interval while the flag was
// active there, past intervals included, each event counted once.
func (s *stateSnapshot) eventCount(cohortCode string) int {
	count := 0
	for _, e := range s.events {
		if e.cohortCode != cohortCode {
			continue
		}
		if !s.eventInside(cohortCode, e.occurredAtMinutes) {
			continue
		}
		count++
	}
	return count
}

// eventInside reports whether the instant falls inside any of the pair's
// active intervals: [promoted_at_minutes, demoted_at_minutes), or to now when
// the promotion is still active.
func (s *stateSnapshot) eventInside(cohortCode string, at int64) bool {
	for i := range s.byCohort[cohortCode] {
		p := &s.byCohort[cohortCode][i]
		if !p.active() {
			if at >= p.promotedAtMinutes && at < *p.demotedAtMinutes {
				return true
			}
			continue
		}
		if at >= p.promotedAtMinutes && at <= s.now {
			return true
		}
	}
	return false
}

// rateBp is the pair's adverse rate in whole basis points, rounded down.
func (s *stateSnapshot) rateBp(cohortCode string) int {
	for _, c := range s.cohorts {
		if c.cohortCode == cohortCode {
			if c.deviceCount == 0 {
				return 0
			}
			return s.eventCount(cohortCode) * 10000 / c.deviceCount
		}
	}
	return 0
}

func rungOf(s *stateSnapshot, cohortCode string) int {
	for _, c := range s.cohorts {
		if c.cohortCode == cohortCode {
			return c.rungIndexCount
		}
	}
	return 0
}

// soakElapsed is now minus the active promotion's instant, or nil.
func (s *stateSnapshot) soakElapsed(cohortCode string) *int {
	p := s.activePromotion(cohortCode)
	if p == nil {
		return nil
	}
	e := int(s.now - p.promotedAtMinutes)
	return &e
}

// stateWord is the rung state word, decided in exactly one place.
func (s *stateSnapshot) stateWord(cohortCode string) string {
	rung := s.rungOfCohort(cohortCode)
	p := s.latest(cohortCode)
	if p == nil {
		return "Not promoted"
	}
	if !p.active() {
		return "Demoted"
	}
	if !s.recordBelowComplete(rung) {
		return "Gap"
	}
	c := s.cohortByRung[rung]
	if s.now-p.promotedAtMinutes < int64(c.minSoakMinutes) {
		return "Soaking"
	}
	return "Active"
}

// attested reports whether the rung reads Attested.
func (s *stateSnapshot) attested(cohortCode string) bool {
	p := s.activePromotion(cohortCode)
	return p != nil && p.attestationReference != nil
}

// recordBelowComplete is the DP-07 record below: for an active rung r, the
// record below is complete when r carries a reference and, for r above 1, the
// rung below is active, has soaked at least its minimum by now, and has a
// rate at or below the maximum. This is the evidence pack's one definition of
// a gap, and it is also the rung state word's.
func (s *stateSnapshot) recordBelowComplete(rung int) bool {
	c, ok := s.cohortByRung[rung]
	if !ok {
		return false
	}
	p := s.activePromotion(c.cohortCode)
	if p == nil || p.attestationReference == nil {
		return false
	}
	if rung == 1 {
		return true
	}
	below := s.cohortByRung[rung-1]
	bp := s.activePromotion(below.cohortCode)
	if bp == nil {
		return false
	}
	if s.now-bp.promotedAtMinutes < int64(below.minSoakMinutes) {
		return false
	}
	if s.rateBp(below.cohortCode) > s.flag.maxAdverseRateBp {
		return false
	}
	return true
}

// recordBelowCompleteCohort resolves a cohort's rung and asks recordBelowComplete.
func (s *stateSnapshot) recordBelowCompleteCohort(cohortCode string) bool {
	return s.recordBelowComplete(s.rungOfCohort(cohortCode))
}

// gapRungs lists the active rungs whose record below is incomplete, ascending.
func (s *stateSnapshot) gapRungs() []int {
	var out []int
	for _, c := range s.cohorts {
		p := s.activePromotion(c.cohortCode)
		if p == nil {
			continue
		}
		if !s.recordBelowComplete(c.rungIndexCount) {
			out = append(out, c.rungIndexCount)
		}
	}
	return out
}

// soakSatisfiedRungs lists the active rungs whose own soak elapsed is at
// least their own minimum, ascending.
func (s *stateSnapshot) soakSatisfiedRungs() []int {
	var out []int
	for _, c := range s.cohorts {
		p := s.activePromotion(c.cohortCode)
		if p == nil {
			continue
		}
		if s.now-p.promotedAtMinutes >= int64(c.minSoakMinutes) {
			out = append(out, c.rungIndexCount)
		}
	}
	return out
}

// rateSatisfiedRungs lists the active rungs whose own rate is at or below the
// flag maximum, ascending.
func (s *stateSnapshot) rateSatisfiedRungs() []int {
	var out []int
	for _, c := range s.cohorts {
		p := s.activePromotion(c.cohortCode)
		if p == nil {
			continue
		}
		if s.rateBp(c.cohortCode) <= s.flag.maxAdverseRateBp {
			out = append(out, c.rungIndexCount)
		}
	}
	return out
}
