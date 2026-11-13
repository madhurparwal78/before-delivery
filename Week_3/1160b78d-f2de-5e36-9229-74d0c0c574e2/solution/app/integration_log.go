package main

import (
	"fmt"
	"net/http"
	"strconv"
	"time"
)

// The outcomes the event path itself writes; Applied, Dropped and Suppressed come from the incident engine.
const (
	outcomeRefused      = "Refused"
	outcomeDeadLettered = "Dead-lettered"
	outcomeReplayed     = "Replayed"
)

// eventLogRow is one row for an integration's event log. Empty strings are logged as null.
type eventLogRow struct {
	IntegrationID  string
	EventID        string
	Action         string
	DedupKey       string
	Outcome        string
	Reason         string
	IncidentNumber *int
}

// logEvent writes a row of the integration's event log at w.Now and tells open integration pages.
func (w *Work) logEvent(row eventLogRow) error {
	_, err := w.Tx.Exec(w.Ctx, `insert into integration_events (integration_id, event_id, at, action, dedup_key, outcome, reason, incident_number)
		values ($1, $2, $3, $4, $5, $6, $7, $8)`,
		row.IntegrationID, nullable(row.EventID), w.Now, nullable(row.Action), nullable(row.DedupKey), row.Outcome,
		nullable(row.Reason), row.IncidentNumber)
	if err != nil {
		return fmt.Errorf("log %s event: %w", row.Outcome, err)
	}
	w.Publish("integration", map[string]string{"integration_id": row.IntegrationID})
	return nil
}

func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// eventLogItem is one row of GET /api/integrations/{id}/events.
type eventLogItem struct {
	EventID        *string `json:"event_id"`
	At             string  `json:"at"`
	Action         *string `json:"action"`
	DedupKey       *string `json:"dedup_key"`
	Outcome        string  `json:"outcome"`
	Reason         *string `json:"reason"`
	IncidentNumber *int    `json:"incident_number"`
	id             int64
}

// hEventLog lists an integration's event log, newest first. A cursor is the id of the last row of the page before.
func (d *eventDesk) hEventLog(rq *Req) error {
	limit, after, refusal := pageRequest(rq)
	if refusal != nil {
		return refusal
	}
	rows, err := d.a.db.Query(rq.Ctx(), `select id, event_id, at, action, dedup_key, outcome, reason, incident_number
		from integration_events where integration_id = $1 and ($2 = 0 or id < $2) order by id desc limit $3`,
		rq.Param("id"), after, limit+1)
	if err != nil {
		return fmt.Errorf("list event log: %w", err)
	}
	defer rows.Close()
	items := []eventLogItem{}
	for rows.Next() {
		var item eventLogItem
		var at time.Time
		err := rows.Scan(&item.id, &item.EventID, &at, &item.Action, &item.DedupKey, &item.Outcome, &item.Reason, &item.IncidentNumber)
		if err != nil {
			return fmt.Errorf("scan event log row: %w", err)
		}
		item.At = formatInstant(at)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("list event log: %w", err)
	}
	var next *string
	if len(items) > limit {
		items = items[:limit]
		cursor := strconv.FormatInt(items[limit-1].id, 10)
		next = &cursor
	}
	return rq.JSON(http.StatusOK, map[string]any{"items": items, "next_cursor": next})
}

// pageRequest reads ?limit and ?after of a cursor-paged list whose cursor is a row id.
func pageRequest(rq *Req) (limit int, after int64, refusal *apiError) {
	limit = defaultPageSize
	fields := map[string]string{}
	if value := rq.Query("limit"); value != "" {
		n, err := strconv.Atoi(value)
		if err != nil || n < 1 || n > maxPageSize {
			fields["limit"] = "Limit must be between 1 and 100."
		}
		limit = n
	}
	if value := rq.Query("after"); value != "" {
		n, err := strconv.ParseInt(value, 10, 64)
		if err != nil || n < 1 {
			fields["after"] = "Cursor is not valid."
		}
		after = n
	}
	if len(fields) > 0 {
		return 0, 0, errFields(fields)
	}
	return limit, after, nil
}
