package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"strconv"
	"sync"
	"time"

	"github.com/lib/pq"
)

// ChangeRow is one committed change in the change log.
type ChangeRow struct {
	Seq                                 int64
	Type, EventID, CalendarID, PersonID string
	Audience                            []string
	Data                                map[string]any
}

const changeColumns = `seq, type, coalesce(event_id,''), coalesce(calendar_id,''), coalesce(person_id,''), audience, data`

func scanChange(rows *sql.Rows) (ChangeRow, error) {
	var r ChangeRow
	var audience pq.StringArray
	var raw []byte
	err := rows.Scan(&r.Seq, &r.Type, &r.EventID, &r.CalendarID, &r.PersonID, &audience, &raw)
	r.Audience = []string(audience)
	json.Unmarshal(raw, &r.Data)
	return r, err
}

// logChange appends one row to the change log inside the caller's transaction.
func logChange(ctx context.Context, q queryer, now time.Time, r ChangeRow) error {
	data, _ := json.Marshal(r.Data)
	_, err := q.ExecContext(ctx, `INSERT INTO change_log (type, event_id, calendar_id, person_id, audience, data, created_at)
		VALUES ($1, NULLIF($2,''), NULLIF($3,''), NULLIF($4,''), $5, $6, $7)`,
		r.Type, r.EventID, r.CalendarID, r.PersonID, pq.Array(r.Audience), data, now)
	return err
}

type liveMessage struct {
	Seq  int64          `json:"seq"`
	Type string         `json:"type"`
	Data map[string]any `json:"data"`
}

// Hub fans committed change rows out to the open connections of this process.
type Hub struct {
	s     *Server
	mu    sync.Mutex
	head  int64
	conns map[chan ChangeRow]bool
	wakeC chan struct{}
}

func newHub(s *Server) *Hub {
	return &Hub{s: s, conns: map[chan ChangeRow]bool{}, wakeC: make(chan struct{}, 1)}
}

func (h *Hub) wake() {
	select {
	case h.wakeC <- struct{}{}:
	default:
	}
}

func (h *Hub) poll(ctx context.Context) {
	if err := h.s.db.QueryRowContext(ctx, `SELECT coalesce(max(seq),0) FROM change_log`).Scan(&h.head); err != nil {
		log.Printf("live feed: %v", err)
	}
	ticker := time.NewTicker(120 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-h.wakeC:
		}
		rows, err := h.s.db.QueryContext(ctx, `SELECT `+changeColumns+` FROM change_log WHERE seq > $1 ORDER BY seq LIMIT 500`, h.head)
		if err != nil {
			continue
		}
		var batch []ChangeRow
		for rows.Next() {
			if r, err := scanChange(rows); err == nil {
				batch = append(batch, r)
			}
		}
		rows.Close()
		if len(batch) == 0 {
			continue
		}
		h.mu.Lock()
		h.head = batch[len(batch)-1].Seq
		for ch := range h.conns {
			for _, r := range batch {
				select {
				case ch <- r:
				default:
					delete(h.conns, ch)
					close(ch)
				}
				if h.conns[ch] == false {
					break
				}
			}
		}
		h.mu.Unlock()
	}
}

// subscribe registers a connection and returns the head it must replay up to.
func (h *Hub) subscribe() (chan ChangeRow, int64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	ch := make(chan ChangeRow, 512)
	h.conns[ch] = true
	return ch, h.head
}

func (h *Hub) unsubscribe(ch chan ChangeRow) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.conns[ch] {
		delete(h.conns, ch)
		close(ch)
	}
}

// handleLive upgrades to a WebSocket, replays every later change the person may see, then follows live.
func (s *Server) handleLive(rq *Req) error {
	after := int64(-1)
	if v := rq.R.URL.Query().Get("after"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 0 {
			return fieldErr("after", "after must be a sequence number.")
		}
		after = n
	}
	conn, err := wsAccept(rq.W, rq.R)
	if err != nil {
		return apiErr(400, "websocket_required", "Open this address as a WebSocket.")
	}
	defer conn.close()
	ch, head := s.hub.subscribe()
	defer s.hub.unsubscribe(ch)
	go func() {
		conn.readLoop()
		s.hub.unsubscribe(ch)
	}()
	ctx := context.Background()
	me := rq.Me.ID
	if after < 0 {
		after = head
	}
	if err := s.replay(ctx, conn, me, after, head); err != nil {
		return nil
	}
	for row := range ch {
		if row.Seq <= head {
			continue
		}
		if msg := s.message(ctx, me, row, nil); msg != nil {
			data, _ := json.Marshal(msg)
			if conn.writeText(data) != nil {
				return nil
			}
		}
	}
	return nil
}

func (s *Server) replay(ctx context.Context, conn *wsConn, me string, after, upTo int64) error {
	if after >= upTo {
		return nil
	}
	w, err := loadWorld(ctx, s.db, s.clock.Now())
	if err != nil {
		return err
	}
	person := w.People[me]
	readable := pq.StringArray{holidaysCalendar}
	for id, c := range w.Calendars {
		if w.canRead(c, person) {
			readable = append(readable, id)
		}
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+changeColumns+` FROM change_log WHERE seq > $1 AND seq <= $2 AND
		(person_id = $3 OR $3 = ANY(audience) OR type = 'zone_rule.recorded' OR calendar_id = ANY($4)
		 OR event_id IN (SELECT event_id FROM guests WHERE person_id = $3)) ORDER BY seq`, after, upTo, me, readable)
	if err != nil {
		return err
	}
	var batch []ChangeRow
	for rows.Next() {
		if r, err := scanChange(rows); err == nil {
			batch = append(batch, r)
		}
	}
	rows.Close()
	cache := &messageCache{world: w, events: map[string]*Event{}}
	for _, row := range batch {
		if msg := s.message(ctx, me, row, cache); msg != nil {
			data, _ := json.Marshal(msg)
			if err := conn.writeText(data); err != nil {
				return err
			}
		}
	}
	return nil
}

type messageCache struct {
	world  *World
	events map[string]*Event
}

// message projects a change row for one person at send time; nil when the person may not see it.
func (s *Server) message(ctx context.Context, me string, row ChangeRow, cache *messageCache) *liveMessage {
	if cache == nil {
		w, err := loadWorld(ctx, s.db, s.clock.Now())
		if err != nil {
			return nil
		}
		cache = &messageCache{world: w, events: map[string]*Event{}}
	}
	w := cache.world
	person := w.People[me]
	if person == nil {
		return nil
	}
	out := &liveMessage{Seq: row.Seq, Type: row.Type, Data: map[string]any{}}
	switch row.Type {
	case "share.changed", "reminder.fired", "print.changed":
		if row.PersonID != me {
			return nil
		}
		out.Data = row.Data
		return out
	case "zone_rule.recorded":
		if person.Role != "guest" {
			out.Data = row.Data
		}
		return out
	case "decision":
		for _, a := range row.Audience {
			if a == me {
				out.Data = row.Data
				return out
			}
		}
		return nil
	}
	if row.PersonID != "" {
		if row.PersonID != me {
			return nil
		}
		out.Data = row.Data
		return out
	}
	return s.eventMessage(ctx, person, row, cache, out)
}

func (s *Server) eventMessage(ctx context.Context, person *Person, row ChangeRow, cache *messageCache, out *liveMessage) *liveMessage {
	w := cache.world
	e, ok := cache.events[row.EventID]
	if !ok {
		events, err := loadEvents(ctx, s.db, `id = $1`, row.EventID)
		if err == nil && len(events) > 0 {
			e = events[0]
			attachDetails(ctx, s.db, events, w.Now)
		}
		cache.events[row.EventID] = e
	}
	if e == nil {
		return nil
	}
	if row.Type == "event.deleted" {
		if cal := w.Calendars[row.CalendarID]; (cal != nil && w.canRead(cal, person)) || e.isGuest(person.ID) {
			out.Data["event_id"] = e.ID
			return out
		}
		return nil
	}
	access := w.access(e, person)
	if access == "" {
		return nil
	}
	if notices, ok := row.Data["notices"].(map[string]any); ok {
		if n, ok := notices[person.ID]; ok {
			out.Data["notice"] = n
		}
	}
	if e.Trashed {
		out.Type = "event.deleted"
		out.Data["event_id"] = e.ID
		return out
	}
	o := w.firstOccurrence(e)
	view := View{W: w, Viewer: person, E: e, O: o, Access: access, EventLevel: true}
	out.Data["event"] = w.project(view)
	return out
}
