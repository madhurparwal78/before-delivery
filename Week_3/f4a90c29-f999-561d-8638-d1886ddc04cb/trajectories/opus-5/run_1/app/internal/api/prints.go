package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"html"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"sundialwren/internal/domain"
	"sundialwren/internal/objstore"
	"sundialwren/internal/printer"
	"sundialwren/internal/store"
)

// Print states.
const (
	printPending  = "pending"
	printRendered = "rendered"
	printStored   = "stored"
	printFailed   = "failed"
)

const (
	waitingDocumentService = "document_service"
	waitingFileStorage     = "file_storage"
)

// The published copy for each state of a printed week.
func printCopy(p store.Print) string {
	switch p.Status {
	case printPending:
		if p.WaitingOn != nil && *p.WaitingOn == waitingDocumentService {
			return "The document service is not answering. This print stays pending; choose Retry."
		}
		return "Preparing the printed week."
	case printRendered:
		if p.WaitingOn != nil && *p.WaitingOn == waitingFileStorage {
			return "File storage is not answering. This print stays pending; choose Retry."
		}
		return "Storing the printed week."
	case printFailed:
		return "This print failed. Choose Retry."
	}
	return "The printed week is ready."
}

var printAttempts sync.Map

func (s *Server) handleCreatePrint(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	if c.Person.Role != domain.RoleOfficeManager {
		forbidden(w, "forbidden")
		return
	}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if key == "" {
		unprocessable(w, map[string]string{"Idempotency-Key": "Send an Idempotency-Key header."})
		return
	}
	var raw json.RawMessage
	if readJSON(w, r, &raw) != nil {
		return
	}
	var body struct {
		WeekStart string   `json:"week_start"`
		Calendars []string `json:"calendars"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		unprocessable(w, map[string]string{"week_start": dateFormat})
		return
	}
	sum := sha256.Sum256(raw)
	bodyHash := hex.EncodeToString(sum[:])
	if existing, err := s.Store.PrintByIdempotency(r.Context(), c.Person.ID, key); err == nil {
		if existing.BodyHash != bodyHash {
			writeError(w, http.StatusConflict, "idempotency_conflict", "That key was used with a different request.", nil)
			return
		}
		writeJSON(w, http.StatusAccepted, printBody(existing))
		return
	}
	week, err := domain.ParseDate(body.WeekStart)
	if err != nil {
		unprocessable(w, map[string]string{"week_start": dateFormat})
		return
	}
	if week.Weekday() != time.Monday {
		unprocessable(w, map[string]string{"week_start": "Choose a Monday."})
		return
	}
	calendars := body.Calendars
	if len(calendars) == 0 {
		for id := range c.Viewer.Levels {
			calendars = append(calendars, id)
		}
		sort.Strings(calendars)
	}
	p := store.Print{
		ID: newID("prt"), PersonID: c.Person.ID, WeekStart: body.WeekStart,
		Calendars: calendars, Status: printPending, BodyHash: bodyHash,
	}
	p.ObjectKey = "prints/" + p.ID + ".pdf"
	if err := s.Store.InsertPrint(r.Context(), p, key, s.Clock.Now()); err != nil {
		s.fail(w, err)
		return
	}
	fresh, err := s.Store.Print(r.Context(), p.ID)
	if err != nil {
		s.fail(w, err)
		return
	}
	go s.attemptPrint(context.Background(), fresh.ID)
	writeJSON(w, http.StatusAccepted, printBody(fresh))
}

func printBody(p store.Print) map[string]any {
	return map[string]any{
		"id": p.ID, "week_start": p.WeekStart, "calendars": p.Calendars, "status": p.Status,
		"waiting_on": p.WaitingOn, "object_key": p.ObjectKey, "size_bytes": p.SizeBytes,
		"created_at": p.CreatedAt, "stored_at": p.StoredAt,
	}
}

func (s *Server) handlePrints(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	if c.Person.Role != domain.RoleOfficeManager {
		forbidden(w, "forbidden")
		return
	}
	prints, err := s.Store.Prints(r.Context(), c.Person.ID)
	if err != nil {
		s.fail(w, err)
		return
	}
	out := make([]map[string]any, 0, len(prints))
	for _, p := range prints {
		out = append(out, printBody(p))
	}
	writeJSON(w, http.StatusOK, map[string]any{"prints": out})
}

func (s *Server) handlePrint(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	p, err := s.Store.Print(r.Context(), pathValue(r, "id"))
	if err != nil {
		notFound(w)
		return
	}
	if p.PersonID != c.Person.ID {
		forbidden(w, "forbidden")
		return
	}
	writeJSON(w, http.StatusOK, printBody(p))
}

func (s *Server) handleRetryPrint(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	p, err := s.Store.Print(r.Context(), pathValue(r, "id"))
	if err != nil {
		notFound(w)
		return
	}
	if p.PersonID != c.Person.ID {
		forbidden(w, "forbidden")
		return
	}
	if p.Status == printStored {
		writeJSON(w, http.StatusOK, printBody(p))
		return
	}
	go s.attemptPrint(context.Background(), p.ID)
	writeJSON(w, http.StatusAccepted, printBody(p))
}

func (s *Server) handlePrintPDF(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	p, err := s.Store.Print(r.Context(), pathValue(r, "id"))
	if err != nil {
		notFound(w)
		return
	}
	if p.PersonID != c.Person.ID {
		forbidden(w, "forbidden")
		return
	}
	if p.Status != printStored {
		writeError(w, http.StatusConflict, "print_not_stored", "That printed week is not stored yet.", nil)
		return
	}
	data, err := s.Objects.Get(p.ObjectKey)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "file_storage_unavailable", fileStorageMessage, nil)
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", `attachment; filename="wren-week-`+p.WeekStart+`.pdf"`)
	_, _ = w.Write(data)
}

// attemptPrint makes one attempt: render, then store, then confirm. Concurrent
// retries share one attempt and the job is never given up.
func (s *Server) attemptPrint(ctx context.Context, id string) {
	if _, busy := printAttempts.LoadOrStore(id, true); busy {
		return
	}
	defer printAttempts.Delete(id)

	p, err := s.Store.Print(ctx, id)
	if err != nil || p.Status == printStored {
		return
	}
	page, err := s.printHTML(ctx, p)
	if err != nil {
		return
	}
	pdf, err := s.Printer.Render(page)
	if err != nil {
		var unreachable printer.Unreachable
		if errors.As(err, &unreachable) {
			s.setPrint(ctx, p, printPending, waitingDocumentService, nil, nil)
			return
		}
		s.setPrint(ctx, p, printFailed, "", nil, nil)
		return
	}
	s.setPrint(ctx, p, printRendered, "", nil, nil)
	if err := s.Objects.Put(p.ObjectKey, "application/pdf", pdf); err != nil {
		var unavailable objstore.Unavailable
		if errors.As(err, &unavailable) {
			s.setPrint(ctx, p, printRendered, waitingFileStorage, nil, nil)
			return
		}
		s.setPrint(ctx, p, printFailed, "", nil, nil)
		return
	}
	// A print reads as stored only once the object's size is read back.
	size, err := s.Objects.Size(p.ObjectKey)
	if err != nil {
		s.setPrint(ctx, p, printRendered, waitingFileStorage, nil, nil)
		return
	}
	now := s.Clock.Now()
	s.setPrint(ctx, p, printStored, "", &size, &now)
}

func (s *Server) setPrint(ctx context.Context, p store.Print, status, waitingOn string, size *int64, storedAt *time.Time) {
	var waiting *string
	if waitingOn != "" {
		waiting = &waitingOn
	}
	if err := s.Store.SetPrintState(ctx, p.ID, status, waiting, size, storedAt); err != nil {
		return
	}
	fresh, err := s.Store.Print(ctx, p.ID)
	if err != nil {
		return
	}
	s.publish(ctx, changePrint, changeSpec{PersonID: p.PersonID, Print: &fresh, Text: printCopy(fresh)})
}

// printHTML writes the page Gotenberg renders, in the requesting office
// manager's zone and at their access.
func (s *Server) printHTML(ctx context.Context, p store.Print) (string, error) {
	person, err := s.Store.Person(ctx, p.PersonID)
	if err != nil {
		return "", err
	}
	c, err := s.contextFor(ctx, person)
	if err != nil {
		return "", err
	}
	weekStart, err := domain.ParseDate(p.WeekStart)
	if err != nil {
		return "", err
	}
	from := domain.StartOfDay(weekStart, person.Zone)
	to := domain.StartOfDay(weekStart.AddDays(7), person.Zone)
	var calendars []string
	for _, id := range p.Calendars {
		if _, ok := c.Viewer.Levels[id]; ok {
			calendars = append(calendars, id)
		}
	}
	events, err := s.Store.LiveEvents(ctx, calendars, person.ID)
	if err != nil {
		return "", err
	}
	type line struct {
		order time.Time
		text  string
		warn  bool
	}
	byDate := map[string][]line{}
	for _, e := range events {
		if !c.Viewer.CanRead(e) {
			continue
		}
		access := c.Viewer.Access(e)
		for _, o := range c.Expander.ExpandRange(e, from, to) {
			title := o.Title
			if access == domain.AccessBusy {
				title = "Busy"
			}
			if e.AllDay {
				for _, date := range o.Dates() {
					day, err := domain.ParseDate(date)
					if err != nil || day.Before(weekStart) || !day.Before(weekStart.AddDays(7)) {
						continue
					}
					byDate[date] = append(byDate[date], line{
						order: domain.StartOfDay(day, person.Zone),
						text:  title + " — All day",
						warn:  o.Warning != nil && access == domain.AccessFull,
					})
				}
				continue
			}
			start, _ := o.Instants()
			date := domain.InZone(start, person.Zone).Date()
			clocks := domain.OccurrenceClocks(o, c.Settings)
			var times []string
			for _, clock := range clocks {
				times = append(times, clock.Time+" "+clock.City)
			}
			byDate[date] = append(byDate[date], line{
				order: start,
				text:  title + " — " + strings.Join(times, ", "),
				warn:  o.Warning != nil && access == domain.AccessFull,
			})
		}
	}
	var page strings.Builder
	page.WriteString(`<!doctype html><html lang="en"><head><meta charset="utf-8">`)
	page.WriteString(`<style>body{font-family:sans-serif;color:#16070f;margin:24px}` +
		`h1{font-size:20pt;font-weight:300}h2{font-size:13pt;margin-bottom:4px}` +
		`p{margin:2px 0;font-size:11pt}.warn{font-weight:600}</style></head><body>`)
	page.WriteString(`<h1>Sundial &amp; Wren</h1>`)
	page.WriteString(`<p>Week of ` + html.EscapeString(domain.ReadableDate(weekStart)) + `</p>`)
	for offset := 0; offset < 7; offset++ {
		day := weekStart.AddDays(offset)
		page.WriteString(`<h2>` + html.EscapeString(domain.ReadableDate(day)) + `</h2>`)
		lines := byDate[day.Date()]
		sort.SliceStable(lines, func(i, j int) bool { return lines[i].order.Before(lines[j].order) })
		if len(lines) == 0 {
			page.WriteString(`<p>Nothing scheduled in this period.</p>`)
			continue
		}
		for _, l := range lines {
			page.WriteString(`<p>` + html.EscapeString(l.text) + `</p>`)
			if l.warn {
				page.WriteString(`<p class="warn">Zone rule warning</p>`)
			}
		}
	}
	page.WriteString(`</body></html>`)
	return page.String(), nil
}

// RunPrintRecovery keeps trying every job that is not stored, so a service
// coming back finishes the work without a restart.
func (s *Server) RunPrintRecovery(ctx context.Context) {
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			people, err := s.Store.People(ctx)
			if err != nil {
				continue
			}
			for _, person := range people {
				if person.Role != domain.RoleOfficeManager {
					continue
				}
				prints, err := s.Store.Prints(ctx, person.ID)
				if err != nil {
					continue
				}
				for _, p := range prints {
					if p.Status == printStored || p.WaitingOn == nil {
						continue
					}
					go s.attemptPrint(ctx, p.ID)
				}
			}
		}
	}
}
