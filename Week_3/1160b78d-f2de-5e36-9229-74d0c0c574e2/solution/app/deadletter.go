package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Dead-letter states: pending until the message is on the dead-letter queue, queued while listed, replayed once a
// Replay applied it and until the message left the queue, then removed.
const (
	deadPending  = "pending"
	deadQueued   = "queued"
	deadReplayed = "replayed"
	deadRemoved  = "removed"
)

// deadLetter records a message that cannot be applied: it settles the message's key_seq, logs it and lists it once the
// message is on the dead-letter queue. raw is the message as it came.
func (d *eventDesk) deadLetter(w *Work, raw []byte, msg queueMessage, reason string, attempts int) error {
	var in integrationRef
	var known bool
	var err error
	if msg.RoutingKey != "" {
		if in, known, err = d.a.integrationByKey(w.Ctx, w.Tx, msg.RoutingKey); err != nil {
			return fmt.Errorf("find the integration of a dead letter: %w", err)
		}
	}
	var integrationID *string
	if known {
		integrationID = &in.ID
	}
	_, err = w.Tx.Exec(w.Ctx, `insert into dead_letters (id, integration_id, routing_key, event_id, reason, raw, attempts, dead_at)
		values ($1, $2, $3, $4, $5, $6, $7, $8)`,
		newID(), integrationID, nullable(msg.RoutingKey), nullable(msg.EventID), reason, raw, attempts, w.Now)
	if err != nil {
		return fmt.Errorf("record dead letter: %w", err)
	}
	if msg.RoutingKey != "" && msg.DedupKey != "" && msg.KeySeq >= 1 {
		if err := settleNumber(w, msg.RoutingKey, msg.DedupKey, msg.KeySeq); err != nil {
			return fmt.Errorf("settle a dead letter: %w", err)
		}
	}
	if !known {
		return nil
	}
	err = w.logEvent(eventLogRow{
		IntegrationID: in.ID, EventID: msg.EventID, Action: msg.Action, DedupKey: msg.DedupKey,
		Outcome: outcomeDeadLettered, Reason: reason,
	})
	if err != nil {
		return fmt.Errorf("log a dead letter: %w", err)
	}
	if err := d.drain(w, in, msg.RoutingKey, msg.DedupKey); err != nil {
		return fmt.Errorf("release the events after a dead letter: %w", err)
	}
	return nil
}

// syncDeadQueue puts new dead letters on the dead-letter queue, where they are listed from, and takes replayed ones off it.
func (d *eventDesk) syncDeadQueue(ctx context.Context) error {
	if !d.q.Up() {
		return nil
	}
	publish := func(id string, raw []byte) error {
		if err := d.q.PublishDead(ctx, id, raw); err != nil {
			return fmt.Errorf("publish dead letter %s: %w", id, err)
		}
		return nil
	}
	if err := d.moveDead(ctx, deadPending, deadQueued, publish); err != nil {
		return fmt.Errorf("queue new dead letters: %w", err)
	}
	remove := func(id string, _ []byte) error {
		if err := d.q.RemoveDead(ctx, id); err != nil {
			return fmt.Errorf("remove dead letter %s: %w", id, err)
		}
		return nil
	}
	if err := d.moveDead(ctx, deadReplayed, deadRemoved, remove); err != nil {
		return fmt.Errorf("remove replayed dead letters: %w", err)
	}
	return nil
}

type deadEntry struct {
	id            string
	raw           []byte
	integrationID *string
}

// moveDead takes every dead letter in one state through a queue operation and into the next state.
func (d *eventDesk) moveDead(ctx context.Context, from, to string, operate func(id string, raw []byte) error) error {
	rows, err := d.a.db.Query(ctx, `select id, raw, integration_id from dead_letters where state = $1 order by seq`, from)
	if err != nil {
		return fmt.Errorf("list %s dead letters: %w", from, err)
	}
	defer rows.Close()
	var entries []deadEntry
	for rows.Next() {
		var e deadEntry
		if err := rows.Scan(&e.id, &e.raw, &e.integrationID); err != nil {
			return fmt.Errorf("scan dead letter: %w", err)
		}
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("list %s dead letters: %w", from, err)
	}
	rows.Close()
	for _, e := range entries {
		if err := operate(e.id, e.raw); err != nil {
			return fmt.Errorf("move dead letter %s to %s: %w", e.id, to, err)
		}
		err := d.a.Do(ctx, func(w *Work) error {
			if _, err := w.Tx.Exec(w.Ctx, `update dead_letters set state = $2 where id = $1 and state = $3`, e.id, to, from); err != nil {
				return fmt.Errorf("mark dead letter %s %s: %w", e.id, to, err)
			}
			integrationID := ""
			if e.integrationID != nil {
				integrationID = *e.integrationID
			}
			w.Publish("integration", map[string]string{"integration_id": integrationID})
			return nil
		})
		if err != nil {
			return fmt.Errorf("mark dead letter %s %s: %w", e.id, to, err)
		}
	}
	return nil
}

// deadLetterItem is one entry of GET /api/dead-letters.
type deadLetterItem struct {
	ID            string  `json:"id"`
	EventID       *string `json:"event_id"`
	RoutingKey    *string `json:"routing_key"`
	IntegrationID *string `json:"integration_id"`
	Reason        string  `json:"reason"`
	Raw           any     `json:"raw"`
	Attempts      int     `json:"attempts"`
	DeadAt        string  `json:"dead_at"`
}

func (d *eventDesk) hListDeadLetters(rq *Req) error {
	rows, err := d.a.db.Query(rq.Ctx(), `select id, event_id, routing_key, integration_id, reason, raw, attempts, dead_at
		from dead_letters where state = $1 and ($2 = '' or integration_id = $2) order by seq desc`, deadQueued, rq.Query("integration_id"))
	if err != nil {
		return fmt.Errorf("list dead letters: %w", err)
	}
	defer rows.Close()
	items := []deadLetterItem{}
	for rows.Next() {
		var item deadLetterItem
		var raw []byte
		var deadAt time.Time
		err := rows.Scan(&item.ID, &item.EventID, &item.RoutingKey, &item.IntegrationID, &item.Reason, &raw, &item.Attempts, &deadAt)
		if err != nil {
			return fmt.Errorf("scan dead letter: %w", err)
		}
		item.DeadAt = formatInstant(deadAt)
		item.Raw = string(raw)
		if json.Valid(raw) {
			item.Raw = json.RawMessage(raw)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("list dead letters: %w", err)
	}
	return rq.JSON(http.StatusOK, map[string]any{"items": items})
}

// hReplay applies a dead letter's message, or the corrected one sent with the request, as of now and exactly once.
func (d *eventDesk) hReplay(rq *Req) error {
	var corrected json.RawMessage
	if message := object(rq.Body)["message"]; !absent(message) {
		corrected = message
	}
	var eventID string
	err := d.a.Do(rq.Ctx(), func(w *Work) error {
		var state string
		var raw []byte
		err := w.Tx.QueryRow(w.Ctx, `select state, raw from dead_letters where id = $1 for update`, rq.Param("id")).Scan(&state, &raw)
		if err != nil {
			return fmt.Errorf("read dead letter %s: %w", rq.Param("id"), err)
		}
		switch state {
		case deadPending:
			return errNotFound()
		case deadReplayed, deadRemoved:
			return errConflict("already_replayed")
		}
		if corrected != nil {
			raw = corrected
		}
		msg, in, reason, err := d.verifyMessage(w.Ctx, w.Tx, raw)
		if err != nil {
			return fmt.Errorf("check the message to replay: %w", err)
		}
		if reason != "" {
			return errField("message", reason)
		}
		var applied bool
		if err := w.Tx.QueryRow(w.Ctx, `select exists (select 1 from applied_events where event_id = $1)`, msg.EventID).Scan(&applied); err != nil {
			return fmt.Errorf("check event %s: %w", msg.EventID, err)
		}
		if !applied {
			if _, err := d.applyMessage(w, in, msg, outcomeReplayed); err != nil {
				return fmt.Errorf("apply the replayed event: %w", err)
			}
		}
		if _, err := w.Tx.Exec(w.Ctx, `update dead_letters set state = $2 where id = $1`, rq.Param("id"), deadReplayed); err != nil {
			return fmt.Errorf("mark dead letter %s replayed: %w", rq.Param("id"), err)
		}
		eventID = msg.EventID
		if err := d.drain(w, in, msg.RoutingKey, msg.DedupKey); err != nil {
			return fmt.Errorf("release held events: %w", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("replay dead letter %s: %w", rq.Param("id"), err)
	}
	d.nudge()
	return rq.JSON(http.StatusOK, map[string]string{"status": "replayed", "event_id": eventID})
}
