package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	seedEndpointName   = "Carrier desk receiver"
	seedEndpointPath   = "/hooks/carrier-desk"
	seedEndpointSecret = "whsec_seed_carrier_desk_7f3a"
)

// webhookEventTypes are the events an endpoint can subscribe to.
var webhookEventTypes = []string{
	"incident.triggered", "incident.acknowledged", "incident.snoozed", "incident.unacknowledged",
	"incident.escalated", "incident.reassigned", "incident.merged", "incident.resolved",
}

// webhookView is an endpoint as listed: the secret is shown once, when the endpoint is made.
type webhookView struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Path       string   `json:"path"`
	EventTypes []string `json:"event_types"`
	ServiceIDs []string `json:"service_ids"`
}

type webhookCreated struct {
	webhookView
	Secret string `json:"secret"`
}

// webhookPayload is the body posted to a receiver. It carries the incident's own fields and nothing a responder wrote.
type webhookPayload struct {
	ID         string          `json:"id"`
	Type       string          `json:"type"`
	OccurredAt string          `json:"occurred_at"`
	Incident   webhookIncident `json:"incident"`
}

type webhookIncident struct {
	ID            string  `json:"id"`
	Number        int     `json:"number"`
	Title         string  `json:"title"`
	Service       string  `json:"service"`
	Status        string  `json:"status"`
	Urgency       string  `json:"urgency"`
	ResolveReason *string `json:"resolve_reason"`
	MergedInto    *int    `json:"merged_into"`
}

func (a *App) hListWebhooks(rq *Req) error {
	rows, err := a.db.Query(rq.Ctx(), `select id, name, path, event_types, service_ids from webhooks order by created_at, id`)
	if err != nil {
		return fmt.Errorf("list webhooks: %w", err)
	}
	defer rows.Close()
	items := []webhookView{}
	for rows.Next() {
		var hook webhookView
		if err := rows.Scan(&hook.ID, &hook.Name, &hook.Path, &hook.EventTypes, &hook.ServiceIDs); err != nil {
			return fmt.Errorf("scan webhook: %w", err)
		}
		items = append(items, hook)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("list webhooks: %w", err)
	}
	return rq.JSON(http.StatusOK, map[string]any{"items": items})
}

func (a *App) hCreateWebhook(rq *Req) error {
	var body webhookView
	if err := rq.Decode(&body); err != nil {
		return fmt.Errorf("read new webhook: %w", err)
	}
	problems, err := a.webhookProblems(rq, &body)
	if err != nil {
		return fmt.Errorf("check new webhook: %w", err)
	}
	if len(problems) > 0 {
		return errFields(problems)
	}
	created := webhookCreated{webhookView: body, Secret: "whsec_" + newToken(24)}
	created.ID = newID()
	err = a.Do(rq.Ctx(), func(w *Work) error {
		if err := insertWebhook(w, created); err != nil {
			return fmt.Errorf("store new webhook: %w", err)
		}
		w.Publish("access", map[string]any{"kind": "webhooks"})
		return nil
	})
	if err != nil {
		return fmt.Errorf("create webhook: %w", err)
	}
	return rq.JSON(http.StatusCreated, created)
}

// webhookProblems checks a new endpoint, tidies its lists, and reports every bad field at once.
func (a *App) webhookProblems(rq *Req, hook *webhookView) (map[string]string, error) {
	problems := map[string]string{}
	hook.Name = strings.TrimSpace(hook.Name)
	if hook.Name == "" {
		problems["name"] = "Name is required."
	}
	if !strings.HasPrefix(hook.Path, "/") {
		problems["path"] = "The path must start with /."
	}
	hook.EventTypes = unique(hook.EventTypes)
	switch {
	case len(hook.EventTypes) == 0:
		problems["event_types"] = "Choose at least one event type."
	case slices.ContainsFunc(hook.EventTypes, func(t string) bool { return !slices.Contains(webhookEventTypes, t) }):
		problems["event_types"] = "Choose listed event types."
	}
	hook.ServiceIDs = unique(hook.ServiceIDs)
	var known int
	err := a.db.QueryRow(rq.Ctx(), `select count(*) from services where id = any($1)`, hook.ServiceIDs).Scan(&known)
	if err != nil {
		return nil, fmt.Errorf("check service scope: %w", err)
	}
	if known != len(hook.ServiceIDs) {
		problems["service_ids"] = "Choose listed services."
	}
	return problems, nil
}

// unique drops repeats, keeping first occurrences in order, and never returns nil so the list encodes as [].
func unique(values []string) []string {
	kept := []string{}
	for _, value := range values {
		if !slices.Contains(kept, value) {
			kept = append(kept, value)
		}
	}
	return kept
}

// collectIDs reads a one-column result of ids and closes it.
func collectIDs(rows pgx.Rows) ([]string, error) {
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan id: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read ids: %w", err)
	}
	return ids, nil
}

func insertWebhook(w *Work, hook webhookCreated) error {
	_, err := w.Tx.Exec(w.Ctx, `insert into webhooks (id, name, path, secret, event_types, service_ids, created_at)
		values ($1, $2, $3, $4, $5, $6, $7)`, hook.ID, hook.Name, hook.Path, hook.Secret, hook.EventTypes, hook.ServiceIDs, w.Now)
	if err != nil {
		return fmt.Errorf("insert webhook: %w", err)
	}
	return nil
}

func (a *App) hDeleteWebhook(rq *Req) error {
	err := a.Do(rq.Ctx(), func(w *Work) error {
		if _, err := w.Tx.Exec(w.Ctx, `delete from webhooks where id = $1`, rq.Param("id")); err != nil {
			return fmt.Errorf("delete webhook: %w", err)
		}
		w.Publish("access", map[string]any{"kind": "webhooks"})
		return nil
	})
	if err != nil {
		return fmt.Errorf("delete webhook: %w", err)
	}
	return rq.NoContent()
}

// emitWebhook records one delivery for each endpoint subscribed to the event and to the incident's service, built from
// the incident as it stands in this work's transaction. Each delivery has its own event id and goes out at once.
func (w *Work) emitWebhook(eventType, incidentID string) error {
	incident := webhookIncident{ID: incidentID}
	var serviceID string
	err := w.Tx.QueryRow(w.Ctx, `select i.number, i.title, s.name, i.status, i.urgency, i.resolve_reason, i.merged_into, i.service_id
		from incidents i join services s on s.id = i.service_id where i.id = $1`, incidentID).
		Scan(&incident.Number, &incident.Title, &incident.Service, &incident.Status, &incident.Urgency,
			&incident.ResolveReason, &incident.MergedInto, &serviceID)
	if err != nil {
		return fmt.Errorf("read incident %s for its webhook: %w", incidentID, err)
	}
	rows, err := w.Tx.Query(w.Ctx, `select id from webhooks where $1 = any(event_types)
		and (cardinality(service_ids) = 0 or $2 = any(service_ids)) order by created_at, id`, eventType, serviceID)
	if err != nil {
		return fmt.Errorf("find endpoints for %s: %w", eventType, err)
	}
	endpoints, err := collectIDs(rows)
	if err != nil {
		return fmt.Errorf("find endpoints for %s: %w", eventType, err)
	}
	for _, endpointID := range endpoints {
		eventID := newID()
		body, err := encodePayload(webhookPayload{ID: eventID, Type: eventType, OccurredAt: formatInstant(w.Now), Incident: incident})
		if err != nil {
			return fmt.Errorf("build webhook body: %w", err)
		}
		_, err = w.Tx.Exec(w.Ctx, `insert into webhook_deliveries (id, webhook_id, event_id, type, body, status, next_attempt_at, created_at)
			values ($1, $2, $3, $4, $5, 'pending', $6, $6)`, newID(), endpointID, eventID, eventType, body, w.Now)
		if err != nil {
			return fmt.Errorf("record delivery of %s: %w", eventType, err)
		}
	}
	if len(endpoints) > 0 {
		w.After(func(context.Context) { wakeWebhooks() })
		w.Publish("access", map[string]any{"kind": "webhooks"})
	}
	return nil
}

func encodePayload(payload webhookPayload) (string, error) {
	var out bytes.Buffer
	encoder := json.NewEncoder(&out)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(payload); err != nil {
		return "", fmt.Errorf("encode webhook body: %w", err)
	}
	return strings.TrimSuffix(out.String(), "\n"), nil
}

func seedWebhooks(_ *App, w *Work) error {
	hook := webhookCreated{
		webhookView: webhookView{ID: newID(), Name: seedEndpointName, Path: seedEndpointPath,
			EventTypes: webhookEventTypes, ServiceIDs: []string{}},
		Secret: seedEndpointSecret,
	}
	if err := insertWebhook(w, hook); err != nil {
		return fmt.Errorf("insert seed webhook: %w", err)
	}
	return nil
}

// attemptView is one attempt at a delivery as listed.
type attemptView struct {
	Attempt    int    `json:"attempt"`
	At         string `json:"at"`
	StatusCode *int   `json:"status_code"`
	Body       string `json:"body"`
	Outcome    string `json:"outcome"`
}

// deliveryView is a delivery with every attempt made at it.
type deliveryView struct {
	ID            string        `json:"id"`
	EventID       string        `json:"event_id"`
	Type          string        `json:"type"`
	Status        string        `json:"status"`
	NextAttemptAt *string       `json:"next_attempt_at"`
	Attempts      []attemptView `json:"attempts"`
	seq           int64
}

// deliveryViews lists up to limit deliveries newest first that satisfy the condition, each with its attempts.
func (a *App) deliveryViews(rq *Req, condition string, limit int, args ...any) ([]deliveryView, error) {
	rows, err := a.db.Query(rq.Ctx(), `select id, event_id, type, status, next_attempt_at, seq from webhook_deliveries where `+
		condition+` order by seq desc limit $`+strconv.Itoa(len(args)+1), append(args, limit)...)
	if err != nil {
		return nil, fmt.Errorf("list deliveries: %w", err)
	}
	defer rows.Close()
	views := []deliveryView{}
	for rows.Next() {
		view := deliveryView{Attempts: []attemptView{}}
		var next *time.Time
		if err := rows.Scan(&view.ID, &view.EventID, &view.Type, &view.Status, &next, &view.seq); err != nil {
			return nil, fmt.Errorf("scan delivery: %w", err)
		}
		view.NextAttemptAt = optionalInstant(next)
		views = append(views, view)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list deliveries: %w", err)
	}
	if err := a.addAttempts(rq, views); err != nil {
		return views, fmt.Errorf("read delivery attempts: %w", err)
	}
	return views, nil
}

// addAttempts fills each delivery's attempts, oldest first.
func (a *App) addAttempts(rq *Req, views []deliveryView) error {
	position := map[string]int{}
	ids := make([]string, 0, len(views))
	for i, view := range views {
		position[view.ID] = i
		ids = append(ids, view.ID)
	}
	rows, err := a.db.Query(rq.Ctx(), `select delivery_id, attempt, at, status_code, body, outcome from webhook_attempts
		where delivery_id = any($1) order by delivery_id, attempt`, ids)
	if err != nil {
		return fmt.Errorf("list attempts: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var deliveryID string
		var attempt attemptView
		var at time.Time
		if err := rows.Scan(&deliveryID, &attempt.Attempt, &at, &attempt.StatusCode, &attempt.Body, &attempt.Outcome); err != nil {
			return fmt.Errorf("scan attempt: %w", err)
		}
		attempt.At = formatInstant(at)
		view := &views[position[deliveryID]]
		view.Attempts = append(view.Attempts, attempt)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("list attempts: %w", err)
	}
	return nil
}

func (a *App) hListDeliveries(rq *Req) error {
	limit := defaultPageSize
	if raw := rq.Query("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > maxPageSize {
			return errField("limit", "Limit must be between 1 and 100.")
		}
		limit = parsed
	}
	before := int64(math.MaxInt64)
	if raw := rq.Query("after"); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			return errField("after", "Use the cursor from the previous page.")
		}
		before = parsed
	}
	views, err := a.deliveryViews(rq, `webhook_id = $1 and seq < $2`, limit+1, rq.Param("id"), before)
	if err != nil {
		return fmt.Errorf("list deliveries: %w", err)
	}
	var next *string
	if len(views) > limit {
		views = views[:limit]
		cursor := strconv.FormatInt(views[limit-1].seq, 10)
		next = &cursor
	}
	return rq.JSON(http.StatusOK, map[string]any{"items": views, "next_cursor": next})
}

// hReplayDelivery starts a fresh series of attempts under the same event id.
func (a *App) hReplayDelivery(rq *Req) error {
	err := a.Do(rq.Ctx(), func(w *Work) error {
		var status string
		err := w.Tx.QueryRow(w.Ctx, `select status from webhook_deliveries where id = $1 for update`, rq.Param("id")).Scan(&status)
		if err != nil {
			return fmt.Errorf("read delivery: %w", err)
		}
		if status == statusPending || status == statusRetrying {
			return errConflict("delivery_in_progress")
		}
		_, err = w.Tx.Exec(w.Ctx, `update webhook_deliveries set status = 'pending', next_attempt_at = $2,
			series_started_at = null, series_attempts = 0 where id = $1`, rq.Param("id"), w.Now)
		if err != nil {
			return fmt.Errorf("restart delivery: %w", err)
		}
		w.After(func(context.Context) { wakeWebhooks() })
		w.Publish("access", map[string]any{"kind": "webhooks"})
		return nil
	})
	if err != nil {
		return fmt.Errorf("replay delivery: %w", err)
	}
	views, err := a.deliveryViews(rq, `id = $1`, 1, rq.Param("id"))
	if err != nil {
		return fmt.Errorf("read replayed delivery: %w", err)
	}
	return rq.JSON(http.StatusAccepted, views[0])
}

func init() {
	seeders = append(seeders, seeder{order: 60, name: "webhooks", fn: seedWebhooks})
	routeSetups = append(routeSetups, func(a *App) {
		a.route(route{Pattern: "GET /api/webhooks", Access: accAdmin, Handler: a.hListWebhooks})
		a.route(route{Pattern: "POST /api/webhooks", Access: accAdmin, Handler: a.hCreateWebhook})
		a.route(route{Pattern: "DELETE /api/webhooks/{id}", Access: accAdmin, Resource: "webhook", Handler: a.hDeleteWebhook})
		a.route(route{Pattern: "GET /api/webhooks/{id}/deliveries", Access: accAdmin, Resource: "webhook", Handler: a.hListDeliveries})
		a.route(route{Pattern: "POST /api/webhook-deliveries/{id}/replay", Access: accAdmin, Resource: "delivery", Handler: a.hReplayDelivery})
	})
}
