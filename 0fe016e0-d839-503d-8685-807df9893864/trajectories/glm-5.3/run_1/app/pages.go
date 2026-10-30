package main

import (
	"html"
	"net/http"
	"strconv"
	"strings"
)

// pageShell wraps every page in the shared head and header.
func pageShell(title, body string) string {
	var b strings.Builder
	b.WriteString("<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n")
	b.WriteString("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n")
	b.WriteString("<title>" + html.EscapeString(title) + "</title>\n")
	b.WriteString("<link rel=\"stylesheet\" href=\"/static/styles.css\">\n")
	b.WriteString("</head>\n<body>\n<header class=\"site-header\">\n")
	b.WriteString("<p class=\"product-name\">Rungmark Rollout Ladder</p>\n")
	b.WriteString("<nav aria-label=\"Site\">\n")
	b.WriteString("<a href=\"/\">Home</a>\n")
	b.WriteString("<a href=\"/capability_flag\">Capability flags</a>\n")
	b.WriteString("<a href=\"/cohort\">Cohorts</a>\n")
	b.WriteString("<a href=\"/device\">Devices</a>\n")
	b.WriteString("<a href=\"/promotion\">Promotions</a>\n")
	b.WriteString("<a href=\"/adverse_event\">Adverse events</a>\n")
	b.WriteString("<a href=\"/evidence_pack\">Evidence packs</a>\n")
	b.WriteString("<a href=\"/console\">Rollout console</a>\n")
	b.WriteString("</nav>\n</header>\n<main>\n")
	b.WriteString(body)
	b.WriteString("</main>\n</body>\n</html>\n")
	return b.String()
}

func writePage(w http.ResponseWriter, body string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(200)
	_, _ = w.Write([]byte(body))
}

// readerTable renders one reader page: a heading, the record count line and
// a table of that entity's records, built from live state on every request.
func readerTable(heading string, total int, columns []string, rows [][]string) string {
	var b strings.Builder
	b.WriteString("<h1>" + html.EscapeString(heading) + "</h1>\n")
	b.WriteString("<p>" + strconv.Itoa(total) + " records</p>\n")
	b.WriteString("<div class=\"table-frame\"><table>\n<thead>\n<tr>")
	for _, c := range columns {
		b.WriteString("<th scope=\"col\">" + html.EscapeString(c) + "</th>")
	}
	b.WriteString("</tr>\n</thead>\n<tbody>\n")
	for _, row := range rows {
		b.WriteString("<tr>")
		for _, cell := range row {
			b.WriteString("<td>" + html.EscapeString(cell) + "</td>")
		}
		b.WriteString("</tr>\n")
	}
	b.WriteString("</tbody>\n</table>\n</div>\n")
	return b.String()
}

func (a *app) handleHome(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		writeError(w, 404, "not found")
		return
	}
	var b strings.Builder
	b.WriteString("<h1>Rungmark Rollout Ladder</h1>\n")
	b.WriteString("<p>Firmware capability flags move through five cohorts, one rung at a time.</p>\n")
	b.WriteString("<ul>\n")
	pages := [][2]string{
		{"capability_flag", "Capability flags"},
		{"cohort", "Cohorts"},
		{"device", "Devices"},
		{"promotion", "Promotions"},
		{"adverse_event", "Adverse events"},
		{"evidence_pack", "Evidence packs"},
	}
	for _, p := range pages {
		b.WriteString("<li><a href=\"/" + p[0] + "\">" + p[1] + "</a></li>\n")
	}
	b.WriteString("<li><a href=\"/console\">Rollout console</a></li>\n")
	b.WriteString("</ul>\n")
	writePage(w, pageShell("Rungmark Rollout Ladder", b.String()))
}

func (a *app) readerFlagPage(w http.ResponseWriter, r *http.Request) {
	flags, err := loadFlags(a.db)
	if err != nil {
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	rows := make([][]string, 0, len(flags))
	for _, f := range flags {
		rows = append(rows, []string{f.flagCode, f.flagLabel, f.riskClassCode, strconv.Itoa(f.maxAdverseRateBp)})
	}
	writePage(w, pageShell("Capability flags", readerTable("Capability flags", len(rows),
		[]string{"flag_code", "flag_label", "risk_class_code", "max_adverse_rate_bp"}, rows)))
}

func (a *app) readerCohortPage(w http.ResponseWriter, r *http.Request) {
	cohorts, err := loadCohorts(a.db)
	if err != nil {
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	rows := make([][]string, 0, len(cohorts))
	for _, c := range cohorts {
		rows = append(rows, []string{c.cohortCode, strconv.Itoa(c.rungIndexCount), c.cohortLabel,
			strconv.Itoa(c.deviceCount), strconv.Itoa(c.minSoakMinutes)})
	}
	writePage(w, pageShell("Cohorts", readerTable("Cohorts", len(rows),
		[]string{"cohort_code", "rung_index_count", "cohort_label", "device_count", "min_soak_minutes"}, rows)))
}

func (a *app) readerDevicePage(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.Query(`SELECT device_code, cohort_code, serial_reference, firmware_version_label FROM device ORDER BY device_code`)
	if err != nil {
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	defer rows.Close()
	records := [][]string{}
	for rows.Next() {
		var code, cohort, serial, fw string
		if err := rows.Scan(&code, &cohort, &serial, &fw); err != nil {
			a.writeDomainErr(w, a.classifyErr(err))
			return
		}
		records = append(records, []string{code, cohort, serial, fw})
	}
	if err := rows.Err(); err != nil {
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	writePage(w, pageShell("Devices", readerTable("Devices", len(records),
		[]string{"device_code", "cohort_code", "serial_reference", "firmware_version_label"}, records)))
}

func (a *app) readerPromotionPage(w http.ResponseWriter, r *http.Request) {
	promotions, err := loadPromotions(a.db, `SELECT sequence_number, promotion_code, flag_code, cohort_code, promoted_at_minutes, demoted_at_minutes, attestation_reference FROM promotion ORDER BY sequence_number`)
	if err != nil {
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	rows := make([][]string, 0, len(promotions))
	for _, p := range promotions {
		demoted := "none"
		if p.demotedAtMinutes != nil {
			demoted = strconv.FormatInt(*p.demotedAtMinutes, 10)
		}
		reference := "none"
		if p.attestationReference != nil {
			reference = *p.attestationReference
		}
		rows = append(rows, []string{p.promotionCode, p.flagCode, p.cohortCode,
			strconv.FormatInt(p.promotedAtMinutes, 10), demoted, reference})
	}
	writePage(w, pageShell("Promotions", readerTable("Promotions", len(rows),
		[]string{"promotion_code", "flag_code", "cohort_code", "promoted_at_minutes", "demoted_at_minutes", "attestation_reference"}, rows)))
}

func (a *app) readerAdverseEventPage(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.Query(`SELECT event_code, device_code, flag_code, occurred_at_minutes, severity_band_code FROM adverse_event ORDER BY event_code`)
	if err != nil {
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	defer rows.Close()
	records := [][]string{}
	for rows.Next() {
		var code, device, flag, band string
		var occurred int64
		if err := rows.Scan(&code, &device, &flag, &occurred, &band); err != nil {
			a.writeDomainErr(w, a.classifyErr(err))
			return
		}
		records = append(records, []string{code, device, flag, strconv.FormatInt(occurred, 10), band})
	}
	if err := rows.Err(); err != nil {
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	writePage(w, pageShell("Adverse events", readerTable("Adverse events", len(records),
		[]string{"event_code", "device_code", "flag_code", "occurred_at_minutes", "severity_band_code"}, records)))
}

func (a *app) readerEvidencePackPage(w http.ResponseWriter, r *http.Request) {
	packs, err := a.evidencePackRecords()
	if err != nil {
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	rows := make([][]string, 0, len(packs))
	for _, p := range packs {
		rows = append(rows, []string{p.PackCode, p.FlagCode, strconv.Itoa(p.HighestRungIndexCount),
			rungList(p.GapRungIndexCounts), rungList(p.SoakSatisfiedRungIndexCounts),
			rungList(p.RateSatisfiedRungIndexCounts)})
	}
	writePage(w, pageShell("Evidence packs", readerTable("Evidence packs", len(rows),
		[]string{"pack_code", "flag_code", "highest_rung_index_count", "gap_rung_index_counts",
			"soak_satisfied_rung_index_counts", "rate_satisfied_rung_index_counts"}, rows)))
}

// rungList renders a list cell: its rung numbers ascending, separated by a
// comma and a space, or "none" when the list is empty.
func rungList(v []int) string {
	if len(v) == 0 {
		return "none"
	}
	parts := make([]string, 0, len(v))
	for _, n := range v {
		parts = append(parts, strconv.Itoa(n))
	}
	return strings.Join(parts, ", ")
}

// handleConsole serves the rollout console shell. The console's figures come
// from the API routes it reloads, never from this shell.
func (a *app) handleConsole(w http.ResponseWriter, r *http.Request) {
	flags, err := loadFlags(a.db)
	if err != nil {
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	cohorts, err := loadCohorts(a.db)
	if err != nil {
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	devices, err := a.db.Query(`SELECT device_code FROM device ORDER BY device_code`)
	if err != nil {
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	defer devices.Close()
	deviceList := []string{}
	for devices.Next() {
		var code string
		if err := devices.Scan(&code); err != nil {
			a.writeDomainErr(w, a.classifyErr(err))
			return
		}
		deviceList = append(deviceList, code)
	}
	if err := devices.Err(); err != nil {
		a.writeDomainErr(w, a.classifyErr(err))
		return
	}
	// Seed order: FLG-ADAPTIVE, FLG-TELEM, FLG-ALERT.
	seedOrder := []string{"FLG-ADAPTIVE", "FLG-TELEM", "FLG-ALERT"}
	ordered := make([]flagRow, 0, len(flags))
	for _, code := range seedOrder {
		for _, f := range flags {
			if f.flagCode == code {
				ordered = append(ordered, f)
			}
		}
	}
	var b strings.Builder
	b.WriteString("<h1>Rollout console</h1>\n")
	b.WriteString("<div id=\"console-root\" data-flag-codes=\"" + strings.Join(flagCodesOf(ordered), ",") +
		"\" data-cohort-codes=\"" + strings.Join(cohortCodesOf(cohorts), ",") +
		"\" data-device-codes=\"" + strings.Join(deviceList, ",") + "\"></div>\n")
	b.WriteString("<noscript><p>The console needs JavaScript. Reader pages work without it.</p></noscript>\n")
	b.WriteString("<script src=\"/static/console.js\" defer></script>\n")
	writePage(w, pageShell("Rollout console", b.String()))
}

func flagCodesOf(flags []flagRow) []string {
	out := make([]string, 0, len(flags))
	for _, f := range flags {
		out = append(out, f.flagCode)
	}
	return out
}

func cohortCodesOf(cohorts []cohortRow) []string {
	out := make([]string, 0, len(cohorts))
	for _, c := range cohorts {
		out = append(out, c.cohortCode)
	}
	return out
}
