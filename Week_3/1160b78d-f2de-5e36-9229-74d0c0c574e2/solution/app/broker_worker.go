package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"
	"unicode/utf8"

	amqp "github.com/rabbitmq/amqp091-go"
)

const lateEventWait = 60 * time.Second // real time an early message waits for the number before it

// retryWaits are the real waits between the tries of a message that cannot be applied: 3 tries in all.
var retryWaits = []time.Duration{time.Second, 2 * time.Second}

// queueMessage is the body of an event on the queue.
type queueMessage struct {
	EventID    string        `json:"event_id"`
	RoutingKey string        `json:"routing_key"`
	DedupKey   string        `json:"dedup_key"`
	KeySeq     int           `json:"key_seq"`
	Action     string        `json:"event_action"`
	Payload    *queuePayload `json:"payload,omitempty"`
	AcceptedAt string        `json:"accepted_at"`
}

type queuePayload struct {
	Summary       string          `json:"summary"`
	Source        string          `json:"source"`
	Severity      string          `json:"severity"`
	Timestamp     string          `json:"timestamp,omitempty"`
	CustomDetails json.RawMessage `json:"custom_details,omitempty"`
}

// object reads a JSON object; anything else reads as no fields.
func object(raw []byte) map[string]json.RawMessage {
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil {
		return nil
	}
	return fields
}

// text reads a JSON string; an absent, null or non-string value reads as empty.
func text(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) != nil {
		return ""
	}
	return s
}

// whole reads a JSON whole number; anything else reads as 0.
func whole(raw json.RawMessage) int {
	var n int
	if json.Unmarshal(raw, &n) != nil {
		return 0
	}
	return n
}

// absent is a field that is missing or null.
func absent(raw json.RawMessage) bool { return len(raw) == 0 || string(raw) == "null" }

func blank(s string) bool { return strings.TrimSpace(s) == "" }

func missingField(name string) string { return "Missing field: " + name + "." }

// checkMessage reads a queue message and names the first reason it cannot be applied, in the brief's order. The message
// holds whatever fields could be read, so a dead letter can still be tied to its key and integration.
func checkMessage(body []byte) (queueMessage, string) {
	var msg queueMessage
	top := object(body)
	if top == nil && !json.Valid(body) {
		return msg, "Body is not valid JSON."
	}
	msg.EventID, msg.RoutingKey, msg.DedupKey = text(top["event_id"]), text(top["routing_key"]), text(top["dedup_key"])
	msg.KeySeq, msg.Action = whole(top["key_seq"]), text(top["event_action"])
	msg.AcceptedAt = text(top["accepted_at"])
	switch {
	case msg.EventID == "":
		return msg, missingField("event_id")
	case msg.RoutingKey == "":
		return msg, missingField("routing_key")
	case msg.DedupKey == "":
		return msg, missingField("dedup_key")
	case msg.KeySeq < 1:
		return msg, missingField("key_seq")
	case msg.Action == "":
		return msg, missingField("event_action")
	case !validAction(msg.Action):
		return msg, actionSentence
	}
	if msg.Action != actionTrigger {
		return msg, ""
	}
	payload := object(top["payload"])
	if payload == nil {
		return msg, missingField("payload")
	}
	msg.Payload = &queuePayload{
		Summary: text(payload["summary"]), Source: text(payload["source"]), Severity: text(payload["severity"]),
		Timestamp: text(payload["timestamp"]), CustomDetails: payload["custom_details"],
	}
	switch {
	case blank(msg.Payload.Summary):
		return msg, missingField("payload.summary")
	case blank(msg.Payload.Source):
		return msg, missingField("payload.source")
	case absent(payload["severity"]):
		return msg, missingField("payload.severity")
	case !validSeverity(msg.Payload.Severity):
		return msg, "Unknown severity: " + severityText(payload["severity"]) + "."
	case utf8.RuneCountInString(msg.Payload.Summary) > maxSummaryLength:
		return msg, summaryLongSentence
	}
	return msg, ""
}

// storedMessage reads a waiting message, which passed checkMessage before it was kept.
func storedMessage(body []byte) queueMessage {
	msg, _ := checkMessage(body)
	return msg
}

// severityText shows a severity as the sender wrote it.
func severityText(raw json.RawMessage) string {
	if s := text(raw); s != "" {
		return s
	}
	return string(raw)
}

// verifyMessage is checkMessage plus the routing key lookup. It names the reason the message cannot be applied, or
// the integration it belongs to.
func (d *eventDesk) verifyMessage(ctx context.Context, q dbq, body []byte) (msg queueMessage, in integrationRef, reason string, err error) {
	msg, reason = checkMessage(body)
	if reason != "" {
		return msg, in, reason, nil
	}
	in, known, err := d.a.integrationByKey(ctx, q, msg.RoutingKey)
	if err != nil {
		return msg, in, "", fmt.Errorf("find the integration of %s: %w", msg.RoutingKey, err)
	}
	if !known {
		return msg, in, "Unknown routing key: " + msg.RoutingKey + ".", nil
	}
	return msg, in, "", nil
}

// start runs the broker session, the early-message clock and the dead-letter queue sync.
func (d *eventDesk) start(ctx context.Context) {
	go d.q.Run(ctx, d.consume)
	go d.sweep(ctx)
}

// consume handles one delivery. The message is acknowledged once its effect is committed.
func (d *eventDesk) consume(ctx context.Context, delivery amqp.Delivery) {
	if err := d.process(ctx, delivery.Body); err != nil {
		log.Printf("event message: %v", err)
		select {
		case <-ctx.Done():
		case <-time.After(retryWaits[0]):
		}
		if err := delivery.Nack(false, true); err != nil {
			log.Printf("return event message: %v", err)
		}
		return
	}
	if err := delivery.Ack(false); err != nil {
		log.Printf("acknowledge event message: %v", err)
	}
}

// process tries a message up to 3 times in all, then makes it a dead letter. It returns an error only when the record
// itself failed, which leaves the message on the queue.
func (d *eventDesk) process(ctx context.Context, body []byte) error {
	for attempt := 1; ; attempt++ {
		msg, in, reason, err := d.verifyMessage(ctx, d.a.db, body)
		if err != nil {
			return fmt.Errorf("check the message: %w", err)
		}
		if reason == "" {
			if err := d.a.Do(ctx, func(w *Work) error {
				if err := d.accept(w, in, msg, body); err != nil {
					return fmt.Errorf("accept event: %w", err)
				}
				return nil
			}); err != nil {
				return fmt.Errorf("apply event %s: %w", msg.EventID, err)
			}
			return nil
		}
		if attempt > len(retryWaits) {
			err := d.a.Do(ctx, func(w *Work) error {
				if err := d.deadLetter(w, body, msg, reason, attempt); err != nil {
					return fmt.Errorf("dead-letter event: %w", err)
				}
				return nil
			})
			d.nudge()
			if err != nil {
				return fmt.Errorf("dead-letter the message: %w", err)
			}
			return nil
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("wait to try the message again: %w", ctx.Err())
		case <-time.After(retryWaits[attempt-1]):
		}
	}
}

// accept applies a checked message in key_seq order: a copy already applied does nothing, an early message waits.
func (d *eventDesk) accept(w *Work, in integrationRef, msg queueMessage, body []byte) error {
	var applied bool
	err := w.Tx.QueryRow(w.Ctx, `select exists (select 1 from applied_events where event_id = $1)`, msg.EventID).Scan(&applied)
	if err != nil {
		return fmt.Errorf("check event %s: %w", msg.EventID, err)
	}
	if applied {
		return nil
	}
	first, err := firstAbsent(w.Ctx, w.Tx, msg.RoutingKey, msg.DedupKey)
	if err != nil {
		return fmt.Errorf("order event %s: %w", msg.EventID, err)
	}
	if first < msg.KeySeq {
		_, err := w.Tx.Exec(w.Ctx, `insert into waiting_events (event_id, routing_key, dedup_key, key_seq, body, received_at)
			values ($1, $2, $3, $4, $5, $6) on conflict do nothing`,
			msg.EventID, msg.RoutingKey, msg.DedupKey, msg.KeySeq, body, d.a.clock.Real())
		if err != nil {
			return fmt.Errorf("hold event %s: %w", msg.EventID, err)
		}
		return nil
	}
	if _, err := d.applyMessage(w, in, msg, ""); err != nil {
		return fmt.Errorf("apply event %s: %w", msg.EventID, err)
	}
	if err := d.drain(w, in, msg.RoutingKey, msg.DedupKey); err != nil {
		return fmt.Errorf("release the events after %s: %w", msg.EventID, err)
	}
	return nil
}

// firstAbsent is the lowest key_seq of a routing key and dedup key that is neither applied nor dead-lettered.
func firstAbsent(ctx context.Context, q dbq, routingKey, dedupKey string) (int, error) {
	var first int
	err := q.QueryRow(ctx, `select min(n) from generate_series(1, (
			select count(*) + 1 from event_numbers where routing_key = $1 and dedup_key = $2)) as n
		where not exists (select 1 from event_numbers where routing_key = $1 and dedup_key = $2 and key_seq = n)`,
		routingKey, dedupKey).Scan(&first)
	if err != nil {
		return 0, fmt.Errorf("find the first absent key_seq: %w", err)
	}
	return first, nil
}

// applyMessage applies one message through the incident engine, logs its outcome and settles its key_seq and event id.
// A non-empty logged replaces the outcome shown in the log.
func (d *eventDesk) applyMessage(w *Work, in integrationRef, msg queueMessage, logged string) (eventOutcome, error) {
	ev := monitoringEvent{
		EventID: msg.EventID, RoutingKey: msg.RoutingKey, DedupKey: msg.DedupKey, Action: msg.Action,
		IntegrationID: in.ID, IntegrationName: in.Name, ServiceID: in.ServiceID, CustomDetails: json.RawMessage("{}"),
	}
	if p := msg.Payload; p != nil {
		ev.Summary, ev.Source, ev.Severity = p.Summary, p.Source, p.Severity
		if len(p.CustomDetails) > 0 {
			ev.CustomDetails = p.CustomDetails
		}
	}
	outcome, err := d.a.applyMonitoringEvent(w, ev)
	if err != nil {
		return outcome, fmt.Errorf("apply event %s: %w", msg.EventID, err)
	}
	label := outcome.Outcome
	if logged != "" {
		label = logged
	}
	err = w.logEvent(eventLogRow{
		IntegrationID: in.ID, EventID: msg.EventID, Action: msg.Action, DedupKey: msg.DedupKey,
		Outcome: label, Reason: outcome.Reason, IncidentNumber: outcome.IncidentNumber,
	})
	if err != nil {
		return outcome, fmt.Errorf("log intake event: %w", err)
	}
	if _, err := w.Tx.Exec(w.Ctx, `insert into applied_events (event_id) values ($1) on conflict do nothing`, msg.EventID); err != nil {
		return outcome, fmt.Errorf("record event %s: %w", msg.EventID, err)
	}
	if err := settleNumber(w, msg.RoutingKey, msg.DedupKey, msg.KeySeq); err != nil {
		return outcome, fmt.Errorf("settle key_seq: %w", err)
	}
	return outcome, nil
}

// settleNumber records that a key_seq no longer blocks later numbers.
func settleNumber(w *Work, routingKey, dedupKey string, keySeq int) error {
	_, err := w.Tx.Exec(w.Ctx, `insert into event_numbers (routing_key, dedup_key, key_seq) values ($1, $2, $3) on conflict do nothing`,
		routingKey, dedupKey, keySeq)
	if err != nil {
		return fmt.Errorf("settle key_seq %d: %w", keySeq, err)
	}
	return nil
}

// drain applies the waiting messages of a key that the settled numbers released, in key_seq order.
func (d *eventDesk) drain(w *Work, in integrationRef, routingKey, dedupKey string) error {
	for {
		first, err := firstAbsent(w.Ctx, w.Tx, routingKey, dedupKey)
		if err != nil {
			return fmt.Errorf("release waiting events: %w", err)
		}
		var body []byte
		err = w.Tx.QueryRow(w.Ctx, `delete from waiting_events where event_id = (
				select event_id from waiting_events where routing_key = $1 and dedup_key = $2 and key_seq <= $3
				order by key_seq limit 1) returning body`, routingKey, dedupKey, first).Scan(&body)
		if isNoRows(err) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("release a waiting event: %w", err)
		}
		if _, err := d.applyMessage(w, in, storedMessage(body), ""); err != nil {
			return fmt.Errorf("apply a waiting event: %w", err)
		}
	}
}

// sweep ends the wait of early messages whose earlier number never came, and keeps the dead-letter queue in step.
func (d *eventDesk) sweep(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-d.wake:
		}
		if err := d.expireWaiting(ctx); err != nil && ctx.Err() == nil {
			log.Printf("early events: %v", err)
		}
		if err := d.syncDeadQueue(ctx); err != nil && ctx.Err() == nil {
			log.Printf("dead-letter queue: %v", err)
		}
	}
}

func (d *eventDesk) nudge() {
	select {
	case d.wake <- struct{}{}:
	default:
	}
}

// expireWaiting makes dead letters of the messages that waited past the limit.
func (d *eventDesk) expireWaiting(ctx context.Context) error {
	// received_at <= now - wait is the SQL form of the edge rule (edge.go): the wait ends at its last second.
	rows, err := d.a.db.Query(ctx, `select event_id from waiting_events where received_at <= $1 order by received_at`,
		d.a.clock.Real().Add(-lateEventWait))
	if err != nil {
		return fmt.Errorf("list early events: %w", err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return fmt.Errorf("scan early event: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("list early events: %w", err)
	}
	rows.Close()
	for _, id := range ids {
		if err := d.a.Do(ctx, func(w *Work) error {
			if err := d.expire(w, id); err != nil {
				return fmt.Errorf("expire early event: %w", err)
			}
			return nil
		}); err != nil {
			return fmt.Errorf("end the wait of event %s: %w", id, err)
		}
	}
	if len(ids) > 0 {
		d.nudge()
	}
	return nil
}

// expire dead-letters one waiting message with the first absent key_seq as its reason.
func (d *eventDesk) expire(w *Work, eventID string) error {
	var body []byte
	err := w.Tx.QueryRow(w.Ctx, `delete from waiting_events where event_id = $1 returning body`, eventID).Scan(&body)
	if isNoRows(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("claim early event %s: %w", eventID, err)
	}
	msg := storedMessage(body)
	first, err := firstAbsent(w.Ctx, w.Tx, msg.RoutingKey, msg.DedupKey)
	if err != nil {
		return fmt.Errorf("name the absent key_seq of event %s: %w", eventID, err)
	}
	if err := d.deadLetter(w, body, msg, fmt.Sprintf("Earlier event never arrived: key_seq %d.", first), 1); err != nil {
		return fmt.Errorf("dead-letter event: %w", err)
	}
	return nil
}
