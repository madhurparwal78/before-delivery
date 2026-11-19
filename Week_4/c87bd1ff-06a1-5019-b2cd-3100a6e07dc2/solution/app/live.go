package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/lib/pq"
)

// hub wakes every open socket when a change is committed.
type hub struct {
	mu sync.Mutex
	ch chan struct{}
}

func newHub() *hub { return &hub{ch: make(chan struct{})} }

func (h *hub) next() <-chan struct{} {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.ch
}

func (h *hub) wake() {
	h.mu.Lock()
	defer h.mu.Unlock()
	close(h.ch)
	h.ch = make(chan struct{})
}

// listen turns PostgreSQL notifications into wake-ups, with a one-second safety tick.
func (a *App) listen(ctx context.Context) {
	l := pq.NewListener(a.cfg.databaseURL, time.Second, 10*time.Second, func(ev pq.ListenerEventType, err error) {
		if err != nil {
			logf("change feed listener: %v", err)
		}
		if ev == pq.ListenerEventReconnected {
			a.hub.wake()
		}
	})
	defer l.Close()
	if err := l.Listen(notifyChannel); err != nil {
		logf("listen for changes: %v", err)
	}
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-l.Notify:
			a.hub.wake()
		case <-tick.C:
			a.hub.wake()
		}
	}
}

var upgrader = websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}

type eventRow struct {
	seq      int64
	kind     string
	lotID    sql.NullString
	cause    sql.NullString
	noticeID sql.NullInt64
	personID sql.NullString
}

func (a *App) eventsAfter(ctx context.Context, since int64) ([]eventRow, error) {
	rows, err := a.db.QueryContext(ctx, `SELECT seq, kind, lot_id, cause, notice_id, person_id FROM events WHERE seq > $1 ORDER BY seq LIMIT 200`, since)
	if err != nil {
		return nil, fmt.Errorf("read events: %w", err)
	}
	defer rows.Close()
	var out []eventRow
	for rows.Next() {
		var e eventRow
		if err := rows.Scan(&e.seq, &e.kind, &e.lotID, &e.cause, &e.noticeID, &e.personID); err != nil {
			return nil, fmt.Errorf("scan event: %w", err)
		}
		out = append(out, e)
	}
	return out, readErr(rows, "events")
}

// frame renders one event for a viewer, or nil when the viewer may not see it.
func (a *App) frame(ctx context.Context, v *Viewer, e eventRow) (map[string]any, error) {
	switch e.kind {
	case "notice":
		if v == nil {
			return nil, nil
		}
		row := a.db.QueryRowContext(ctx, `SELECT id, kind, text, lot_id, created_at FROM notices WHERE id = $1 AND person_id = $2`, e.noticeID.Int64, v.PersonID)
		n, err := scanNotice(row)
		if errors.Is(err, sql.ErrNoRows) || (err != nil && errors.Is(errors.Unwrap(err), sql.ErrNoRows)) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		return map[string]any{"seq": e.seq, "type": "notice", "notice": n}, nil
	case "lot":
		if e.personID.Valid && (v == nil || v.PersonID != e.personID.String) {
			return nil, nil
		}
		var lot map[string]any
		var history []map[string]any
		err := a.read(ctx, func(q *sql.Tx, now time.Time, seq int64) error {
			l, err := loadLot(ctx, q, viewerID(v), e.lotID.String)
			if err != nil || l == nil || !l.published() {
				lot = nil
				return err
			}
			offers, err := a.offersFor(ctx, q, v, []*lotRow{l})
			if err != nil {
				return err
			}
			lot, history, err = projectLot(ctx, q, v, l, now, offers)
			return err
		})
		if err != nil || lot == nil {
			return nil, err
		}
		return map[string]any{"seq": e.seq, "type": "lot_changed", "cause": e.cause.String, "lot": lot, "history": history}, nil
	}
	return nil, nil
}

func (a *App) handleLive(w http.ResponseWriter, r *http.Request) {
	if !a.sameOrigin(r) {
		writeAPIError(w, errForeignOrigin)
		return
	}
	ctx := r.Context()
	viewer, err := a.viewerFor(r)
	if err != nil {
		logf("socket session: %v", err)
		writeAPIError(w, errUnexpected)
		return
	}
	var token string
	if viewer != nil {
		cookie, _ := r.Cookie(sessionCookie)
		token = cookie.Value
	}
	var cursor int64
	if raw := r.URL.Query().Get("since"); raw != "" {
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || n < 0 {
			writeAPIError(w, invalid("since", "Send the last sequence number you saw.").withStatus(400))
			return
		}
		cursor = n
	} else if err := a.db.QueryRowContext(ctx, `SELECT n FROM counters WHERE name = 'event'`).Scan(&cursor); err != nil {
		logf("read sequence: %v", err)
		writeAPIError(w, errUnexpected)
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	go func() {
		defer cancel()
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()
	for {
		wake := a.hub.next()
		if token != "" {
			alive, err := a.sessionAlive(ctx, token)
			if err != nil {
				if ctx.Err() == nil {
					logf("socket session: %v", err)
				}
				return
			}
			if !alive {
				return
			}
		}
		for {
			events, err := a.eventsAfter(ctx, cursor)
			if err != nil {
				if ctx.Err() == nil {
					logf("socket events: %v", err)
				}
				return
			}
			for _, e := range events {
				f, err := a.frame(ctx, viewer, e)
				if err != nil {
					if ctx.Err() == nil {
						logf("socket frame: %v", err)
					}
					return
				}
				cursor = e.seq
				if f == nil {
					continue
				}
				conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if err := conn.WriteJSON(f); err != nil {
					return
				}
			}
			if len(events) < 200 {
				break
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-wake:
		}
	}
}

func (e *apiError) withStatus(s int) *apiError {
	e.Status = s
	return e
}
