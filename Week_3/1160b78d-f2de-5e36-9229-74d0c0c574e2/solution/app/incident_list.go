package main

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	defaultPageSize = 25
	maxPageSize     = 100
	maxBulkIDs      = 100
)

// statusFilters maps each value of the `status` filter to the incident statuses it covers.
var statusFilters = map[string][]string{
	"open":         {"triggered", "acknowledged", "snoozed"},
	"triggered":    {"triggered"},
	"acknowledged": {"acknowledged"},
	"snoozed":      {"snoozed"},
	"resolved":     {"resolved"},
	"all":          {"triggered", "acknowledged", "snoozed", "resolved"},
}

const statusFilterSentence = "Status must be open, triggered, acknowledged, snoozed, resolved or all."

// bulkActions are the decisions the bulk endpoint applies, each through the incident engine's transition.
var bulkActions = map[string]struct {
	decision string
	apply    func(*App, *Work, string, actorRef) error
}{
	"acknowledge": {"acknowledged", (*App).acknowledgeIncident},
	"resolve":     {"resolved", (*App).resolveIncident},
}

// viewerZone is the zone times are rendered in for this request: the person's profile zone, the firm's for a key.
func (rq *Req) viewerZone() string {
	if rq.Actor.Zone == "" {
		return firmZone
	}
	return rq.Actor.Zone
}

// position is where an incident sits in the list order: newest opening instant first, then higher number first.
type position struct {
	OpenedAt time.Time
	Number   int
}

// cursor names the position; it is opaque to clients.
func (p position) cursor() string {
	return base64.RawURLEncoding.EncodeToString([]byte(strconv.FormatInt(p.OpenedAt.UnixMicro(), 10) + ":" + strconv.Itoa(p.Number)))
}

func parseCursor(text string) (position, bool) {
	raw, err := base64.RawURLEncoding.DecodeString(text)
	if err != nil {
		return position{}, false
	}
	micros, number, found := strings.Cut(string(raw), ":")
	if !found {
		return position{}, false
	}
	at, err := strconv.ParseInt(micros, 10, 64)
	if err != nil {
		return position{}, false
	}
	n, err := strconv.Atoi(number)
	if err != nil {
		return position{}, false
	}
	return position{OpenedAt: time.UnixMicro(at).UTC(), Number: n}, true
}

// listFilter is the part of the list query that pages share.
type listFilter struct {
	statuses  []string
	serviceID string
}

type listRow struct {
	ID  string
	Pos position
}

// next lists up to n incidents on one side of a position, nearest first. With no position it lists from the newest.
func (f listFilter) next(ctx context.Context, q dbq, from *position, newer bool, n int) ([]listRow, error) {
	args := []any{f.statuses, f.serviceID, n}
	compare, order := "", "desc"
	if from != nil {
		args = append(args, from.OpenedAt, from.Number)
		compare = " and (opened_at, number) < ($4, $5)"
		if newer {
			compare, order = " and (opened_at, number) > ($4, $5)", "asc"
		}
	}
	rows, err := q.Query(ctx, `select id, opened_at, number from incidents
		where status = any($1) and ($2 = '' or service_id = $2)`+compare+`
		order by opened_at `+order+`, number `+order+` limit $3`, args...)
	if err != nil {
		return nil, fmt.Errorf("list incidents: %w", err)
	}
	defer rows.Close()
	var out []listRow
	for rows.Next() {
		var r listRow
		if err := rows.Scan(&r.ID, &r.Pos.OpenedAt, &r.Pos.Number); err != nil {
			return nil, fmt.Errorf("scan incident row: %w", err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list incidents: %w", err)
	}
	return out, nil
}

// beyond reports whether the filter has an incident on the given side of a position.
func (f listFilter) beyond(ctx context.Context, q dbq, from position, newer bool) (bool, error) {
	rows, err := f.next(ctx, q, &from, newer, 1)
	if err != nil {
		return false, fmt.Errorf("read next incident: %w", err)
	}
	return len(rows) > 0, nil
}

func (f listFilter) total(ctx context.Context, q dbq) (int, error) {
	var count int
	err := q.QueryRow(ctx, `select count(*) from incidents where status = any($1) and ($2 = '' or service_id = $2)`,
		f.statuses, f.serviceID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count incidents: %w", err)
	}
	return count, nil
}

// listRequest is a validated GET /api/incidents.
type listRequest struct {
	filter listFilter
	limit  int
	after  *position
	before *position
}

func parseListRequest(rq *Req) (listRequest, *apiError) {
	problems := map[string]string{}
	req := listRequest{limit: defaultPageSize}
	status := rq.Query("status")
	if status == "" {
		status = "open"
	}
	req.filter.statuses = statusFilters[status]
	if req.filter.statuses == nil {
		problems["status"] = statusFilterSentence
	}
	req.filter.serviceID = rq.Query("service_id")
	if text := rq.Query("limit"); text != "" {
		limit, err := strconv.Atoi(text)
		if err != nil || limit < 1 || limit > maxPageSize {
			problems["limit"] = "Limit must be between 1 and 100."
		}
		req.limit = limit
	}
	var ok bool
	if text := rq.Query("after"); text != "" {
		if req.after, ok = cursorPosition(text); !ok {
			problems["after"] = "Cursor is not valid."
		}
	}
	if text := rq.Query("before"); text != "" {
		if req.before, ok = cursorPosition(text); !ok {
			problems["before"] = "Cursor is not valid."
		}
		if req.after != nil {
			problems["before"] = "Use either after or before."
		}
	}
	if len(problems) > 0 {
		return listRequest{}, errFields(problems)
	}
	return req, nil
}

func cursorPosition(text string) (*position, bool) {
	p, ok := parseCursor(text)
	return &p, ok
}

// incidentPage is the body of GET /api/incidents.
type incidentPage struct {
	Items      []any   `json:"items"`
	Total      int     `json:"total"`
	NextCursor *string `json:"next_cursor"`
	PrevCursor *string `json:"prev_cursor"`
}

// listPage reads one page, its total and both cursors from one snapshot, so they agree with each other.
func (a *App) listPage(ctx context.Context, req listRequest, zone string) (incidentPage, error) {
	page := incidentPage{Items: []any{}}
	err := pgx.BeginTxFunc(ctx, a.db, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		var err error
		if page.Total, err = req.filter.total(ctx, tx); err != nil {
			return fmt.Errorf("count incidents: %w", err)
		}
		boundary, newer := req.after, false
		if req.before != nil {
			boundary, newer = req.before, true
		}
		rows, err := req.filter.next(ctx, tx, boundary, newer, req.limit)
		if err != nil {
			return fmt.Errorf("read incident page: %w", err)
		}
		if newer {
			for i, j := 0, len(rows)-1; i < j; i, j = i+1, j-1 {
				rows[i], rows[j] = rows[j], rows[i]
			}
		}
		for _, r := range rows {
			item, err := a.incidentListItem(ctx, tx, r.ID, zone)
			if err != nil {
				return fmt.Errorf("render incident %s: %w", r.ID, err)
			}
			page.Items = append(page.Items, item)
		}
		first, last := boundary, boundary
		if len(rows) > 0 {
			first, last = &rows[0].Pos, &rows[len(rows)-1].Pos
		}
		if first == nil {
			return nil
		}
		if page.PrevCursor, err = cursorIf(ctx, tx, req.filter, *first, true); err != nil {
			return fmt.Errorf("find previous cursor: %w", err)
		}
		page.NextCursor, err = cursorIf(ctx, tx, req.filter, *last, false)
		if err != nil {
			return fmt.Errorf("find next cursor: %w", err)
		}
		return nil
	})
	if err != nil {
		return incidentPage{}, fmt.Errorf("read incident page: %w", err)
	}
	return page, nil
}

// cursorIf names a position when the filter has incidents beyond it on the given side.
func cursorIf(ctx context.Context, q dbq, f listFilter, from position, newer bool) (*string, error) {
	more, err := f.beyond(ctx, q, from, newer)
	if err != nil {
		return nil, fmt.Errorf("check for more incidents: %w", err)
	}
	if !more {
		return nil, nil
	}
	text := from.cursor()
	return &text, nil
}

func (a *App) hListIncidents(rq *Req) error {
	req, apiErr := parseListRequest(rq)
	if apiErr != nil {
		return apiErr
	}
	page, err := a.listPage(rq.Ctx(), req, rq.viewerZone())
	if err != nil {
		return fmt.Errorf("list incidents: %w", err)
	}
	return rq.JSON(http.StatusOK, page)
}

func (a *App) hGetIncident(rq *Req) error {
	view, version, err := a.incidentJSON(rq.Ctx(), a.db, rq.Param("id"), rq.viewerZone())
	if err != nil {
		return fmt.Errorf("read incident: %w", err)
	}
	return rq.Record(http.StatusOK, view, version)
}

// bulkResult is one row of the bulk answer.
type bulkResult struct {
	ID        string  `json:"id"`
	Number    *int    `json:"number"`
	Status    string  `json:"status"`
	Decision  *string `json:"decision"`
	DecidedBy *string `json:"decided_by"`
}

func (a *App) hBulk(rq *Req) error {
	var body struct {
		Action string   `json:"action"`
		IDs    []string `json:"ids"`
	}
	if err := rq.Decode(&body); err != nil {
		return fmt.Errorf("read bulk request: %w", err)
	}
	problems := map[string]string{}
	if len(body.IDs) < 1 || len(body.IDs) > maxBulkIDs {
		problems["ids"] = "Choose 1 to 100 incidents."
	}
	action, known := bulkActions[body.Action]
	if !known {
		problems["action"] = "Action must be acknowledge or resolve."
	}
	if len(problems) > 0 {
		return errFields(problems)
	}
	results := make([]bulkResult, 0, len(body.IDs))
	for _, id := range body.IDs {
		result, err := a.bulkDecide(rq, id, action.decision, action.apply)
		if err != nil {
			return fmt.Errorf("apply bulk action: %w", err)
		}
		results = append(results, result)
	}
	return rq.JSON(http.StatusOK, map[string]any{"results": results})
}

// bulkDecide applies one decision to one incident in its own unit of work, so a conflict on it blocks no other row.
func (a *App) bulkDecide(rq *Req, id, decision string, apply func(*App, *Work, string, actorRef) error) (bulkResult, error) {
	result := bulkResult{ID: id, Status: "conflict"}
	var number int
	err := a.db.QueryRow(rq.Ctx(), `select number from incidents where id = $1`, id).Scan(&number)
	if isNoRows(err) {
		return result, nil
	}
	if err != nil {
		return result, fmt.Errorf("read incident %s: %w", id, err)
	}
	result.Number = &number
	err = a.Do(rq.Ctx(), func(w *Work) error {
		if err := apply(a, w, id, rq.ref()); err != nil {
			return fmt.Errorf("apply bulk action: %w", err)
		}
		return nil
	})
	var refusal *apiError
	switch {
	case err == nil:
		by := rq.Actor.Name
		result.Status, result.Decision, result.DecidedBy = "ok", &decision, &by
	case errors.As(err, &refusal):
		result.Decision, result.DecidedBy = bodyText(refusal.Body, "decision"), bodyText(refusal.Body, "decided_by")
	default:
		return result, fmt.Errorf("decide incident %s: %w", id, err)
	}
	return result, nil
}

// bodyText reads a string field of an error body, nil when it carries none.
func bodyText(body map[string]any, field string) *string {
	text, ok := body[field].(string)
	if !ok {
		return nil
	}
	return &text
}

func init() {
	routeSetups = append(routeSetups, func(a *App) {
		a.route(route{Pattern: "GET /api/incidents", Access: accStaff, Handler: a.hListIncidents})
		a.route(route{Pattern: "GET /api/incidents/{id}", Access: accStaff, Resource: "incident", Handler: a.hGetIncident})
		a.route(route{Pattern: "POST /api/incidents/bulk", Access: accStaff, KeyWrite: true, Handler: a.hBulk})
	})
}
