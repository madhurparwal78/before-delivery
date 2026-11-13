package serve

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"switchlamp/internal/clock"
	"switchlamp/internal/domain"
	"switchlamp/internal/store"
)

// Live keeps the durable message log and the open sockets. Every message gets a
// sequence number so a page can replay exactly what it missed.
type Live struct {
	store *store.Store
	clock *clock.Clock

	mu       sync.Mutex
	nextSeq  int64
	clients  map[*liveClient]bool
	wake     chan struct{}
}

type liveClient struct {
	userID string
	role   string
	send   chan []byte
}

// NewLive starts the hub with the sequence continuing from the log.
func NewLive(st *store.Store, c *clock.Clock) *Live {
	l := &Live{store: st, clock: c, clients: map[*liveClient]bool{}, wake: make(chan struct{}, 1)}
	return l
}

// LoadSeq resumes the sequence from the durable log.
func (l *Live) LoadSeq(ctx context.Context) error {
	var n int64
	if err := l.store.Pool().QueryRow(ctx, `SELECT coalesce(max(seq), 0) FROM live_log`).Scan(&n); err != nil {
		return err
	}
	l.mu.Lock()
	l.nextSeq = n + 1
	l.mu.Unlock()
	return nil
}

// Message is one socket message.
type Message struct {
	Seq  int64           `json:"seq"`
	Type string          `json:"type"`
	At   time.Time        `json:"at"`
	Data json.RawMessage `json:"data"`
}

// Publish appends a message to the durable log and fans it out.
func (l *Live) Publish(kind string, data any) {
	b, err := json.Marshal(data)
	if err != nil {
		return
	}
	l.mu.Lock()
	seq := l.nextSeq
	l.nextSeq++
	l.mu.Unlock()
	at := l.clock.Now()
	// Durable append before fan-out.
	if _, err := l.store.Pool().Exec(context.Background(),
		`INSERT INTO live_log (seq, type, at, data) VALUES ($1,$2,$3,$4)`, seq, kind, at, b); err != nil {
		return
	}
	msg := Message{Seq: seq, Type: kind, At: at, Data: b}
	out, _ := json.Marshal(msg)
	l.mu.Lock()
	for c := range l.clients {
		if c.role == "stakeholder" {
			continue
		}
		select {
		case c.send <- out:
		default:
		}
	}
	l.mu.Unlock()
}

// After sends everything after a sequence, in order.
func (l *Live) After(ctx context.Context, after int64, send func([]byte)) {
	rows, err := l.store.Pool().Query(ctx, `SELECT seq, type, at, data FROM live_log WHERE seq > $1 ORDER BY seq`, after)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var m Message
		var data []byte
		if err := rows.Scan(&m.Seq, &m.Type, &m.At, &data); err != nil {
			return
		}
		m.Data = data
		out, err := json.Marshal(m)
		if err != nil {
			return
		}
		send(out)
	}
}

// Register adds an open socket.
func (l *Live) Register(c *liveClient) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.clients[c] = true
}

// Deregister removes a socket.
func (l *Live) Deregister(c *liveClient) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.clients, c)
}

// CloseFor closes every open socket of a person with the published code.
func (l *Live) CloseFor(userID string, code int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for c := range l.clients {
		if c.userID == userID {
			select {
			case c.send <- []byte{0xFF, byte(code >> 8), byte(code)}:
			default:
			}
		}
	}
}

// PublishIncident fans an incident out.
func (l *Live) PublishIncident(ctx context.Context, inc *domain.Incident) {
	item := listItem(ctx, inc)
	data, err := json.Marshal(map[string]any{
		"incident_id": inc.ID,
		"announce":    announceFor(inc),
		"item":        item,
	})
	if err != nil {
		return
	}
	l.Publish("incident", data)
}

// AnnounceTimeline publishes a timeline entry for the incident page.
func (l *Live) AnnounceTimeline(ctx context.Context, incidentID string, e domain.TimelineEntry) {
	data, _ := json.Marshal(map[string]any{
		"incident_id": incidentID,
		"entry":      e,
		"text":        e.Text,
	})
	l.Publish("incident", data)
}

func announceFor(inc *domain.Incident) string {
	if len(inc.Timeline) == 0 {
		return ""
	}
	return inc.Timeline[len(inc.Timeline)-1].Text
}

// listItem is the paged list row.
func listItem(ctx context.Context, inc *domain.Incident) map[string]any {
	return map[string]any{
		"id": inc.ID, "number": inc.Number, "title": inc.Title,
		"service": inc.Service, "status": inc.Status, "urgency": inc.Urgency,
		"holders": inc.Holders, "opened_at": inc.OpenedAt, "alert_count": len(inc.Alerts),
		"countdown": inc.Countdown,
	}
}
