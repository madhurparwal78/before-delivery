package serve

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"switchlamp/internal/config"
	"switchlamp/internal/domain"
	"switchlamp/internal/store"
)

func genID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// webhookBackoff holds the published waits after the first attempt, which goes
// at once: 10 s, 30 s, 2 min, 10 min, 1 hour, for 6 attempts in all.
var webhookBackoff = []time.Duration{10 * time.Second, 30 * time.Second, 2 * time.Minute, 10 * time.Minute, time.Hour}

// Webhooks posts signed incident events to the outside receiver.
type Webhooks struct {
	store *store.Store
	cfg   *config.Config
	http  *http.Client
	clock webhookClock
}

// webhookClock is the server clock, so attempts never depend on the database's.
type webhookClock interface {
	Now() time.Time
}

// NewWebhooks builds the worker.
func NewWebhooks(st *store.Store, cfg *config.Config, client *http.Client, clk webhookClock) *Webhooks {
	return &Webhooks{store: st, cfg: cfg, http: client, clock: clk}
}

// Endpoint mirrors webhook_endpoints.
type Endpoint struct {
	ID         string
	Name       string
	Path       string
	EventTypes []string
	ServiceIDs []string
	Secret     string
}

func (h *Webhooks) endpoints(ctx context.Context) ([]Endpoint, error) {
	rows, err := h.store.Pool().Query(ctx, `SELECT id, name, path, event_types, service_ids, secret FROM webhook_endpoints`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Endpoint
	for rows.Next() {
		var e Endpoint
		var types, ids []byte
		if err := rows.Scan(&e.ID, &e.Name, &e.Path, &types, &ids, &e.Secret); err != nil {
			return nil, err
		}
		json.Unmarshal(types, &e.EventTypes)
		json.Unmarshal(ids, &e.ServiceIDs)
		out = append(out, e)
	}
	return out, rows.Err()
}

// webhookBody is the published body, which never carries notes, drafts or
// people's addresses.
type webhookBody struct {
	ID         string `json:"id"`
	Type       string `json:"type"`
	OccurredAt string `json:"occurred_at"`
	Incident   struct {
		ID            string  `json:"id"`
		Number        int64   `json:"number"`
		Title         string  `json:"title"`
		Service       string  `json:"service"`
		Status        string  `json:"status"`
		Urgency       string  `json:"urgency"`
		ResolveReason *string `json:"resolve_reason"`
		MergedInto    *int64  `json:"merged_into"`
	} `json:"incident"`
}

// Enqueue creates one delivery with one event id per subscribed endpoint. The
// first attempt goes at once.
func (h *Webhooks) Enqueue(ctx context.Context, inc *domain.Incident, kind string, at time.Time) {
	endpoints, err := h.endpoints(ctx)
	if err != nil {
		return
	}
	for _, e := range endpoints {
		if !contains(e.EventTypes, kind) {
			continue
		}
		if len(e.ServiceIDs) > 0 && !contains(e.ServiceIDs, inc.ServiceID) {
			continue
		}
		body := webhookBody{ID: genID(), Type: kind, OccurredAt: at.UTC().Format("2006-01-02T15:04:05Z")}
		body.Incident.ID = inc.ID
		body.Incident.Number = inc.Number
		body.Incident.Title = inc.Title
		body.Incident.Service = inc.Service.Name
		body.Incident.Status = inc.Status
		body.Incident.Urgency = inc.Urgency
		body.Incident.ResolveReason = inc.ResolveReason
		if inc.MergedInto != nil {
			// A merged source carries the target's number.
			body.Incident.MergedInto = inc.MergedNumber()
		}
		payload, _ := json.Marshal(body)
		if _, err := h.store.Pool().Exec(ctx, `INSERT INTO deliveries (id, endpoint_id, event_id, type, incident_id,
			status, next_attempt_at, attempt, payload, occurred_at)
			VALUES ($1,$2,$3,$4,$5,'pending', now(), 0, $6, $7)`,
			genID(), e.ID, body.ID, kind, inc.ID, payload, at); err != nil {
			continue
		}
	}
}

func contains(list []string, v string) bool {
	for _, s := range list {
		if s == v {
			return true
		}
	}
	return false
}

// Run drives the backoff for every delivery.
func (h *Webhooks) Run(ctx context.Context) {
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			_ = h.pass(ctx)
		}
	}
}

func (h *Webhooks) pass(ctx context.Context) error {
	// The comparison uses the server clock, never the database's.
	now := h.clock.Now()
	rows, err := h.store.Pool().Query(ctx, `SELECT d.id, d.payload, d.attempt, e.path, e.secret
		FROM deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id
		WHERE d.status IN ('pending','retrying') AND d.next_attempt_at <= $1
		ORDER BY d.next_attempt_at`, now)
	if err != nil {
		return err
	}
	type job struct {
		ID       string
		Payload  []byte
		Attempt  int
		Path     string
		Secret   string
	}
	var due []job
	for rows.Next() {
		var j job
		if err := rows.Scan(&j.ID, &j.Payload, &j.Attempt, &j.Path, &j.Secret); err != nil {
			rows.Close()
			return err
		}
		due = append(due, j)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, j := range due {
		if err := h.attempt(ctx, j.ID, j.Path, j.Secret, j.Attempt+1, j.Payload); err != nil {
			return err
		}
	}
	return nil
}

// attempt posts once and records the receiver's own answer.
func (h *Webhooks) attempt(ctx context.Context, deliveryID, path, secret string, attempt int, payload []byte) error {
	now := time.Now().UTC()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.cfg.WiremockURL+path, bytes.NewReader(payload))
	if err != nil {
		return nil
	}
	req.Header.Set("Content-Type", "application/json")
	ts := fmt.Sprintf("%d", now.Unix())
	req.Header.Set("X-Switchlamp-Event-Id", deliveryEventID(ctx, h.store, deliveryID))
	req.Header.Set("X-Switchlamp-Timestamp", ts)
	req.Header.Set("X-Switchlamp-Attempt", fmt.Sprintf("%d", attempt))
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(ts + "." + string(payload)))
	req.Header.Set("X-Switchlamp-Signature", "v1="+hex.EncodeToString(mac.Sum(nil)))

	status := 0
	var body []byte
	resp, err := h.http.Do(req)
	if err == nil {
		defer resp.Body.Close()
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		body = b
		status = resp.StatusCode
	} else if ctx.Err() != nil {
		return ctx.Err()
	}
	// The delivery state comes from the receiver's own answer.
	newStatus := "retrying"
	outcome := "retrying"
	switch {
	case status >= 200 && status < 300:
		newStatus, outcome = "delivered", "delivered"
	case status >= 500 || status == 429:
		newStatus, outcome = "retrying", "retrying"
	case status == 0:
		outcome = "Receiver unreachable"
	default:
		newStatus, outcome = "rejected", "rejected"
	}
	var code any
	if status > 0 {
		code = status
	}
	if _, err := h.store.Pool().Exec(ctx, `INSERT INTO attempts (id, delivery_id, attempt, at, status_code, body, outcome)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`, genID(), deliveryID, attempt, now, code, string(body), outcome); err != nil {
		return err
	}
	if newStatus == "delivered" || newStatus == "rejected" {
		_, err := h.store.Pool().Exec(ctx, `UPDATE deliveries SET status = $2, attempt = $3, next_attempt_at = NULL WHERE id = $1`,
			deliveryID, newStatus, attempt)
		return err
	}
	if attempt >= 6 {
		_, err := h.store.Pool().Exec(ctx, `UPDATE deliveries SET status = 'failed', attempt = $2, next_attempt_at = NULL WHERE id = $1`,
			deliveryID, attempt)
		return err
	}
	t := time.Now().UTC().Add(webhookBackoff[attempt-1])
	_, err = h.store.Pool().Exec(ctx, `UPDATE deliveries SET status = 'retrying', attempt = $2, next_attempt_at = $3 WHERE id = $1`,
		deliveryID, attempt, t)
	return err
}

func deliveryEventID(ctx context.Context, s *store.Store, deliveryID string) string {
	var id string
	s.Pool().QueryRow(ctx, `SELECT event_id FROM deliveries WHERE id = $1`, deliveryID).Scan(&id)
	return id
}

// ReplayDelivery starts a fresh series on the same event id, with attempt
// numbers continuing from the last.
func (h *Webhooks) ReplayDelivery(ctx context.Context, deliveryID string) (bool, error) {
	var status string
	var attempt int
	if err := h.store.Pool().QueryRow(ctx, `SELECT status, attempt FROM deliveries WHERE id = $1`, deliveryID).
		Scan(&status, &attempt); err != nil {
		return false, err
	}
	if status == "pending" || status == "retrying" {
		return false, nil
	}
	if _, err := h.store.Pool().Exec(ctx, `UPDATE deliveries SET status = 'pending', next_attempt_at = now() WHERE id = $1`,
		deliveryID); err != nil {
		return false, err
	}
	return true, nil
}

// Deliveries lists one endpoint's deliveries with their attempts.
func (h *Webhooks) Deliveries(ctx context.Context, endpointID string, limit int) ([]map[string]any, error) {
	rows, err := h.store.Pool().Query(ctx, `SELECT id, event_id, type, status, next_attempt_at, attempt
		FROM deliveries WHERE endpoint_id = $1 ORDER BY created_at DESC LIMIT $2`, endpointID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	var found []map[string]any
	for rows.Next() {
		var id, eventID, typ, status string
		var next *time.Time
		var attempt int
		if err := rows.Scan(&id, &eventID, &typ, &status, &next, &attempt); err != nil {
			return nil, err
		}
		ids = append(ids, id)
		found = append(found, map[string]any{
			"id": id, "event_id": eventID, "type": typ, "status": status,
			"next_attempt_at": next, "attempts": nil,
		})
	}
	rows.Close()
	for i, id := range ids {
		found[i]["attempts"] = h.attemptsFor(ctx, id)
	}
	return found, nil
}

func (h *Webhooks) attemptsFor(ctx context.Context, deliveryID string) []map[string]any {
	rows, err := h.store.Pool().Query(ctx, `SELECT attempt, at, status_code, body, outcome
		FROM attempts WHERE delivery_id = $1 ORDER BY attempt`, deliveryID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var attempt int
		var at time.Time
		var code *int
		var body string
		var outcome string
		if err := rows.Scan(&attempt, &at, &code, &body, &outcome); err != nil {
			return nil
		}
		out = append(out, map[string]any{
			"attempt": attempt, "at": at, "status_code": code, "body": body, "outcome": outcome,
		})
	}
	return out
}

// Upgrade rewrites record_format 1 schedules once on start without blocking
// reads: readers answer the same blocks before and after.
type Upgrade struct {
	store *store.Store
}

// NewUpgrade builds the upgrade worker.
func NewUpgrade(st *store.Store) *Upgrade { return &Upgrade{store: st} }

// Run performs the one background upgrade: the UTC handoff becomes a local
// handoff time and upgraded_at is set.
func (u *Upgrade) Run(ctx context.Context) {
	if _, err := u.store.Pool().Exec(ctx, `UPDATE layers SET handoff_time = '08:00'
		WHERE schedule_id IN (SELECT id FROM schedules WHERE record_format = 1)`); err != nil {
		return
	}
	if _, err := u.store.Pool().Exec(ctx, `UPDATE schedules SET record_format = 2, upgraded_at = now()
		WHERE record_format = 1`); err != nil {
		return
	}
}

// State reports the published upgrade state.
func (u *Upgrade) State(ctx context.Context) (state string, upgraded int, finishedAt *time.Time) {
	var count int
	var at *time.Time
	if err := u.store.Pool().QueryRow(ctx, `SELECT count(*), max(upgraded_at) FROM schedules WHERE upgraded_at IS NOT NULL`).
		Scan(&count, &at); err != nil {
		return "done", 0, nil
	}
	if count > 0 {
		return "done", count, at
	}
	return "running", 0, nil
}
