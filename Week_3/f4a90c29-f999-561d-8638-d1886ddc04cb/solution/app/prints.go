package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"html"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/lib/pq"
)

const storageDownCopy = "File storage is not answering. Nothing was changed. Try again shortly."

var errStorageDown = apiErr(503, "file_storage_unavailable", storageDownCopy)

func (s *Server) registerFileRoutes() {
	s.route("POST /api/prints", false, s.handleCreatePrint)
	s.route("GET /api/prints", false, s.handleListPrints)
	s.route("GET /api/prints/{id}", false, s.handleGetPrint)
	s.route("POST /api/prints/{id}/retry", false, s.handleRetryPrint)
	s.route("GET /api/prints/{id}/pdf", false, s.handlePrintPDF)
	s.route("POST /api/calendars/{id}/exports", false, s.handleExport)
	s.route("GET /api/exports/{id}/file", false, s.handleExportFile)
	s.route("POST /api/calendars/{id}/imports", false, s.handleImport)
}

// Print is one printed week.
type Print struct {
	ID, PersonID, Week, Status, ObjectKey string
	WaitingOn                             *string
	Calendars                             []string
	Size                                  *int64
	CreatedAt                             time.Time
	StoredAt                              *time.Time
}

const printColumns = `id, person_id, week_start, calendars, status, waiting_on, object_key, size_bytes, created_at, stored_at`

func scanPrint(row interface{ Scan(...any) error }) (*Print, error) {
	p := &Print{}
	var calendars pq.StringArray
	err := row.Scan(&p.ID, &p.PersonID, &p.Week, &calendars, &p.Status, &p.WaitingOn, &p.ObjectKey, &p.Size, &p.CreatedAt, &p.StoredAt)
	p.Calendars = []string(calendars)
	return p, err
}

func (p *Print) json() map[string]any {
	var waiting, size, stored any
	if p.WaitingOn != nil {
		waiting = *p.WaitingOn
	}
	if p.Size != nil {
		size = *p.Size
	}
	if p.StoredAt != nil {
		stored = p.StoredAt.UTC().Format(time.RFC3339)
	}
	return map[string]any{"id": p.ID, "week_start": p.Week, "calendars": p.Calendars, "status": p.Status, "waiting_on": waiting,
		"object_key": p.ObjectKey, "size_bytes": size, "created_at": p.CreatedAt.UTC().Format(time.RFC3339), "stored_at": stored}
}

var printEdges = map[string][]string{"pending": {"pending", "rendered", "failed"}, "rendered": {"rendered", "stored", "failed"}, "failed": {"failed", "pending"}}

// setPrint is the one place a print changes state; it only follows the legal edges.
func (s *Server) setPrint(ctx context.Context, id, to string, waiting *string, size *int64) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		var from string
		if err := tx.QueryRowContext(ctx, `SELECT status FROM prints WHERE id = $1`, id).Scan(&from); err != nil {
			return err
		}
		legal := false
		for _, next := range printEdges[from] {
			legal = legal || next == to
		}
		if !legal {
			return fmt.Errorf("print %s cannot go from %s to %s", id, from, to)
		}
		var stored *time.Time
		if to == "stored" {
			now := s.clock.Now()
			stored = &now
		}
		row := tx.QueryRowContext(ctx, `UPDATE prints SET status=$2, waiting_on=$3, size_bytes=COALESCE($4, size_bytes), stored_at=COALESCE($5, stored_at)
			WHERE id=$1 RETURNING `+printColumns, id, to, waiting, size, stored)
		p, err := scanPrint(row)
		if err != nil {
			return err
		}
		return logChange(ctx, tx, s.clock.Now(), ChangeRow{Type: "print.changed", PersonID: p.PersonID, Data: map[string]any{"print": p.json()}})
	})
}

func (s *Server) handleCreatePrint(rq *Req) error {
	if rq.Me.Role != "office_manager" {
		return errForbidden
	}
	key := rq.R.Header.Get("Idempotency-Key")
	if key == "" {
		return fieldErr("Idempotency-Key", "Send an Idempotency-Key header.")
	}
	var body struct {
		WeekStart string   `json:"week_start"`
		Calendars []string `json:"calendars"`
	}
	if err := rq.decode(&body); err != nil {
		return err
	}
	w, err := rq.World()
	if err != nil {
		return err
	}
	week, werr := parseDate(body.WeekStart)
	if werr != nil || week.Weekday() != time.Monday {
		return fieldErr("week_start", "Choose a Monday, written YYYY-MM-DD.")
	}
	calendars := body.Calendars
	if calendars == nil {
		for id, c := range w.Calendars {
			if w.canRead(c, rq.Me) {
				calendars = append(calendars, id)
			}
		}
		sort.Strings(calendars)
	}
	for _, id := range calendars {
		if c := w.Calendars[id]; c == nil || !w.canRead(c, rq.Me) {
			return fieldErr("calendars", "Choose calendars you can read.")
		}
	}
	sortedCalendars := append([]string(nil), calendars...)
	sort.Strings(sortedCalendars)
	sum := sha256.Sum256([]byte(body.WeekStart + "|" + strings.Join(sortedCalendars, ",") + "|" + fmt.Sprint(body.Calendars == nil)))
	hash := hex.EncodeToString(sum[:])
	var printed *Print
	var fresh bool
	err = s.tx(rq.ctx(), func(tx *sql.Tx) error {
		var existing, existingHash string
		err := tx.QueryRowContext(rq.ctx(), `SELECT id, body_hash FROM prints WHERE person_id=$1 AND idem_key=$2`, rq.Me.ID, key).Scan(&existing, &existingHash)
		if err == nil {
			if existingHash != hash {
				return apiErr(409, "idempotency_conflict", "That Idempotency-Key was already used for a different request.")
			}
			printed, err = scanPrint(tx.QueryRowContext(rq.ctx(), `SELECT `+printColumns+` FROM prints WHERE id=$1`, existing))
			return err
		}
		if err != sql.ErrNoRows {
			return err
		}
		id := newID("prt-")
		fresh = true
		printed, err = scanPrint(tx.QueryRowContext(rq.ctx(), `INSERT INTO prints (id, person_id, idem_key, body_hash, week_start, calendars, status, object_key, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8) RETURNING `+printColumns, id, rq.Me.ID, key, hash, body.WeekStart, pq.Array(sortedCalendars), "prints/"+id+".pdf", s.clock.Now()))
		if err != nil {
			return err
		}
		return logChange(rq.ctx(), tx, s.clock.Now(), ChangeRow{Type: "print.changed", PersonID: rq.Me.ID, Data: map[string]any{"print": printed.json()}})
	})
	if err != nil {
		return err
	}
	if fresh {
		go s.attemptPrint(printed.ID)
	}
	return rq.json(202, printed.json())
}

func (s *Server) ownPrint(rq *Req, id string) (*Print, error) {
	if rq.Me.Role != "office_manager" {
		return nil, errForbidden
	}
	p, err := scanPrint(s.db.QueryRowContext(rq.ctx(), `SELECT `+printColumns+` FROM prints WHERE id=$1 AND person_id=$2`, id, rq.Me.ID))
	if err == sql.ErrNoRows {
		return nil, errNotFound
	}
	return p, err
}

func (s *Server) handleListPrints(rq *Req) error {
	if rq.Me.Role != "office_manager" {
		return errForbidden
	}
	rows, err := s.db.QueryContext(rq.ctx(), `SELECT `+printColumns+` FROM prints WHERE person_id=$1 ORDER BY created_at DESC, id`, rq.Me.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	list := []map[string]any{}
	for rows.Next() {
		p, err := scanPrint(rows)
		if err != nil {
			return err
		}
		list = append(list, p.json())
	}
	return rq.json(200, map[string]any{"prints": list})
}

func (s *Server) handleGetPrint(rq *Req) error {
	p, err := s.ownPrint(rq, rq.R.PathValue("id"))
	if err != nil {
		return err
	}
	return rq.json(200, p.json())
}

func (s *Server) handleRetryPrint(rq *Req) error {
	p, err := s.ownPrint(rq, rq.R.PathValue("id"))
	if err != nil {
		return err
	}
	if p.Status == "stored" {
		return rq.json(200, p.json())
	}
	if p.Status == "failed" {
		if err := s.setPrint(rq.ctx(), p.ID, "pending", nil, nil); err != nil {
			return err
		}
	}
	go s.attemptPrint(p.ID)
	p, err = s.ownPrint(rq, p.ID)
	if err != nil {
		return err
	}
	return rq.json(202, p.json())
}

func (s *Server) handlePrintPDF(rq *Req) error {
	p, err := s.ownPrint(rq, rq.R.PathValue("id"))
	if err != nil {
		return err
	}
	if p.Status != "stored" {
		return apiErr(409, "print_not_stored", "The printed week is not stored yet.")
	}
	data, err := s.files.Get(rq.ctx(), p.ObjectKey)
	if err != nil {
		return storageFailure(err)
	}
	rq.W.Header().Set("Content-Type", "application/pdf")
	rq.W.Header().Set("Content-Disposition", `attachment; filename="wren-week-`+p.Week+`.pdf"`)
	rq.W.WriteHeader(http.StatusOK)
	_, err = rq.W.Write(data)
	return err
}

func storageFailure(err error) error {
	var se *serviceError
	if errors.As(err, &se) {
		return errStorageDown
	}
	return err
}

// attemptPrint makes one attempt to render and store a printed week; concurrent attempts share one.
func (s *Server) attemptPrint(id string) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	var claimed string
	err := s.db.QueryRowContext(ctx, `UPDATE prints SET attempt_until = $2 WHERE id = $1 AND status <> 'stored' AND (attempt_until IS NULL OR attempt_until < $3) RETURNING id`,
		id, time.Now().Add(90*time.Second), time.Now()).Scan(&claimed)
	if err != nil {
		return
	}
	defer s.db.ExecContext(context.Background(), `UPDATE prints SET attempt_until = NULL WHERE id = $1`, id)
	p, err := scanPrint(s.db.QueryRowContext(ctx, `SELECT `+printColumns+` FROM prints WHERE id=$1`, id))
	if err != nil {
		return
	}
	waiting := func(on string) *string { return &on }
	document, err := s.renderWeek(ctx, p)
	var se *serviceError
	if err != nil {
		if errors.As(err, &se) && se.Unreachable {
			s.setPrint(ctx, id, p.Status, waiting("document_service"), nil)
		} else {
			s.setPrint(ctx, id, "failed", nil, nil)
		}
		return
	}
	if p.Status == "pending" {
		if s.setPrint(ctx, id, "rendered", nil, nil) != nil {
			return
		}
	}
	if err := s.files.Put(ctx, p.ObjectKey, "application/pdf", document); err != nil {
		if errors.As(err, &se) && se.Unreachable {
			s.setPrint(ctx, id, "rendered", waiting("file_storage"), nil)
		} else {
			s.setPrint(ctx, id, "failed", nil, nil)
		}
		return
	}
	size := int64(len(document))
	s.setPrint(ctx, id, "stored", nil, &size)
}

// renderWeek builds the week page for the requesting office manager and renders it through the document service.
func (s *Server) renderWeek(ctx context.Context, p *Print) ([]byte, error) {
	w, err := loadWorld(ctx, s.db, s.clock.Now())
	if err != nil {
		return nil, err
	}
	me := w.People[p.PersonID]
	loc := zoneLocations[me.Zone]
	week, _ := parseDate(p.Week)
	begin, _, _ := resolveLocal(loc, week, nil)
	finish, _, _ := resolveLocal(loc, week.AddDate(0, 0, 7), nil)
	win := Window{From: begin, To: finish, Dates: true, FromDate: week, ToDate: week.AddDate(0, 0, 7)}
	events, err := loadEvents(ctx, s.db, `NOT trashed AND calendar_id = ANY($1)`, pq.Array(p.Calendars))
	if err != nil {
		return nil, err
	}
	var kept []*Event
	for _, e := range events {
		if w.access(e, me) != "" {
			kept = append(kept, e)
		}
	}
	if err := attachDetails(ctx, s.db, kept, w.Now); err != nil {
		return nil, err
	}
	type entry struct {
		at   time.Time
		html string
	}
	byDay := map[string][]entry{}
	for _, e := range kept {
		access := w.access(e, me)
		for _, o := range w.occurrences(e, win) {
			fields := w.project(View{Viewer: me, E: e, O: o, Access: access, ForOccurrence: true, Key: o.ReplyKey()})
			clocks := fields["clocks"].([]map[string]any)
			line := "<span class=\"when\">All day</span>"
			dates := []string{}
			if o.AllDay {
				for d := dateOnly(o.ShownStart); !d.After(dateOnly(o.ShownEnd)); d = d.AddDate(0, 0, 1) {
					if !d.Before(week) && d.Before(week.AddDate(0, 0, 7)) {
						dates = append(dates, d.Format(layoutDate))
					}
				}
			} else {
				parts := make([]string, 0, 3)
				for _, c := range clocks {
					parts = append(parts, fmt.Sprintf("<span class=\"clock\">%s %s</span>", c["time"], c["city"]))
				}
				line = strings.Join(parts, " · ")
				if d := wallOf(o.Begin, loc); !d.Before(week) && d.Before(week.AddDate(0, 0, 7)) {
					dates = append(dates, d.Format(layoutDate))
				}
			}
			extra := ""
			if ws, _ := fields["zone_warnings"].([]map[string]any); len(ws) > 0 && access == "full" {
				extra = "<div class=\"warn\">Zone rule warning: " + html.EscapeString(fmt.Sprint(ws[0]["note"])) + "</div>"
			}
			for _, d := range dates {
				byDay[d] = append(byDay[d], entry{o.Begin, fmt.Sprintf("<li><strong>%s</strong><div>%s</div>%s</li>", html.EscapeString(fmt.Sprint(fields["title"])), line, extra)})
			}
		}
	}
	var page strings.Builder
	page.WriteString(`<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#1b1020}
h1{font-size:22px;margin:0}h2{font-size:15px;font-weight:normal;margin:4px 0 18px}h3{font-size:14px;margin:14px 0 4px}ul{margin:0;padding-left:18px}
li{margin:4px 0}.clock{white-space:nowrap}.warn{color:#8a1c3c}</style></head><body><h1>Sundial &amp; Wren</h1><h2>Week of `)
	page.WriteString(longDate(week))
	page.WriteString(`</h2>`)
	for n := 0; n < 7; n++ {
		d := week.AddDate(0, 0, n)
		entries := byDay[d.Format(layoutDate)]
		sort.Slice(entries, func(i, j int) bool { return entries[i].at.Before(entries[j].at) })
		page.WriteString("<h3>" + longDate(d) + "</h3><ul>")
		for _, en := range entries {
			page.WriteString(en.html)
		}
		if len(entries) == 0 {
			page.WriteString("<li>Nothing scheduled.</li>")
		}
		page.WriteString("</ul>")
	}
	page.WriteString("</body></html>")
	return renderPDF(ctx, s.cfg.GotenbergURL, page.String())
}
