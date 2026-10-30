package main

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"html/template"
	"io/fs"
	"net/http"
	"strconv"
	"strings"
)

//go:embed templates/*.html
var templateFiles embed.FS

//go:embed static
var staticFiles embed.FS

var pageTemplates = template.Must(template.ParseFS(templateFiles, "templates/*.html"))

var errStoreNotReady = errors.New("the store is not ready")

// readerTable is one entity's records as reader page cells, built from live state.
type readerTable struct {
	columns []string
	rows    [][]string
}

// readerEntity is one of the six read-only pages and its list route.
type readerEntity struct {
	Name  string
	Title string
	Lede  string // one line under the page's link on the reader home
	table func(ctx context.Context, tx *sql.Tx) (readerTable, error)
}

var readerEntities = []readerEntity{
	{"capability_flag", "Capability flags", "The firmware flags and each one's maximum adverse rate.", flagTable},
	{"cohort", "Cohorts", "The five rungs, bench fleet to full fleet, with fleet size and minimum soak.", cohortTable},
	{"device", "Devices", "Every device with its cohort, serial and firmware version.", deviceTable},
	{"promotion", "Promotions", "Every promotion row ever made, demoted rows included.", promotionTable},
	{"adverse_event", "Adverse events", "Recorded complaints, one per normalised event code.", adverseEventTable},
	{"evidence_pack", "Evidence packs", "Per flag: the highest rung, gap rungs and the satisfied soak and rate rungs.", evidencePackTable},
}

func minutesText(minutes int) string { return strconv.Itoa(minutes) + " minutes" }

func basisPointsText(basisPoints int) string { return strconv.Itoa(basisPoints) + " basis points" }

func instantText(minute *int) string {
	if minute == nil {
		return "none"
	}
	return "minute " + strconv.Itoa(*minute)
}

func rungList(rungs []int) string {
	if len(rungs) == 0 {
		return "none"
	}
	words := make([]string, len(rungs))
	for index, rung := range rungs {
		words[index] = strconv.Itoa(rung)
	}
	return strings.Join(words, ", ")
}

func flagTable(ctx context.Context, tx *sql.Tx) (readerTable, error) {
	flags, err := loadFlags(ctx, tx)
	table := readerTable{columns: []string{"flag_code", "flag_label", "risk_class_code", "max_adverse_rate_bp"}}
	for _, flag := range flags {
		table.rows = append(table.rows, []string{flag.Code, flag.Label, flag.RiskClass, basisPointsText(flag.MaxAdverseRateBP)})
	}
	return table, err
}

func cohortTable(ctx context.Context, tx *sql.Tx) (readerTable, error) {
	cohorts, err := cohortsByCode(ctx, tx)
	table := readerTable{columns: []string{"cohort_code", "rung_index_count", "cohort_label", "device_count", "min_soak_minutes"}}
	for _, cohort := range cohorts {
		table.rows = append(table.rows, []string{cohort.Code, strconv.Itoa(cohort.RungIndex), cohort.Label,
			strconv.Itoa(cohort.DeviceCount) + " devices", minutesText(cohort.MinSoakMinutes)})
	}
	return table, err
}

func deviceTable(ctx context.Context, tx *sql.Tx) (readerTable, error) {
	devices, err := loadDevices(ctx, tx)
	table := readerTable{columns: []string{"device_code", "cohort_code", "serial_reference", "firmware_version_label"}}
	for _, device := range devices {
		table.rows = append(table.rows, []string{device.Code, device.CohortCode, device.SerialReference, device.FirmwareVersion})
	}
	return table, err
}

func promotionTable(ctx context.Context, tx *sql.Tx) (readerTable, error) {
	promotions, err := loadPromotions(ctx, tx)
	table := readerTable{columns: []string{"promotion_code", "flag_code", "cohort_code", "promoted_at_minutes", "demoted_at_minutes", "attestation_reference"}}
	for _, promotion := range promotions {
		reference := "none"
		if promotion.AttestationReference != nil {
			reference = *promotion.AttestationReference
		}
		table.rows = append(table.rows, []string{promotion.Code, promotion.FlagCode, promotion.CohortCode,
			instantText(&promotion.PromotedAt), instantText(promotion.DemotedAt), reference})
	}
	return table, err
}

func adverseEventTable(ctx context.Context, tx *sql.Tx) (readerTable, error) {
	events, err := loadAdverseEvents(ctx, tx)
	table := readerTable{columns: []string{"event_code", "device_code", "flag_code", "occurred_at_minutes", "severity_band_code"}}
	for _, event := range events {
		occurred := event.OccurredAt
		table.rows = append(table.rows, []string{event.Code, event.DeviceCode, event.FlagCode, instantText(&occurred), event.SeverityBand})
	}
	return table, err
}

func evidencePackTable(ctx context.Context, tx *sql.Tx) (readerTable, error) {
	ladders, err := allLadders(ctx, tx)
	table := readerTable{columns: []string{"pack_code", "flag_code", "highest_rung_index_count", "gap_rung_index_counts",
		"soak_satisfied_rung_index_counts", "rate_satisfied_rung_index_counts"}}
	for _, pack := range evidencePacks(ladders) {
		table.rows = append(table.rows, []string{pack.PackCode, pack.FlagCode, strconv.Itoa(pack.HighestActiveRung),
			rungList(pack.GapRungs), rungList(pack.SoakSatisfiedRungs), rungList(pack.RateSatisfiedRungs)})
	}
	return table, err
}

// consoleData is the live state the console starts from; the script renders it.
type consoleData struct {
	Cohorts    []Cohort       `json:"cohorts"`
	Flags      []FlagDetail   `json:"flags"`
	Packs      []EvidencePack `json:"packs"`
	Promotions []Promotion    `json:"promotions"`
}

type consolePage struct {
	Title    string
	Current  string
	Flags    []FlagDetail
	Cohorts  []Cohort
	Devices  []Device
	Now      int
	Data     consoleData
	Entities []readerEntity
}

func (a *App) pageRoutes(mux *http.ServeMux) {
	static, _ := fs.Sub(staticFiles, "static")
	mux.Handle("GET /static/", http.StripPrefix("/static/", http.FileServerFS(static)))
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		a.renderPage(w, "home.html", map[string]any{"Entities": readerEntities, "Title": "", "Current": ""})
	})
	for _, entity := range readerEntities {
		mux.HandleFunc("GET /"+entity.Name+"/{$}", a.readerPage(entity))
		mux.HandleFunc("GET /"+entity.Name, a.readerPage(entity))
	}
	mux.HandleFunc("GET /console", a.console)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		a.renderPage(w, "missing.html", map[string]any{"Entities": readerEntities, "Title": "Page not found", "Current": "", "Unavailable": false})
	})
}

func (a *App) renderPage(w http.ResponseWriter, name string, page any) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	pageTemplates.ExecuteTemplate(w, name, page)
}

func (a *App) unavailablePage(w http.ResponseWriter) {
	w.WriteHeader(http.StatusServiceUnavailable)
	a.renderPage(w, "missing.html", map[string]any{"Entities": readerEntities, "Title": "Unavailable", "Current": "", "Unavailable": true})
}

func (a *App) readerPage(entity readerEntity) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var table readerTable
		err := a.readIfReady(r.Context(), func(tx *sql.Tx) error {
			var err error
			table, err = entity.table(r.Context(), tx)
			return err
		})
		if err != nil {
			a.unavailablePage(w)
			return
		}
		a.renderPage(w, "reader.html", map[string]any{
			"Entities": readerEntities, "Current": entity.Name, "Title": entity.Title,
			"Columns": table.columns, "Rows": table.rows, "Total": len(table.rows),
		})
	}
}

func (a *App) console(w http.ResponseWriter, r *http.Request) {
	page := consolePage{Title: "Rollout console", Current: "console", Entities: readerEntities}
	err := a.readIfReady(r.Context(), func(tx *sql.Tx) error {
		flags, err := loadFlags(r.Context(), tx)
		if err != nil {
			return err
		}
		page.Now = currentMinute()
		ladders, err := loadLadders(r.Context(), tx, consoleOrder(flags), page.Now)
		if err != nil {
			return err
		}
		for _, ladder := range ladders {
			page.Flags = append(page.Flags, ladder.detail())
		}
		page.Data.Packs = evidencePacks(ladders)
		if page.Cohorts, err = loadCohorts(r.Context(), tx); err != nil {
			return err
		}
		if page.Devices, err = loadDevices(r.Context(), tx); err != nil {
			return err
		}
		page.Data.Promotions, err = nonNull(loadPromotions(r.Context(), tx))
		return err
	})
	if err != nil {
		a.unavailablePage(w)
		return
	}
	page.Data.Cohorts, page.Data.Flags = page.Cohorts, page.Flags
	a.renderPage(w, "console.html", page)
}

func (a *App) readIfReady(ctx context.Context, view func(tx *sql.Tx) error) error {
	if !a.ready.Load() {
		return errStoreNotReady
	}
	return a.read(ctx, view)
}
