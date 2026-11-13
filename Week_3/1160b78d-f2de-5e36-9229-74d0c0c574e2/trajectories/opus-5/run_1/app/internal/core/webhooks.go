package core

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

var webhookEventTypes = []string{
	"incident.triggered", "incident.acknowledged", "incident.snoozed", "incident.unacknowledged",
	"incident.escalated", "incident.reassigned", "incident.merged", "incident.resolved",
}

// WebhookEventTypes lists the types an endpoint can subscribe to.
func WebhookEventTypes() []string { return append([]string{}, webhookEventTypes...) }

// backoff is the published retry schedule, in waits after each failed attempt.
var backoff = []time.Duration{10 * time.Second, 30 * time.Second, 2 * time.Minute, 10 * time.Minute, time.Hour}

type WebhookEndpoint struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Path       string   `json:"path"`
	EventTypes []string `json:"event_types"`
	ServiceIDs []string `json:"service_ids"`
}

type WebhookAttempt struct {
	Attempt    int       `json:"attempt"`
	At         time.Time `json:"at"`
	StatusCode *int      `json:"status_code"`
	Body       string    `json:"body"`
	Outcome    string    `json:"outcome"`
	Word       string    `json:"word"`
}

type WebhookDelivery struct {
	ID            string           `json:"id"`
	EndpointID    string           `json:"-"`
	EventID       string           `json:"event_id"`
	Type          string           `json:"type"`
	Status        string           `json:"status"`
	StatusWord    string           `json:"status_word"`
	NextAttemptAt *time.Time       `json:"next_attempt_at"`
	Attempts      []WebhookAttempt `json:"attempts"`
}

var deliveryWords = map[string]string{
	"pending": "Pending", "retrying": "Retrying", "delivered": "Delivered",
	"rejected": "Rejected", "failed": "Failed",
}

func (a *App) ListWebhooks(ctx context.Context) ([]WebhookEndpoint, error) {
	rows, err := a.pool.Query(ctx, `SELECT id, name, path, event_types, service_ids FROM webhook_endpoints
		WHERE deleted_at IS NULL ORDER BY created_at`)
	if err != nil {
		return nil, fmt.Errorf("list webhooks: %w", err)
	}
	defer rows.Close()
	out := []WebhookEndpoint{}
	for rows.Next() {
		var e WebhookEndpoint
		var types, services []byte
		if err := rows.Scan(&e.ID, &e.Name, &e.Path, &types, &services); err != nil {
			return nil, fmt.Errorf("read webhook: %w", err)
		}
		if err := jsonInto(types, &e.EventTypes); err != nil {
			return nil, err
		}
		if err := jsonInto(services, &e.ServiceIDs); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (a *App) GetWebhook(ctx context.Context, id string) (*WebhookEndpoint, error) {
	endpoints, err := a.ListWebhooks(ctx)
	if err != nil {
		return nil, err
	}
	for _, e := range endpoints {
		if e.ID == id {
			return &e, nil
		}
	}
	return nil, errNotFound
}

func (a *App) CreateWebhook(ctx context.Context, name, path string, eventTypes, serviceIDs []string) (map[string]any, error) {
	if strings.TrimSpace(name) == "" {
		return nil, errFields("name", "Enter a name.")
	}
	if !strings.HasPrefix(path, "/") {
		return nil, errFields("path", "The path must start with /.")
	}
	for _, t := range eventTypes {
		if !contains(webhookEventTypes, t) {
			return nil, errFields("event_types", "Choose listed event types.")
		}
	}
	if len(eventTypes) == 0 {
		eventTypes = WebhookEventTypes()
	}
	if serviceIDs == nil {
		serviceIDs = []string{}
	}
	id := newID()
	secret := "whsec_" + randomHex(16)
	if _, err := a.pool.Exec(ctx, `INSERT INTO webhook_endpoints (id, name, path, event_types, service_ids, secret, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`, id, name, path, mustJSON(eventTypes), mustJSON(serviceIDs), secret, a.Clock.Now()); err != nil {
		return nil, fmt.Errorf("create webhook: %w", err)
	}
	return map[string]any{"id": id, "name": name, "path": path, "event_types": eventTypes,
		"service_ids": serviceIDs, "secret": secret}, nil
}

func (a *App) DeleteWebhook(ctx context.Context, id string) error {
	tag, err := a.pool.Exec(ctx, `UPDATE webhook_endpoints SET deleted_at=$1 WHERE id=$2 AND deleted_at IS NULL`,
		a.Clock.Now(), id)
	if err != nil {
		return fmt.Errorf("remove webhook: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return errNotFound
	}
	return nil
}

// emitWebhook makes one delivery per subscribed endpoint, each with its own
// event id, and sends the first attempt at once.
func (a *App) emitWebhook(ctx context.Context, inc *incidentRow, eventType string) {
	endpoints, err := a.ListWebhooks(ctx)
	if err != nil {
		log.Printf("webhook endpoints: %v", err)
		return
	}
	service, err := a.serviceRef(ctx, inc.ServiceID)
	if err != nil {
		return
	}
	var mergedNumber *int64
	if inc.MergedInto != nil {
		var number int64
		if err := a.pool.QueryRow(ctx, `SELECT number FROM incidents WHERE id=$1`, *inc.MergedInto).Scan(&number); err == nil {
			mergedNumber = &number
		}
	}
	for _, endpoint := range endpoints {
		if !contains(endpoint.EventTypes, eventType) {
			continue
		}
		if len(endpoint.ServiceIDs) > 0 && !contains(endpoint.ServiceIDs, inc.ServiceID) {
			continue
		}
		eventID := newID()
		body := map[string]any{
			"id": eventID, "type": eventType, "occurred_at": a.Clock.Now(),
			"incident": map[string]any{
				"id": inc.ID, "number": inc.Number, "title": inc.Title, "service": service.Name,
				"status": inc.Status, "urgency": inc.Urgency, "resolve_reason": inc.ResolveReason,
				"merged_into": mergedNumber,
			},
		}
		deliveryID := newID()
		if _, err := a.pool.Exec(ctx, `INSERT INTO webhook_deliveries (id, endpoint_id, event_id, type, body, status,
			next_attempt_at, created_at) VALUES ($1,$2,$3,$4,$5,'pending',$6,$6)`,
			deliveryID, endpoint.ID, eventID, eventType, mustJSON(body), a.Clock.Now()); err != nil {
			log.Printf("create delivery: %v", err)
			continue
		}
		go a.attemptDelivery(context.WithoutCancel(ctx), deliveryID)
	}
}

// attemptDelivery posts one attempt and records the receiver's own answer.
func (a *App) attemptDelivery(ctx context.Context, deliveryID string) {
	var endpointID, eventType, path, secret, status string
	var body []byte
	var eventID string
	var attemptCount int
	err := a.pool.QueryRow(ctx, `SELECT d.endpoint_id, d.event_id, d.type, d.body, d.status, d.attempt_count, e.path, e.secret
		FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id WHERE d.id=$1`, deliveryID).
		Scan(&endpointID, &eventID, &eventType, &body, &status, &attemptCount, &path, &secret)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			log.Printf("read delivery: %v", err)
		}
		return
	}
	if status == "delivered" || status == "rejected" || status == "failed" {
		return
	}
	attempt := attemptCount + 1
	now := a.Clock.Now()
	timestamp := fmt.Sprint(now.Unix())
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp + "." + string(body)))
	signature := "v1=" + hex.EncodeToString(mac.Sum(nil))

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, a.Cfg.WiremockURL+path, bytes.NewReader(body))
	if err != nil {
		log.Printf("build webhook request: %v", err)
		return
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Switchlamp-Event-Id", eventID)
	request.Header.Set("X-Switchlamp-Timestamp", timestamp)
	request.Header.Set("X-Switchlamp-Attempt", fmt.Sprint(attempt))
	request.Header.Set("X-Switchlamp-Signature", signature)

	client := &http.Client{Timeout: 10 * time.Second}
	response, err := client.Do(request)
	var statusCode *int
	answer := ""
	outcome := ""
	switch {
	case err != nil:
		outcome = "unreachable"
		a.recvUp.Store(false)
	default:
		code := response.StatusCode
		statusCode = &code
		raw, readErr := io.ReadAll(io.LimitReader(response.Body, 2000))
		if readErr == nil {
			answer = string(raw)
		}
		_ = response.Body.Close()
		a.recvUp.Store(true)
		switch {
		case code >= 200 && code < 300:
			outcome = "delivered"
		case code >= 500 || code == 429:
			outcome = "retrying"
		default:
			outcome = "rejected"
		}
	}
	if _, err := a.pool.Exec(ctx, `INSERT INTO webhook_attempts (id, delivery_id, attempt, at, status_code, body, outcome)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`, newID(), deliveryID, attempt, now, statusCode, answer, outcome); err != nil {
		log.Printf("record attempt: %v", err)
		return
	}
	newStatus := "retrying"
	var next *time.Time
	switch outcome {
	case "delivered":
		newStatus = "delivered"
	case "rejected":
		newStatus = "rejected"
	default:
		if attempt >= 6 {
			newStatus = "failed"
		} else {
			next = ptr(now.Add(backoff[attempt-1]))
		}
	}
	if _, err := a.pool.Exec(ctx, `UPDATE webhook_deliveries SET status=$1, attempt_count=$2, next_attempt_at=$3 WHERE id=$4`,
		newStatus, attempt, next, deliveryID); err != nil {
		log.Printf("save delivery: %v", err)
		return
	}
	a.publish(ctx, "status", map[string]any{"delivery_id": deliveryID})
}

func (a *App) webhookLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Second):
		}
		if !a.Ready() {
			continue
		}
		rows, err := a.pool.Query(ctx, `SELECT id FROM webhook_deliveries
			WHERE status IN ('pending','retrying') AND next_attempt_at IS NOT NULL AND next_attempt_at <= $1`, a.Clock.Now())
		if err != nil {
			continue
		}
		var ids []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err == nil {
				ids = append(ids, id)
			}
		}
		rows.Close()
		for _, id := range ids {
			a.attemptDelivery(ctx, id)
		}
	}
}

func (a *App) Deliveries(ctx context.Context, endpointID string, limit int) ([]WebhookDelivery, error) {
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	rows, err := a.pool.Query(ctx, `SELECT id, endpoint_id, event_id, type, status, next_attempt_at
		FROM webhook_deliveries WHERE endpoint_id=$1 ORDER BY created_at DESC LIMIT $2`, endpointID, limit)
	if err != nil {
		return nil, fmt.Errorf("list deliveries: %w", err)
	}
	defer rows.Close()
	out := []WebhookDelivery{}
	for rows.Next() {
		var d WebhookDelivery
		if err := rows.Scan(&d.ID, &d.EndpointID, &d.EventID, &d.Type, &d.Status, &d.NextAttemptAt); err != nil {
			return nil, fmt.Errorf("read delivery: %w", err)
		}
		d.StatusWord = deliveryWords[d.Status]
		out = append(out, d)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		attempts, err := a.attemptsFor(ctx, out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].Attempts = attempts
	}
	return out, nil
}

func (a *App) attemptsFor(ctx context.Context, deliveryID string) ([]WebhookAttempt, error) {
	rows, err := a.pool.Query(ctx, `SELECT attempt, at, status_code, body, outcome FROM webhook_attempts
		WHERE delivery_id=$1 ORDER BY attempt`, deliveryID)
	if err != nil {
		return nil, fmt.Errorf("read attempts: %w", err)
	}
	defer rows.Close()
	out := []WebhookAttempt{}
	for rows.Next() {
		var at WebhookAttempt
		if err := rows.Scan(&at.Attempt, &at.At, &at.StatusCode, &at.Body, &at.Outcome); err != nil {
			return nil, fmt.Errorf("read attempt: %w", err)
		}
		at.At = at.At.UTC()
		if at.StatusCode == nil {
			at.Word = "Receiver unreachable"
		} else {
			at.Word = fmt.Sprintf("%d", *at.StatusCode)
		}
		out = append(out, at)
	}
	return out, rows.Err()
}

// ReplayDelivery starts a fresh series under the same event id.
func (a *App) ReplayDelivery(ctx context.Context, id string) (*WebhookDelivery, error) {
	var status string
	err := a.pool.QueryRow(ctx, `SELECT status FROM webhook_deliveries WHERE id=$1`, id).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read delivery: %w", err)
	}
	if status == "pending" || status == "retrying" {
		return nil, errCode(409, "delivery_in_progress")
	}
	if _, err := a.pool.Exec(ctx, `UPDATE webhook_deliveries SET status='pending', next_attempt_at=$1 WHERE id=$2`,
		a.Clock.Now(), id); err != nil {
		return nil, fmt.Errorf("replay delivery: %w", err)
	}
	go a.attemptDelivery(context.WithoutCancel(ctx), id)
	var endpointID string
	if err := a.pool.QueryRow(ctx, `SELECT endpoint_id FROM webhook_deliveries WHERE id=$1`, id).Scan(&endpointID); err != nil {
		return nil, fmt.Errorf("read delivery endpoint: %w", err)
	}
	deliveries, err := a.Deliveries(ctx, endpointID, 100)
	if err != nil {
		return nil, err
	}
	for i := range deliveries {
		if deliveries[i].ID == id {
			return &deliveries[i], nil
		}
	}
	return nil, errNotFound
}

func jsonInto(raw []byte, into any) error {
	if len(raw) == 0 {
		return nil
	}
	if err := json.Unmarshal(raw, into); err != nil {
		return fmt.Errorf("read json: %w", err)
	}
	return nil
}
