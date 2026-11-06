package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
)

// export is one on-demand deliverable written into the working directory root. Its content
// is built from every ladder in flag code order.
type export struct {
	requirement string
	filename    string
	content     func(ladders []*Ladder) string
}

var exports = []export{
	{"DP-09", "ladder-state.csv", ladderStateCSV},
	{"DP-10", "evidence-pack.json", evidencePackJSON},
	{"DP-11", "adverse-rates.txt", adverseRatesText},
}

func (a *App) renderExport(deliverable export) writeHandler {
	return func(ctx context.Context, tx *sql.Tx, r *http.Request, raw []byte) (outcome, error) {
		fields, isObject := decodeFields(raw, "format")
		if !isObject {
			return fieldErrorOutcome(fields.errors), nil
		}
		if value, given := fields.given("format"); given {
			if _, isText := text(value); !isText {
				fields.errors.add("format", msgFormat)
			}
		}
		if len(fields.errors) > 0 {
			return fieldErrorOutcome(fields.errors), nil
		}
		if err := shareEveryFlag(ctx, tx); err != nil {
			return outcome{}, err
		}
		ladders, err := allLadders(ctx, tx)
		if err != nil {
			return outcome{}, err
		}
		content := deliverable.content(ladders)
		a.exportMu.Lock()
		defer a.exportMu.Unlock()
		if err := os.WriteFile(deliverable.filename, []byte(content), 0o644); err != nil {
			return outcome{}, err
		}
		return outcome{status: http.StatusCreated, body: map[string]string{"filename": deliverable.filename}}, nil
	}
}

func (a *App) latestExport(deliverable export) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		a.exportMu.Lock()
		content, err := os.ReadFile(deliverable.filename)
		a.exportMu.Unlock()
		if errors.Is(err, fs.ErrNotExist) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not rendered yet"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "the export could not be read"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"filename": deliverable.filename, "content": string(content)})
	}
}

// csvField neutralises a leading formula character, then quotes the field when it needs it.
func csvField(value string) string {
	if value != "" && strings.ContainsAny(value[:1], "=+-@\t\r") {
		value = "'" + value
	}
	if strings.ContainsAny(value, ",\"\r\n") {
		value = `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
	}
	return value
}

func optionalNumber(number *int) string {
	if number == nil {
		return ""
	}
	return strconv.Itoa(*number)
}

func optionalText(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// ladderStateCSV writes one row per flag and rung pair from the pair's latest promotion.
func ladderStateCSV(ladders []*Ladder) string {
	var out strings.Builder
	out.WriteString("flag_code,rung_index_count,cohort_code,active_flag,promoted_at_minutes,demoted_at_minutes,attestation_reference\n")
	for _, ladder := range ladders {
		for _, cohort := range ladder.Cohorts {
			latest := ladder.latestPromotion(cohort)
			fields := []string{ladder.Flag.Code, strconv.Itoa(cohort.RungIndex), cohort.Code, "false", "", "", ""}
			if latest != nil {
				fields[3] = strconv.FormatBool(latest.DemotedAt == nil)
				fields[4] = strconv.Itoa(latest.PromotedAt)
				fields[5] = optionalNumber(latest.DemotedAt)
				fields[6] = optionalText(latest.AttestationReference)
			}
			for index, field := range fields {
				fields[index] = csvField(field)
			}
			out.WriteString(strings.Join(fields, ",") + "\n")
		}
	}
	return out.String()
}

// packExport is an evidence pack entry with the export's keys, in the export's order.
type packExport struct {
	FlagCode           string `json:"flag_code"`
	HighestActiveRung  int    `json:"highest_rung_index_count"`
	GapRungs           []int  `json:"gap_rung_index_counts"`
	SoakSatisfiedRungs []int  `json:"soak_satisfied_rung_index_counts"`
	RateSatisfiedRungs []int  `json:"rate_satisfied_rung_index_counts"`
}

func evidencePackJSON(ladders []*Ladder) string {
	entries := []packExport{}
	for _, pack := range evidencePacks(ladders) {
		entries = append(entries, packExport{pack.FlagCode, pack.HighestActiveRung, pack.GapRungs, pack.SoakSatisfiedRungs, pack.RateSatisfiedRungs})
	}
	line, _ := json.Marshal(entries)
	return string(line) + "\n"
}

// adverseRatesText writes one line per flag and cohort, sorted by both codes.
func adverseRatesText(ladders []*Ladder) string {
	var out strings.Builder
	for _, ladder := range ladders {
		cohorts := append([]Cohort(nil), ladder.Cohorts...)
		sort.Slice(cohorts, func(i, j int) bool { return cohorts[i].Code < cohorts[j].Code })
		for _, cohort := range cohorts {
			eventCount, rateBP := ladder.adverseFigures(cohort)
			fmt.Fprintf(&out, "%s %s %d %d %d %d\n", ladder.Flag.Code, cohort.Code, eventCount, cohort.DeviceCount, rateBP, ladder.Flag.MaxAdverseRateBP)
		}
	}
	return out.String()
}
