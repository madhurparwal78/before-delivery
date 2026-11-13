package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	statusPending   = "pending"
	statusRetrying  = "retrying"
	statusDelivered = "delivered"
	statusRejected  = "rejected"
	statusFailed    = "failed"

	outcomeNoAnswer  = "Receiver unreachable"
	attemptTimeout   = 10 * time.Second
	attemptBodyChars = 2000
	attemptBodyBytes = 64 << 10
	webhookPoll      = 250 * time.Millisecond
)

// webhookBackoff are the waits between the attempts of one series, counted from the series' first attempt, so a series
// is 6 attempts in all: at T, T+10 s, T+40 s, T+160 s, T+760 s and T+4360 s.
var webhookBackoff = []time.Duration{10 * time.Second, 30 * time.Second, 2 * time.Minute, 10 * time.Minute, time.Hour}

// webhookWake asks the sender to look for due deliveries now: an event was recorded, a Replay began or the clock moved.
var webhookWake = make(chan struct{}, 1)

func wakeWebhooks() {
	select {
	case webhookWake <- struct{}{}:
	default:
	}
}

// retryDue is when the next attempt of a series is due once attemptsMade attempts have failed.
func retryDue(seriesStart time.Time, attemptsMade int) time.Time {
	due := seriesStart
	for _, wait := range webhookBackoff[:attemptsMade] {
		due = due.Add(wait)
	}
	return due
}

// receiverAnswer is what a receiver said; a nil statusCode means it gave no answer.
type receiverAnswer struct {
	statusCode *int
	body       string
}

// status is the delivery state this answer leads to, before the limit on attempts is applied.
func (r receiverAnswer) status() string {
	switch {
	case r.statusCode == nil, *r.statusCode >= 500, *r.statusCode == http.StatusTooManyRequests:
		return statusRetrying
	case *r.statusCode >= 200 && *r.statusCode < 300:
		return statusDelivered
	}
	return statusRejected
}

// outgoing is one attempt about to go out.
type outgoing struct {
	deliveryID string
	eventID    string
	body       string
	path       string
	secret     string
	attempt    int
}

// claimSet tracks the ids a worker is already handling, so none is handled twice at once.
type claimSet struct {
	mu   sync.Mutex
	held map[string]struct{}
}

func newClaimSet() *claimSet { return &claimSet{held: map[string]struct{}{}} }

// claim reports whether the caller now holds the id; false when somebody already does.
func (c *claimSet) claim(id string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, taken := c.held[id]; taken {
		return false
	}
	c.held[id] = struct{}{}
	return true
}

func (c *claimSet) release(id string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.held, id)
}

// webhookSender posts due deliveries to the receiver, each in its own goroutine, one attempt at a time per delivery.
type webhookSender struct {
	a      *App
	client *http.Client
	busy   *claimSet
}

func init() {
	workerSetups = append(workerSetups, func(a *App, ctx context.Context) {
		sender := &webhookSender{a: a, busy: newClaimSet(), client: &http.Client{
			Timeout:       attemptTimeout,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		}}
		go sender.run(ctx)
	})
}

func (s *webhookSender) run(ctx context.Context) {
	ticker := time.NewTicker(webhookPoll)
	defer ticker.Stop()
	for {
		if err := s.dispatchDue(ctx); err != nil && ctx.Err() == nil {
			log.Printf("webhook sender: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-webhookWake:
		}
	}
}

// dispatchDue starts an attempt for every delivery that is due on the server clock and not already going out.
func (s *webhookSender) dispatchDue(ctx context.Context) error {
	// next_attempt_at <= now is the SQL form of the edge rule (edge.go): an attempt starts at its due second.
	rows, err := s.a.db.Query(ctx, `select id from webhook_deliveries where status in ('pending', 'retrying')
		and next_attempt_at <= $1 order by next_attempt_at, seq`, s.a.clock.Now())
	if err != nil {
		return fmt.Errorf("find due deliveries: %w", err)
	}
	due, err := collectIDs(rows)
	if err != nil {
		return fmt.Errorf("find due deliveries: %w", err)
	}
	for _, id := range due {
		if s.busy.claim(id) {
			go s.attempt(ctx, id)
		}
	}
	return nil
}

func (s *webhookSender) attempt(ctx context.Context, id string) {
	defer s.busy.release(id)
	if err := s.send(ctx, id); err != nil && ctx.Err() == nil {
		log.Printf("webhook delivery %s: %v", id, err)
	}
}

func (s *webhookSender) send(ctx context.Context, id string) error {
	var out outgoing
	err := s.a.db.QueryRow(ctx, `select d.id, d.event_id, d.body, h.path, h.secret,
		(select coalesce(max(attempt), 0) + 1 from webhook_attempts where delivery_id = d.id)
		from webhook_deliveries d join webhooks h on h.id = d.webhook_id where d.id = $1`, id).
		Scan(&out.deliveryID, &out.eventID, &out.body, &out.path, &out.secret, &out.attempt)
	if isNoRows(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("load delivery: %w", err)
	}
	at := s.a.clock.Now()
	if err := s.a.recordAttempt(ctx, out, at, s.post(ctx, out, at)); err != nil {
		return fmt.Errorf("record delivery attempt: %w", err)
	}
	return nil
}

// post makes one attempt. A receiver that cannot be reached, does not answer in time or breaks off its answer has given no
// answer, and so has an address that cannot be called at all. The receiver's address is read from the configuration each time.
func (s *webhookSender) post(ctx context.Context, out outgoing, at time.Time) receiverAnswer {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, s.a.cfg.WiremockURL+out.path, strings.NewReader(out.body))
	if err != nil {
		return receiverAnswer{}
	}
	stamp := strconv.FormatInt(at.Unix(), 10)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Switchlamp-Event-Id", out.eventID)
	request.Header.Set("X-Switchlamp-Timestamp", stamp)
	request.Header.Set("X-Switchlamp-Attempt", strconv.Itoa(out.attempt))
	request.Header.Set("X-Switchlamp-Signature", "v1="+sign(out.secret, stamp, out.body))
	response, err := s.client.Do(request)
	if err != nil {
		return receiverAnswer{}
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, attemptBodyBytes))
	if err != nil {
		return receiverAnswer{}
	}
	return receiverAnswer{statusCode: &response.StatusCode, body: storable(body)}
}

// sign is the lowercase hex HMAC-SHA256 of "<timestamp>.<raw body>" under the endpoint's secret.
func sign(secret, stamp, body string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(stamp + "." + body))
	return hex.EncodeToString(mac.Sum(nil))
}

// storable is the first 2000 characters of an answer, as text Postgres accepts.
func storable(body []byte) string {
	text := strings.Map(func(r rune) rune {
		if r == 0 {
			return -1
		}
		return r
	}, strings.ToValidUTF8(string(body), "�"))
	if utf8.RuneCountInString(text) <= attemptBodyChars {
		return text
	}
	return string([]rune(text)[:attemptBodyChars])
}

// recordAttempt writes what the receiver said and moves the delivery on: delivered and rejected end the series, a retry
// is due on the backoff, and the sixth failure ends it as failed. An endpoint deleted meanwhile takes its deliveries with it.
func (a *App) recordAttempt(ctx context.Context, out outgoing, at time.Time, answer receiverAnswer) error {
	if err := a.Do(ctx, func(w *Work) error {
		var started *time.Time
		var made int
		var webhookID string
		err := w.Tx.QueryRow(w.Ctx, `select webhook_id, series_started_at, series_attempts from webhook_deliveries
			where id = $1 for update`, out.deliveryID).Scan(&webhookID, &started, &made)
		if isNoRows(err) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("lock delivery: %w", err)
		}
		made++
		if started == nil {
			started = &at
		}
		status := answer.status()
		if status == statusRetrying && made > len(webhookBackoff) {
			status = statusFailed
		}
		var next *time.Time
		if status == statusRetrying {
			due := retryDue(*started, made)
			next = &due
		}
		outcome := strings.ToUpper(status[:1]) + status[1:]
		if answer.statusCode == nil {
			outcome = outcomeNoAnswer
		}
		_, err = w.Tx.Exec(w.Ctx, `insert into webhook_attempts (delivery_id, attempt, at, status_code, body, outcome)
			values ($1, $2, $3, $4, $5, $6)`, out.deliveryID, out.attempt, at, answer.statusCode, answer.body, outcome)
		if err != nil {
			return fmt.Errorf("record attempt: %w", err)
		}
		_, err = w.Tx.Exec(w.Ctx, `update webhook_deliveries set status = $2, next_attempt_at = $3, series_started_at = $4,
			series_attempts = $5 where id = $1`, out.deliveryID, status, next, started, made)
		if err != nil {
			return fmt.Errorf("update delivery: %w", err)
		}
		w.Publish("access", map[string]any{"kind": "webhooks", "webhook_id": webhookID})
		return nil
	}); err != nil {
		return fmt.Errorf("record delivery attempt: %w", err)
	}
	return nil
}
