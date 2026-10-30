package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
)

// csvField writes one ladder-state.csv field in the published two steps:
// first a single quote in front of a leading =, +, -, @, tab or carriage
// return, then double-quote wrapping when the field now contains a comma, a
// double quote, a carriage return or a line feed, with inner quotes doubled.
// The single quote exists only in this file.
func csvField(v string) string {
	if v == "" {
		return ""
	}
	switch v[0] {
	case '=', '+', '-', '@', '\t', '\r':
		v = "'" + v
	}
	if strings.ContainsAny(v, ",\"\r\n") {
		v = "\"" + strings.ReplaceAll(v, "\"", "\"\"") + "\""
	}
	return v
}

func optionalInt(v *int64) string {
	if v == nil {
		return ""
	}
	return strconv.FormatInt(*v, 10)
}

func optionalString(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

// renderLadderState writes ladder-state.csv from live state: one row per
// flag and rung pair, sorted by flag_code then rung index ascending.
func (a *app) renderLadderState() (string, error) {
	flags, err := loadFlags(a.db)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	b.WriteString("flag_code,rung_index_count,cohort_code,active_flag,promoted_at_minutes,demoted_at_minutes,attestation_reference\n")
	for _, f := range flags {
		snap, err := loadFlagSnapshot(a.db, f.flagCode, a.svc.clock.now())
		if err != nil {
			return "", err
		}
		for _, c := range snap.cohorts {
			p := snap.latest(c.cohortCode)
			row := [7]string{
				f.flagCode,
				strconv.Itoa(c.rungIndexCount),
				c.cohortCode,
				"false",
				"",
				"",
				"",
			}
			if p != nil {
				row[3] = strconv.FormatBool(p.active())
				row[4] = strconv.FormatInt(p.promotedAtMinutes, 10)
				row[5] = optionalInt(p.demotedAtMinutes)
				row[6] = optionalString(p.attestationReference)
			}
			for i, v := range row {
				if i > 0 {
					b.WriteString(",")
				}
				b.WriteString(csvField(v))
			}
			b.WriteString("\n")
		}
	}
	return b.String(), nil
}

// renderEvidencePack writes evidence-pack.json: one line of compact JSON
// with keys in the published order and every empty list as an empty array.
func (a *app) renderEvidencePack() (string, error) {
	flags, err := loadFlags(a.db)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	b.WriteString("[")
	for i, f := range flags {
		snap, err := loadFlagSnapshot(a.db, f.flagCode, a.svc.clock.now())
		if err != nil {
			return "", err
		}
		if i > 0 {
			b.WriteString(",")
		}
		fmt.Fprintf(&b, `{"flag_code":%q,"highest_rung_index_count":%d,"gap_rung_index_counts":[%s],"soak_satisfied_rung_index_counts":[%s],"rate_satisfied_rung_index_counts":[%s]}`,
			f.flagCode, snap.highestActiveRung(),
			intListJSON(snap.gapRungs()),
			intListJSON(snap.soakSatisfiedRungs()),
			intListJSON(snap.rateSatisfiedRungs()))
	}
	b.WriteString("]\n")
	return b.String(), nil
}

func intListJSON(v []int) string {
	parts := make([]string, 0, len(v))
	for _, n := range v {
		parts = append(parts, strconv.Itoa(n))
	}
	return strings.Join(parts, ",")
}

// renderAdverseRates writes adverse-rates.txt: one line per flag and cohort,
// sorted by flag_code then cohort_code ascending.
func (a *app) renderAdverseRates() (string, error) {
	flags, err := loadFlags(a.db)
	if err != nil {
		return "", err
	}
	cohorts, err := loadCohorts(a.db)
	if err != nil {
		return "", err
	}
	sorted := make([]cohortRow, len(cohorts))
	copy(sorted, cohorts)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].cohortCode < sorted[j].cohortCode })
	var b strings.Builder
	for _, f := range flags {
		snap, err := loadFlagSnapshot(a.db, f.flagCode, a.svc.clock.now())
		if err != nil {
			return "", err
		}
		for _, c := range sorted {
			fmt.Fprintf(&b, "%s %s %d %d %d %d\n",
				f.flagCode, c.cohortCode, snap.eventCount(c.cohortCode), c.deviceCount,
				snap.rateBp(c.cohortCode), snap.flag.maxAdverseRateBp)
		}
	}
	return b.String(), nil
}

// deliverables maps each DP export to its filename and renderer.
var deliverables = map[string]struct {
	filename string
	render   func(*app) (string, error)
}{
	"DP-09": {"ladder-state.csv", (*app).renderLadderState},
	"DP-10": {"evidence-pack.json", (*app).renderEvidencePack},
	"DP-11": {"adverse-rates.txt", (*app).renderAdverseRates},
}

func (a *app) handleRender(w http.ResponseWriter, r *http.Request, dp string) {
	d, ok := deliverables[dp]
	if !ok {
		writeError(w, 404, "unknown deliverable")
		return
	}
	body, boundaryOK := writeBoundary(w, r)
	if !boundaryOK {
		return
	}
	doc, ferr := parseBody(body, map[string]bool{"format": true}, nil)
	if ferr != nil {
		a.writeDomainErr(w, ferr)
		return
	}
	if v, present := doc.raw["format"]; present && string(v) != "null" {
		var s string
		if err := json.Unmarshal(v, &s); err != nil {
			a.writeDomainErr(w, fieldErrs(map[string]string{"format": "must be text"}))
			return
		}
	}
	content, err := d.render(a)
	if err != nil {
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	if err := os.WriteFile(d.filename, []byte(content), 0o644); err != nil {
		writeError(w, 500, "internal error")
		return
	}
	writeJSON(w, 201, map[string]string{"filename": d.filename})
}

func (a *app) handleLatest(w http.ResponseWriter, r *http.Request, dp string) {
	d, ok := deliverables[dp]
	if !ok {
		writeError(w, 404, "unknown deliverable")
		return
	}
	content, err := os.ReadFile(d.filename)
	if err != nil {
		writeError(w, 404, "not rendered yet")
		return
	}
	writeJSON(w, 200, map[string]string{"filename": d.filename, "content": string(content)})
}

// redLineAbort stops a write transaction whose proposed write would have
// reached a never-state. The write is refused and rolled back, and the
// handler records the requirement in the ledger.
type redLineAbort struct {
	redLine string
	detail  string
}

func (e *redLineAbort) Error() string { return e.redLine }

// checkInvariants is the never-state check for one flag. It runs inside a
// write transaction after the proposed write, so a write that would reach a
// never-state is refused, and the ledger records it. Because the gates
// refuse such writes first, the ledger stays empty.
func checkInvariants(tx *sql.Tx, flagCode string, now int64) (*redLineAbort, error) {
	snap, err := loadFlagSnapshot(tx, flagCode, now)
	if err != nil {
		return nil, err
	}
	if snap == nil {
		return nil, nil
	}
	gaps := snap.gapRungs()
	isGap := func(rung int) bool {
		for _, g := range gaps {
			if g == rung {
				return true
			}
		}
		return false
	}
	for _, c := range snap.cohorts {
		active := 0
		for _, p := range snap.byCohort[c.cohortCode] {
			if p.active() {
				active++
			}
		}
		if active > 1 {
			return &redLineAbort{redLine: "DP-01", detail: "two active promotions at rung " + strconv.Itoa(c.rungIndexCount)}, nil
		}
		if active != 1 {
			continue
		}
		if c.rungIndexCount > 1 && snap.activePromotion(snap.cohortByRung[c.rungIndexCount-1].cohortCode) == nil && !isGap(c.rungIndexCount) {
			return &redLineAbort{redLine: "DP-01", detail: "active rung above an inactive rung, not listed as a gap"}, nil
		}
		if snap.activePromotion(c.cohortCode).attestationReference == nil && !isGap(c.rungIndexCount) {
			return &redLineAbort{redLine: "DP-04", detail: "active promotion without a reference, not listed as a gap"}, nil
		}
	}
	// DP-06: an active rung above a breaching rung.
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
	if lowestBreach > 0 {
		for _, c := range snap.cohorts {
			if c.rungIndexCount > lowestBreach && snap.activePromotion(c.cohortCode) != nil {
				return &redLineAbort{redLine: "DP-06", detail: "active rung above a breaching rung"}, nil
			}
		}
	}
	return nil, nil
}

// recordLedger writes a ledger entry naming the requirement in red_line.
func (a *app) recordLedger(redLine, detail string) {
	tx, err := a.db.Begin()
	if err != nil {
		return
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`INSERT INTO ledger_entry (red_line, detail, at_minutes) VALUES ($1,$2,$3)`, redLine, detail, a.svc.clock.now()); err != nil {
		return
	}
	_ = tx.Commit()
}
