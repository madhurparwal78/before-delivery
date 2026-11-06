package main

import (
	"embed"
	"html/template"
	"io/fs"
	"net/http"
	"sort"
	"strconv"
	"strings"
)

//go:embed web/static
var staticRoot embed.FS

//go:embed web/templates
var templateRoot embed.FS

var (
	staticFiles   fs.FS
	pageTemplates *template.Template
)

func init() {
	sub, err := fs.Sub(staticRoot, "web/static")
	if err != nil {
		panic(err)
	}
	staticFiles = sub
	pageTemplates = template.Must(template.ParseFS(templateRoot, "web/templates/*.html"))
}

type readerPage struct {
	path    string
	heading string
	entity  string
	columns []string
}

var readerPages = []readerPage{
	{
		path: "capability_flag", heading: "Capability flags", entity: "capability_flag",
		columns: []string{"flag_code", "flag_label", "risk_class_code", "max_adverse_rate_bp"},
	},
	{
		path: "cohort", heading: "Cohorts", entity: "cohort",
		columns: []string{"cohort_code", "rung_index_count", "cohort_label", "device_count", "min_soak_minutes"},
	},
	{
		path: "device", heading: "Devices", entity: "device",
		columns: []string{"device_code", "cohort_code", "serial_reference", "firmware_version_label"},
	},
	{
		path: "promotion", heading: "Promotions", entity: "promotion",
		columns: []string{"promotion_code", "flag_code", "cohort_code", "promoted_at_minutes", "demoted_at_minutes", "attestation_reference"},
	},
	{
		path: "adverse_event", heading: "Adverse events", entity: "adverse_event",
		columns: []string{"event_code", "device_code", "flag_code", "occurred_at_minutes", "severity_band_code"},
	},
	{
		path: "evidence_pack", heading: "Evidence packs", entity: "evidence_pack",
		columns: []string{"pack_code", "flag_code", "highest_rung_index_count", "gap_rung_index_counts", "soak_satisfied_rung_index_counts", "rate_satisfied_rung_index_counts"},
	},
}

func minutesText(value int) string { return strconv.Itoa(value) + " minutes" }

func basisPointsText(value int) string { return strconv.Itoa(value) + " basis points" }

func instantText(value *int) string {
	if value == nil {
		return "none"
	}
	return strconv.Itoa(*value)
}

func referenceText(value *string) string {
	if value == nil || *value == "" {
		return "none"
	}
	return *value
}

func rungListText(values []int) string {
	if len(values) == 0 {
		return "none"
	}
	parts := make([]string, 0, len(values))
	for _, value := range values {
		parts = append(parts, strconv.Itoa(value))
	}
	return strings.Join(parts, ", ")
}

func readerRows(state *snapshot, entity string) [][]string {
	switch entity {
	case "capability_flag":
		rows := [][]string{}
		for _, flag := range state.flags {
			rows = append(rows, []string{flag.FlagCode, flag.FlagLabel, flag.RiskClassCode, basisPointsText(flag.MaxAdverseRateBP)})
		}
		return rows
	case "cohort":
		rows := [][]string{}
		for _, cohort := range state.cohorts {
			rows = append(rows, []string{
				cohort.CohortCode,
				strconv.Itoa(cohort.RungIndexCount),
				cohort.CohortLabel,
				strconv.Itoa(cohort.DeviceCount),
				minutesText(cohort.MinSoakMinutes),
			})
		}
		return rows
	case "device":
		rows := [][]string{}
		for _, device := range state.devices {
			rows = append(rows, []string{device.DeviceCode, device.CohortCode, device.SerialReference, device.FirmwareVersionLabel})
		}
		return rows
	case "promotion":
		rows := [][]string{}
		for _, promotion := range state.promotionsInSequenceOrder() {
			promotedAt := promotion.PromotedAtMinutes
			rows = append(rows, []string{
				promotion.PromotionCode,
				promotion.FlagCode,
				promotion.CohortCode,
				instantText(&promotedAt),
				instantText(promotion.DemotedAtMinutes),
				referenceText(promotion.AttestationReference),
			})
		}
		return rows
	case "adverse_event":
		rows := [][]string{}
		for _, event := range state.events {
			occurredAt := event.OccurredAtMinutes
			rows = append(rows, []string{
				event.EventCode,
				event.DeviceCode,
				event.FlagCode,
				instantText(&occurredAt),
				event.SeverityBandCode,
			})
		}
		return rows
	default:
		rows := [][]string{}
		for _, pack := range state.evidencePacks() {
			rows = append(rows, []string{
				pack.PackCode,
				pack.FlagCode,
				strconv.Itoa(pack.HighestRungIndexCount),
				rungListText(pack.GapRungIndexCounts),
				rungListText(pack.SoakSatisfiedRungIndexCounts),
				rungListText(pack.RateSatisfiedRungIndexCounts),
			})
		}
		return rows
	}
}

type pageLink struct {
	Path    string
	Heading string
}

func (a *app) handleHome(w http.ResponseWriter, r *http.Request) {
	links := make([]pageLink, 0, len(readerPages))
	for _, page := range readerPages {
		links = append(links, pageLink{Path: "/" + page.path, Heading: page.heading})
	}
	a.renderPage(w, "home.html", map[string]any{"Links": links})
}

func (a *app) handleReaderPage(page readerPage) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		state := a.readSnapshotFor(w, r)
		if state == nil {
			return
		}
		a.renderPage(w, "reader.html", map[string]any{
			"Heading": page.heading,
			"Total":   state.entityTotal(page.entity),
			"Columns": page.columns,
			"Rows":    readerRows(state, page.entity),
		})
	}
}

func (a *app) handleConsole(w http.ResponseWriter, r *http.Request) {
	state := a.readSnapshotFor(w, r)
	if state == nil {
		return
	}
	cohorts := make([]cohortRecord, len(state.cohorts))
	copy(cohorts, state.cohorts)
	sort.Slice(cohorts, func(i, j int) bool { return cohorts[i].RungIndexCount < cohorts[j].RungIndexCount })
	a.renderPage(w, "console.html", map[string]any{
		"Flags":   state.flagsInSeedOrder(),
		"Cohorts": cohorts,
		"Devices": state.devices,
		"Bands":   []string{"BAND-LOW", "BAND-MED", "BAND-HIGH"},
	})
}

func (a *app) renderPage(w http.ResponseWriter, name string, data any) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if err := pageTemplates.ExecuteTemplate(w, name, data); err != nil {
		http.Error(w, "the page could not be rendered", http.StatusInternalServerError)
	}
}
