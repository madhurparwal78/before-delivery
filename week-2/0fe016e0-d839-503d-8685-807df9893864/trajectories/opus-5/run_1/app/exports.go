package main

import (
	"encoding/json"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
)

type deliverable struct {
	rule     string
	filename string
	render   func(state *snapshot) string
}

var deliverables = []deliverable{
	{rule: "DP-09", filename: "ladder-state.csv", render: renderLadderState},
	{rule: "DP-10", filename: "evidence-pack.json", render: renderEvidencePack},
	{rule: "DP-11", filename: "adverse-rates.txt", render: renderAdverseRates},
}

func (a *app) handleRender(file deliverable) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !a.ready.Load() {
			writeFailure(w, errDatabaseUnavailable)
			return
		}
		raw, err := renderRequestBody(r)
		if err != nil {
			writeFailure(w, err)
			return
		}
		fields, errors := parseFields(raw, []string{"format"}, nil)
		if fields == nil {
			writeFailure(w, fieldFailure(errors))
			return
		}
		if value, present := fields["format"]; present && !isJSONNull(value) {
			if _, ok := asString(value); !ok {
				errors.add("format", "must be text")
			}
		}
		if errors.any() {
			writeFailure(w, fieldFailure(errors))
			return
		}
		state := a.readSnapshotFor(w, r)
		if state == nil {
			return
		}
		if err := os.WriteFile(file.filename, []byte(file.render(state)), 0o644); err != nil {
			writeFailure(w, failure(http.StatusServiceUnavailable, "the deliverable could not be written"))
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"filename": file.filename})
	}
}

// renderRequestBody applies the write limits, treating an empty body as {}.
func renderRequestBody(r *http.Request) ([]byte, error) {
	if r.Header.Get("Content-Type") == "" && r.ContentLength == 0 {
		return []byte("{}"), nil
	}
	raw, err := readWriteBody(r)
	if err != nil {
		return nil, err
	}
	if len(strings.TrimSpace(string(raw))) == 0 {
		return []byte("{}"), nil
	}
	return raw, nil
}

func (a *app) handleLatest(file deliverable) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		content, err := os.ReadFile(file.filename)
		if err != nil {
			writeFailure(w, failure(http.StatusNotFound, "not rendered yet"))
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"filename": file.filename,
			"content":  string(content),
		})
	}
}

// csvField writes one `ladder-state.csv` field: formula neutralisation first,
// then quoting. The single quote exists only in this file.
func csvField(value string) string {
	if value != "" && strings.ContainsRune("=+-@\t\r", rune(value[0])) {
		value = "'" + value
	}
	if strings.ContainsAny(value, ",\"\r\n") {
		value = `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
	}
	return value
}

func renderLadderState(state *snapshot) string {
	var builder strings.Builder
	builder.WriteString("flag_code,rung_index_count,cohort_code,active_flag,promoted_at_minutes,demoted_at_minutes,attestation_reference\n")
	for _, flag := range sortedFlagCodes(state) {
		for rung := 1; rung <= rungCount; rung++ {
			cohort := state.cohortByRung(rung)
			latest := state.latestPromotion(flag, cohort.CohortCode)
			activeFlag := "false"
			promotedAt := ""
			demotedAt := ""
			reference := ""
			if latest != nil {
				promotedAt = strconv.Itoa(latest.PromotedAtMinutes)
				if latest.DemotedAtMinutes == nil {
					activeFlag = "true"
				} else {
					demotedAt = strconv.Itoa(*latest.DemotedAtMinutes)
				}
				if latest.AttestationReference != nil {
					reference = *latest.AttestationReference
				}
			}
			fields := []string{
				flag,
				strconv.Itoa(rung),
				cohort.CohortCode,
				activeFlag,
				promotedAt,
				demotedAt,
				reference,
			}
			for i, field := range fields {
				if i > 0 {
					builder.WriteString(",")
				}
				builder.WriteString(csvField(field))
			}
			builder.WriteString("\n")
		}
	}
	return builder.String()
}

type evidencePackExport struct {
	FlagCode                     string `json:"flag_code"`
	HighestRungIndexCount        int    `json:"highest_rung_index_count"`
	GapRungIndexCounts           []int  `json:"gap_rung_index_counts"`
	SoakSatisfiedRungIndexCounts []int  `json:"soak_satisfied_rung_index_counts"`
	RateSatisfiedRungIndexCounts []int  `json:"rate_satisfied_rung_index_counts"`
}

func renderEvidencePack(state *snapshot) string {
	exports := make([]evidencePackExport, 0, len(state.flags))
	for _, pack := range state.evidencePacks() {
		exports = append(exports, evidencePackExport{
			FlagCode:                     pack.FlagCode,
			HighestRungIndexCount:        pack.HighestRungIndexCount,
			GapRungIndexCounts:           pack.GapRungIndexCounts,
			SoakSatisfiedRungIndexCounts: pack.SoakSatisfiedRungIndexCounts,
			RateSatisfiedRungIndexCounts: pack.RateSatisfiedRungIndexCounts,
		})
	}
	line, err := json.Marshal(exports)
	if err != nil {
		return "[]\n"
	}
	return string(line) + "\n"
}

func renderAdverseRates(state *snapshot) string {
	var builder strings.Builder
	cohortCodes := make([]string, 0, len(state.cohorts))
	for _, cohort := range state.cohorts {
		cohortCodes = append(cohortCodes, cohort.CohortCode)
	}
	sort.Strings(cohortCodes)
	for _, flagCode := range sortedFlagCodes(state) {
		maximum := state.flagByCode(flagCode).MaxAdverseRateBP
		for _, cohortCode := range cohortCodes {
			cohort := state.cohortByCode(cohortCode)
			builder.WriteString(strings.Join([]string{
				flagCode,
				cohortCode,
				strconv.Itoa(state.eventCount(flagCode, cohortCode)),
				strconv.Itoa(cohort.DeviceCount),
				strconv.Itoa(state.rateBP(flagCode, cohortCode)),
				strconv.Itoa(maximum),
			}, " "))
			builder.WriteString("\n")
		}
	}
	return builder.String()
}

func sortedFlagCodes(state *snapshot) []string {
	codes := make([]string, 0, len(state.flags))
	for _, flag := range state.flags {
		codes = append(codes, flag.FlagCode)
	}
	sort.Strings(codes)
	return codes
}
