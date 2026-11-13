package main

import (
	"context"
	"fmt"
	"log"
	"mime/multipart"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// prints.go — the printed week: pending, rendered, stored, with one attempt
// each time and a fixed storage key.

type PrintJob struct {
	ID        string
	PersonID  string
	WeekStart string
	Calendars []string
	Status    string
	WaitingOn *string
	ObjectKey string
	SizeBytes *int64
	CreatedAt time.Time
	StoredAt  *time.Time
}

func (p *PrintJob) out() map[string]any {
	m := map[string]any{
		"id": p.ID, "week_start": p.WeekStart, "calendars": p.Calendars,
		"status": p.Status, "waiting_on": p.WaitingOn,
		"object_key": p.ObjectKey, "created_at": p.CreatedAt.UTC().Format(time.RFC3339),
	}
	if p.SizeBytes != nil {
		m["size_bytes"] = *p.SizeBytes
	} else {
		m["size_bytes"] = nil
	}
	if p.StoredAt != nil {
		m["stored_at"] = p.StoredAt.UTC().Format(time.RFC3339)
	} else {
		m["stored_at"] = nil
	}
	return m
}

type PrintQueue struct {
	app *App
	mu  chan struct{}
}

func NewPrintQueue(a *App) *PrintQueue {
	q := &PrintQueue{app: a, mu: make(chan struct{}, 1)}
	go q.sweep()
	return q
}

// sweep picks up pending and rendered jobs and retries without a cached
// failure.
func (q *PrintQueue) sweep() {
	for range time.Tick(2 * time.Second) {
		if !q.app.dbReady {
			continue
		}
		ctx := context.Background()
		rows, err := q.app.store.Pool().Query(ctx, `SELECT id FROM print_jobs
		  WHERE status IN ('pending','rendered') AND (last_attempt IS NULL OR last_attempt < $1)
		  ORDER BY created_at LIMIT 5`, time.Now().Add(-2*time.Second))
		if err != nil {
			continue
		}
		var ids []string
		for rows.Next() {
			var id string
			if rows.Scan(&id) == nil {
				ids = append(ids, id)
			}
		}
		rows.Close()
		for _, id := range ids {
			go q.app.attemptPrint(id)
		}
	}
}

// handlePrintCreate is POST /api/prints with its Idempotency-Key.
func (a *App) handlePrintCreate(ctx context.Context, resp *apiResponse, person *Person, body []byte, idemKey string) error {
	if person.Role != "office_manager" {
		return apiErr(403, "forbidden", "Only the office manager prints the week.")
	}
	if idemKey == "" {
		return apiErr(422, "invalid", "Send an Idempotency-Key.")
	}
	var req struct {
		WeekStart string   `json:"week_start"`
		Calendars []string `json:"calendars"`
	}
	if err := jsonUnmarshal(body, &req); err != nil {
		return apiErr(422, "invalid", "That is not valid JSON.")
	}
	fields := map[string]string{}
	weekStart, ok := ParseDate(req.WeekStart)
	if !ok {
		fields["week_start"] = "Use YYYY-MM-DD."
	} else if weekStart.Weekday() != time.Monday {
		fields["week_start"] = "Week starting must be a Monday."
	}
	if len(fields) > 0 {
		return apiFieldErr("Check the fields and try again.", fields)
	}
	// idempotent replay: same key and same body returns the original job
	bodyHash := hashBody(body)
	if _, savedBody, found, _ := a.store.IdempotentBody(ctx, person.ID, idemKey); found {
		if savedBody == bodyHash {
			status, saved, _, _ := a.store.IdempotentReplay(ctx, person.ID, idemKey)
			resp.w.Header().Set("Content-Type", "application/json")
			resp.w.WriteHeader(status)
			resp.w.Write(saved)
			return nil
		}
		return apiErr(409, "idempotency_conflict", "That key was used with a different request.")
	}
	id := newID("prt")
	objectKey := "prints/" + id + ".pdf"
	calendars := req.Calendars
	if calendars == nil {
		// every calendar the office manager can read
		cals, _ := a.store.AllCalendars(ctx)
		for _, c := range cals {
			if c.ReadOnly {
				continue
			}
			if _, err := a.store.ShareLevel(ctx, c.ID, person.ID); err == nil {
				calendars = append(calendars, c.ID)
			} else if c.OwnerID != nil && *c.OwnerID == person.ID {
				calendars = append(calendars, c.ID)
			}
		}
		if calendars == nil {
			calendars = []string{}
		}
	}
	err := a.store.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO print_jobs (id, person_id, week_start, calendars, status, object_key, created_at)
		  VALUES ($1,$2,$3,$4,'pending',$5,now())`, id, person.ID, req.WeekStart, calendars, objectKey); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return err
	}
	// store the idempotent response after the job exists
	job := a.loadPrint(ctx, id)
	saved, _ := jsonMarshal(job.out())
	_ = a.store.SaveIdempotent(ctx, person.ID, idemKey, bodyHash, 202, saved)
	go a.attemptPrint(id)
	writeJSON(resp.w, http.StatusAccepted, job.out())
	return nil
}

func (a *App) loadPrint(ctx context.Context, id string) *PrintJob {
	row := a.store.Pool().QueryRow(ctx, `SELECT id, person_id, week_start, calendars, status, waiting_on, object_key, size_bytes, created_at, stored_at
	  FROM print_jobs WHERE id=$1`, id)
	p := &PrintJob{}
	var size *int64
	var stored *time.Time
	if err := row.Scan(&p.ID, &p.PersonID, &p.WeekStart, &p.Calendars, &p.Status, &p.WaitingOn,
		&p.ObjectKey, &size, &p.CreatedAt, &stored); err != nil {
		return nil
	}
	p.SizeBytes = size
	p.StoredAt = stored
	return p
}

// attemptPrint makes exactly one attempt: document service, then storage.
func (a *App) attemptPrint(id string) {
	ctx := context.Background()
	p := a.loadPrint(ctx, id)
	if p == nil || p.Status == "stored" || p.Status == "failed" {
		return
	}
	if !a.dbReady {
		return
	}
	_, _ = a.store.Pool().Exec(ctx, `UPDATE print_jobs SET last_attempt=now() WHERE id=$1`, id)
	person, _ := a.store.PersonByID(ctx, p.PersonID)
	if person == nil {
		return
	}
	html, err := a.renderPrintHTML(ctx, p, person)
	if err != nil {
		log.Printf("print render: %v", err)
		waiting := "document_service"
		_, _ = a.store.Pool().Exec(ctx, `UPDATE print_jobs SET status='pending', waiting_on=$2 WHERE id=$1`, id, waiting)
		return
	}
	pdf, err := a.callGotenberg(ctx, html)
	if err != nil {
		// unreachable service: stay pending with waiting_on document_service
		waiting := "document_service"
		_, _ = a.store.Pool().Exec(ctx, `UPDATE print_jobs SET status='pending', waiting_on=$2 WHERE id=$1`, id, waiting)
		a.broadcastPrint(p)
		return
	}
	_, _ = a.store.Pool().Exec(ctx, `UPDATE print_jobs SET status='rendered', waiting_on=NULL WHERE id=$1`, id)
	size, err := a.minio.Put(ctx, p.ObjectKey, "application/pdf", pdf)
	if err != nil {
		waiting := "file_storage"
		_, _ = a.store.Pool().Exec(ctx, `UPDATE print_jobs SET status='rendered', waiting_on=$2 WHERE id=$1`, id, waiting)
		a.broadcastPrint(p)
		return
	}
	_, _ = a.store.Pool().Exec(ctx, `UPDATE print_jobs SET status='stored', waiting_on=NULL, size_bytes=$2, stored_at=now() WHERE id=$1`, id, size)
	a.broadcastPrint(p)
}

func (a *App) broadcastPrint(p *PrintJob) {
	if p == nil {
		return
	}
	ctx := context.Background()
	job := a.loadPrint(ctx, p.ID)
	if job == nil {
		return
	}
	people, _ := a.store.AllPeople(ctx)
	ids := []string{}
	for _, per := range people {
		if per.Role == "office_manager" {
			ids = append(ids, per.ID)
		}
	}
	_, _ = a.store.AppendChangePool(ctx, "print.changed", ids, map[string]any{"print": job.out()}, nil)
}

// callGotenberg posts an HTML page and expects a PDF back.
func (a *App) callGotenberg(ctx context.Context, html string) ([]byte, error) {
	var buf strings.Builder
	w := multipart.NewWriter(&buf)
	fw, _ := w.CreateFormFile("files", "index.html")
	fw.Write([]byte(html))
	w.WriteField("paperWidth", "8.27")
	w.WriteField("paperHeight", "11.69")
	w.WriteField("marginTop", "0.5")
	w.WriteField("marginBottom", "0.5")
	w.WriteField("marginLeft", "0.5")
	w.WriteField("marginRight", "0.5")
	w.Close()
	cctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, http.MethodPost, a.cfg.GotenbergURL+"/forms/chromium/convert/html", strings.NewReader(buf.String()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return nil, fmt.Errorf("document service answered %d", res.StatusCode)
	}
	return readAllBytes(res)
}

// renderPrintHTML gives the printable week with the published content.
func (a *App) renderPrintHTML(ctx context.Context, p *PrintJob, person *Person) (string, error) {
	weekStart, _ := ParseDate(p.WeekStart)
	rules, _ := a.store.ZoneRules(ctx)
	zone := person.Zone
	type printLine struct {
		date  string
		title string
		times string
	}
	var b strings.Builder
	b.WriteString("<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Sundial &amp; Wren</title></head><body>")
	b.WriteString("<h1>Sundial &amp; Wren</h1>")
	b.WriteString("<p>Week of " + longDateOf(p.WeekStart) + "</p>")
	calFilter := map[string]bool{}
	for _, c := range p.Calendars {
		calFilter[c] = true
	}
	from := midnightInZone(zone, p.WeekStart)
	to := midnightInZone(zone, FormatDate(weekStart.AddDate(0, 0, 7)))
	occs, err := a.store.OccurrencesForPerson(ctx, person, from, to, calFilter, rules)
	if err != nil {
		return "", err
	}
	// order by start
	sort.Slice(occs, func(i, j int) bool {
		si, _ := occStartInstant(occs[i].Occurrence, rules, nil)
		sj, _ := occStartInstant(occs[j].Occurrence, rules, nil)
		return si.Before(sj)
	})
	currentDay := ""
	for _, lo := range occs {
		o, e, access := lo.Occurrence, lo.event, lo.access
		// the date the start falls on in the viewer's zone, for timed
		var dayStr string
		if o.AllDay {
			dayStr = InZone(midnightUTC(mustDate(o.StartDate)), zone).Format("Mon 2 Jan 2006")
		} else {
			inst := occInstants(o).start
			dayStr = InZone(inst, zone).Format("Mon 2 Jan 2006")
		}
		if dayStr != currentDay {
			currentDay = dayStr
			b.WriteString("<h2>" + dayStr + "</h2>")
		}
		title := o.Title
		if access == "busy" {
			title = "Busy"
		}
		times := "All day"
		if !o.AllDay {
			times = threeClocksLine(occInstants(o).start)
		}
		b.WriteString("<p>" + escapeHTML(title) + " &mdash; " + times + "</p>")
		if o.HasWarning && access == "full" {
			b.WriteString("<p>Zone rule warning</p>")
		}
		_ = e
	}
	b.WriteString("</body></html>")
	return b.String(), nil
}

func threeClocksLine(t time.Time) string {
	parts := []string{}
	for _, c := range threeClocks(t) {
		parts = append(parts, c.Time+" "+c.City)
	}
	return strings.Join(parts, ", ")
}

func escapeHTML(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&quot;")
	return r.Replace(s)
}

// handlePrintsList is GET /api/prints.
func (a *App) handlePrintsList(ctx context.Context, resp *apiResponse, person *Person) error {
	if person.Role != "office_manager" {
		return apiErr(403, "forbidden", "Only the office manager prints the week.")
	}
	rows, err := a.store.Pool().Query(ctx, `SELECT id FROM print_jobs ORDER BY created_at DESC LIMIT 100`)
	if err != nil {
		return err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return err
		}
		ids = append(ids, id)
	}
	out := []map[string]any{}
	for _, id := range ids {
		if p := a.loadPrint(ctx, id); p != nil {
			out = append(out, p.out())
		}
	}
	return writeOkBody(resp, map[string]any{"prints": out})
}

func (a *App) handlePrintGet(ctx context.Context, resp *apiResponse, person *Person, id string) error {
	if person.Role != "office_manager" {
		return apiErr(403, "forbidden", "Only the office manager prints the week.")
	}
	p := a.loadPrint(ctx, id)
	if p == nil {
		return apiErr(404, "not_found", "That print is not available.")
	}
	return writeOkBody(resp, p.out())
}

// handlePrintRetry retries a pending, rendered or failed print, sharing one
// attempt with any other concurrent retry.
func (a *App) handlePrintRetry(ctx context.Context, resp *apiResponse, person *Person, id string) error {
	if person.Role != "office_manager" {
		return apiErr(403, "forbidden", "Only the office manager prints the week.")
	}
	p := a.loadPrint(ctx, id)
	if p == nil {
		return apiErr(404, "not_found", "That print is not available.")
	}
	if p.Status == "stored" {
		return writeOkBody(resp, p.out())
	}
	// clear a failed attempt and set it going again
	_, _ = a.store.Pool().Exec(ctx, `UPDATE print_jobs SET status='pending', waiting_on=NULL WHERE id=$1 AND status='failed'`, id)
	go a.attemptPrint(id)
	p = a.loadPrint(ctx, id)
	writeJSON(resp.w, http.StatusAccepted, p.out())
	return nil
}

func (a *App) handlePrintPDF(ctx context.Context, resp *apiResponse, person *Person, id string) error {
	if person.Role != "office_manager" {
		return apiErr(403, "forbidden", "Only the office manager prints the week.")
	}
	p := a.loadPrint(ctx, id)
	if p == nil {
		return apiErr(404, "not_found", "That print is not available.")
	}
	if p.Status != "stored" {
		return apiErr(409, "print_not_stored", "The printed week is not stored yet.")
	}
	data, err := a.minio.Get(ctx, p.ObjectKey)
	if err != nil {
		return apiErr(503, "file_storage_unavailable", "File storage is not answering. Nothing was changed. Try again shortly.")
	}
	resp.w.Header().Set("Content-Type", "application/pdf")
	resp.w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=wren-week-%s.pdf", p.WeekStart))
	resp.w.WriteHeader(http.StatusOK)
	resp.w.Write(data)
	return nil
}
