package core

import (
	"context"
	"encoding/json"
	"fmt"
	"sync/atomic"
	"time"

	"switchlamp/internal/live"
)

var lastSeq atomic.Int64

// publish writes one decided event to the live record and sends it to every
// open screen, so a page that missed it can ask for it again by seq.
func (a *App) publish(ctx context.Context, kind string, data map[string]any) {
	body, err := json.Marshal(data)
	if err != nil {
		return
	}
	at := a.Clock.Now()
	var seq int64
	if err := a.pool.QueryRow(ctx, `INSERT INTO live_messages (type, at, data) VALUES ($1,$2,$3) RETURNING seq`,
		kind, at, body).Scan(&seq); err != nil {
		return
	}
	lastSeq.Store(seq)
	a.Hub.Broadcast(live.Message{Seq: seq, Type: kind, At: at, Data: data})
}

// tick sends a value that is not a decided event, such as a countdown, under
// the live record's present high-water mark.
func (a *App) tick(kind string, data map[string]any) {
	a.Hub.Broadcast(live.Message{Seq: lastSeq.Load(), Type: kind, At: a.Clock.Now(), Data: data})
}

// Replay answers everything a page missed after a socket drop.
func (a *App) Replay(ctx context.Context, after int64) ([]live.Message, error) {
	rows, err := a.pool.Query(ctx, `SELECT seq, type, at, data FROM live_messages WHERE seq > $1 ORDER BY seq LIMIT 500`, after)
	if err != nil {
		return nil, fmt.Errorf("replay live messages: %w", err)
	}
	defer rows.Close()
	var out []live.Message
	for rows.Next() {
		var m live.Message
		var at time.Time
		var data []byte
		if err := rows.Scan(&m.Seq, &m.Type, &at, &data); err != nil {
			return nil, fmt.Errorf("read live message: %w", err)
		}
		m.At = at.UTC()
		var parsed map[string]any
		if err := json.Unmarshal(data, &parsed); err != nil {
			return nil, fmt.Errorf("read live message data: %w", err)
		}
		m.Data = parsed
		out = append(out, m)
	}
	return out, rows.Err()
}

func (a *App) LastSeq(ctx context.Context) int64 {
	var seq *int64
	if err := a.pool.QueryRow(ctx, `SELECT max(seq) FROM live_messages`).Scan(&seq); err != nil || seq == nil {
		return 0
	}
	lastSeq.Store(*seq)
	return *seq
}

func (a *App) publishSchedule(ctx context.Context, scheduleID string) {
	a.publish(ctx, "schedule", map[string]any{"schedule_id": scheduleID})
}

func (a *App) publishIntegration(ctx context.Context, integrationID string) {
	a.publish(ctx, "integration", map[string]any{"integration_id": integrationID})
}

func (a *App) publishStatus(ctx context.Context) {
	a.publish(ctx, "status", map[string]any{})
}

func (a *App) publishClock(ctx context.Context) {
	a.publish(ctx, "clock", map[string]any{"now": a.Clock.Now()})
}

func (a *App) publishAnalytics(ctx context.Context, jobID string, done, total int, state string) {
	a.publish(ctx, "analytics", map[string]any{"job_id": jobID, "done": done, "total": total, "state": state})
}
