package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"unicode/utf8"
)

// The intake sentences of the brief, shared by the drill, which answers with the same ones.
const (
	routingKeySentence       = "Routing key is required."
	actionSentence           = "Action must be trigger, acknowledge or resolve."
	dedupKeyRequiredSentence = "Dedup key is required for this action."
	dedupKeyLengthSentence   = "Dedup key must be 1 to 255 characters."
	summaryRequiredSentence  = "Summary is required."
	summaryLongSentence      = "Summary is longer than 1024 characters."
	sourceRequiredSentence   = "Source is required."
	severitySentence         = "Severity must be critical, error, warning or info."
)

const (
	actionTrigger     = "trigger"
	actionAcknowledge = "acknowledge"
	actionResolve     = "resolve"
	maxSummaryLength  = 1024
	maxDedupKeyLength = 255
)

var eventSeverities = []string{"critical", "error", "warning", "info"}

func validAction(action string) bool {
	return action == actionTrigger || action == actionAcknowledge || action == actionResolve
}

func validSeverity(severity string) bool {
	for _, known := range eventSeverities {
		if severity == known {
			return true
		}
	}
	return false
}

// eventDesk is the event path of this copy: intake, the broker and the worker that applies queued events.
type eventDesk struct {
	a    *App
	q    *Broker
	keys keyedLock
	wake chan struct{} // nudges the dead-letter queue sync after a change
}

func init() {
	routeSetups = append(routeSetups, func(a *App) {
		d := &eventDesk{a: a, q: newBroker(a.cfg), keys: keyedLock{held: map[string]*keyedEntry{}}, wake: make(chan struct{}, 1)}
		d.register()
		workerSetups = append(workerSetups, func(_ *App, ctx context.Context) { d.start(ctx) })
	})
}

// eventProblem is one bad field of an intake request.
type eventProblem struct {
	Field    string
	Sentence string
}

// intakeEvent is a request that passed intake validation.
type intakeEvent struct {
	RoutingKey string
	Action     string
	DedupKey   string // empty on a trigger that brought none
	Payload    *queuePayload
}

// parseIntake validates a request body and lists every bad field in the order of the brief's sentence table.
func parseIntake(top map[string]json.RawMessage) (intakeEvent, []eventProblem) {
	var ev intakeEvent
	var problems []eventProblem
	add := func(field, sentence string) { problems = append(problems, eventProblem{field, sentence}) }

	ev.RoutingKey = text(top["routing_key"])
	if blank(ev.RoutingKey) {
		add("routing_key", routingKeySentence)
	}
	ev.Action = text(top["event_action"])
	if !validAction(ev.Action) {
		add("event_action", actionSentence)
	}
	switch raw := top["dedup_key"]; {
	case !absent(raw):
		ev.DedupKey = text(raw)
		if length := utf8.RuneCountInString(ev.DedupKey); length < 1 || length > maxDedupKeyLength {
			add("dedup_key", dedupKeyLengthSentence)
		}
	case ev.Action == actionAcknowledge || ev.Action == actionResolve:
		add("dedup_key", dedupKeyRequiredSentence)
	}
	if ev.Action == actionTrigger {
		fields := object(top["payload"])
		payload := &queuePayload{
			Summary: text(fields["summary"]), Source: text(fields["source"]), Severity: text(fields["severity"]),
			Timestamp: text(fields["timestamp"]), CustomDetails: fields["custom_details"],
		}
		switch {
		case blank(payload.Summary):
			add("payload.summary", summaryRequiredSentence)
		case utf8.RuneCountInString(payload.Summary) > maxSummaryLength:
			add("payload.summary", summaryLongSentence)
		}
		if blank(payload.Source) {
			add("payload.source", sourceRequiredSentence)
		}
		if !validSeverity(payload.Severity) {
			add("payload.severity", severitySentence)
		}
		ev.Payload = payload
	}
	return ev, problems
}

// hEvent is POST /api/events: validate, count against the rate window, queue and answer once the broker confirmed.
func (d *eventDesk) hEvent(rq *Req) error {
	ctx := rq.Ctx()
	top := object(rq.Body)
	ev, problems := parseIntake(top)
	in, known, err := d.a.integrationByKey(ctx, d.a.db, ev.RoutingKey)
	if err != nil {
		return fmt.Errorf("find the integration of the routing key: %w", err)
	}
	if len(problems) > 0 {
		if known {
			fields := make([]string, 0, len(problems))
			for _, p := range problems {
				fields = append(fields, p.Field)
			}
			reason := "Invalid event: " + strings.Join(fields, ", ") + "."
			if err := d.refuse(ctx, in, text(top["event_action"]), text(top["dedup_key"]), reason); err != nil {
				return fmt.Errorf("refuse invalid event: %w", err)
			}
		}
		return errInvalidEvent(problems)
	}
	if !known {
		return errUnknownRoutingKey()
	}

	slot, counted := d.takeSlot(ctx, in.RoutingKey)
	if counted && !slot.Allowed {
		if err := d.refuse(ctx, in, ev.Action, ev.DedupKey, rateLimitReason); err != nil {
			return fmt.Errorf("refuse rate-limited event: %w", err)
		}
		return errRateLimited(slot.RetryAfter)
	}
	if counted {
		d.announce(ctx, in.ID)
	}

	msg := queueMessage{
		EventID: newID(), RoutingKey: in.RoutingKey, DedupKey: ev.DedupKey, Action: ev.Action, Payload: ev.Payload,
		AcceptedAt: formatInstant(d.a.clock.Now()),
	}
	if msg.DedupKey == "" {
		msg.DedupKey = newID()
	}
	confirmed, err := d.enqueue(ctx, &msg)
	if err != nil {
		return fmt.Errorf("queue event %s: %w", msg.EventID, err)
	}
	if !confirmed {
		if counted {
			d.releaseSlot(ctx, in.RoutingKey, slot.Start)
			d.announce(ctx, in.ID)
		}
		if err := d.refuse(ctx, in, ev.Action, ev.DedupKey, queueRefusalReason); err != nil {
			return fmt.Errorf("refuse unconfirmed event: %w", err)
		}
		return errQueueUnavailable()
	}
	return rq.JSON(http.StatusAccepted, map[string]string{"status": "accepted", "event_id": msg.EventID, "dedup_key": msg.DedupKey})
}

const queueRefusalReason = "The queue did not confirm this event."

func errInvalidEvent(problems []eventProblem) *apiError {
	fields := make(map[string]string, len(problems))
	for _, p := range problems {
		fields[p.Field] = p.Sentence
	}
	return errCode(http.StatusBadRequest, "invalid_event", "errors", fields)
}

func errRateLimited(retryAfter int) *apiError {
	refusal := errCode(http.StatusTooManyRequests, "rate_limited", "retry_after", retryAfter)
	refusal.Headers = map[string]string{"Retry-After": strconv.Itoa(retryAfter)}
	return refusal
}

// refuse logs a refusal from a known routing key.
func (d *eventDesk) refuse(ctx context.Context, in integrationRef, action, dedupKey, reason string) error {
	err := d.a.Do(ctx, func(w *Work) error {
		if err := w.logEvent(eventLogRow{IntegrationID: in.ID, Action: action, DedupKey: dedupKey, Outcome: outcomeRefused, Reason: reason}); err != nil {
			return fmt.Errorf("log refused event: %w", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("log refused event: %w", err)
	}
	return nil
}

// enqueue numbers the event per routing key and dedup key and publishes it. The number is only kept when the broker
// confirmed, so an unconfirmed event leaves no gap. Events of one key are queued one at a time to keep the numbers in order.
func (d *eventDesk) enqueue(ctx context.Context, msg *queueMessage) (confirmed bool, err error) {
	unlock := d.keys.lock(msg.RoutingKey, msg.DedupKey)
	defer unlock()
	var last int
	err = d.a.db.QueryRow(ctx, `select coalesce(max(last_seq), 0) from event_sequences where routing_key = $1 and dedup_key = $2`,
		msg.RoutingKey, msg.DedupKey).Scan(&last)
	if err != nil {
		return false, fmt.Errorf("read key_seq: %w", err)
	}
	msg.KeySeq = last + 1
	body, err := json.Marshal(msg)
	if err != nil {
		return false, fmt.Errorf("encode event: %w", err)
	}
	if err := d.q.PublishEvent(ctx, body); err != nil {
		log.Printf("event %s was not confirmed: %v", msg.EventID, err)
		return false, nil
	}
	_, err = d.a.db.Exec(ctx, `insert into event_sequences (routing_key, dedup_key, last_seq) values ($1, $2, $3)
		on conflict (routing_key, dedup_key) do update set last_seq = excluded.last_seq`, msg.RoutingKey, msg.DedupKey, msg.KeySeq)
	if err != nil {
		return true, fmt.Errorf("record key_seq: %w", err)
	}
	return true, nil
}

// keyedLock serialises work per routing key and dedup key and forgets keys nobody waits on.
type keyedLock struct {
	mu   sync.Mutex
	held map[string]*keyedEntry
}

type keyedEntry struct {
	sync.Mutex
	users int
}

func (k *keyedLock) lock(routingKey, dedupKey string) (unlock func()) {
	name := routingKey + "\x00" + dedupKey
	k.mu.Lock()
	entry := k.held[name]
	if entry == nil {
		entry = &keyedEntry{}
		k.held[name] = entry
	}
	entry.users++
	k.mu.Unlock()
	entry.Lock()
	return func() {
		entry.Unlock()
		k.mu.Lock()
		if entry.users--; entry.users == 0 {
			delete(k.held, name)
		}
		k.mu.Unlock()
	}
}
