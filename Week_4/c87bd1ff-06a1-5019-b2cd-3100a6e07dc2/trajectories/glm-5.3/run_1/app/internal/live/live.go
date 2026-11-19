// Package live holds the change feed hub: one socket per page, replay from a
// sequence number, and delivery in each viewer's own projection.
package live

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"

	"gavelhouse/internal/store"
)

// Feed builds frames for a viewer from committed events.
type Feed interface {
	// Frame projects one event for one viewer, or nil when the viewer cannot
	// see that event.
	Frame(ctx context.Context, seq int64, viewer *store.Person) (map[string]any, error)
	// Latest gives the newest committed sequence number.
	Latest(ctx context.Context) (int64, error)
}

type Hub struct {
	feed Feed

	mu        sync.Mutex
	clients   map[*client]bool
	bySession map[string]*client
	seq       int64
	wake      chan struct{}
}

func NewHub(feed Feed) *Hub {
	h := &Hub{
		clients:   map[*client]bool{},
		bySession: map[string]*client{},
		wake:      make(chan struct{}, 1),
	}
	go h.pump()
	return h
}

// SetFeed attaches the event projection once it is built.
func (h *Hub) SetFeed(feed Feed) {
	h.mu.Lock()
	h.feed = feed
	h.mu.Unlock()
	h.Advance(0)
}

// Advance records the newest sequence and wakes the pump.
func (h *Hub) Advance(seq int64) {
	h.mu.Lock()
	if seq > h.seq {
		h.seq = seq
	}
	h.mu.Unlock()
	select {
	case h.wake <- struct{}{}:
	default:
	}
}

// SessionTokenOf reads the hashed session token from a request. The httpapi
// package sets it at start.
var SessionTokenOf = func(r *http.Request) string { return "" }

type client struct {
	hub     *Hub
	conn    *websocket.Conn
	person  *store.Person
	session string
	since   int64
	send    chan []byte
	closed  chan struct{}
	once    sync.Once
}

// Attach upgrades one page socket and replays from the asked sequence.
func (h *Hub) Attach(w http.ResponseWriter, r *http.Request, since int64, person *store.Person) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		CompressionMode: websocket.CompressionDisabled,
	})
	if err != nil {
		return
	}
	c := &client{
		hub:     h,
		conn:    conn,
		person:  person,
		session: SessionTokenOf(r),
		since:   since,
		send:    make(chan []byte, 512),
		closed:  make(chan struct{}),
	}
	h.mu.Lock()
	h.clients[c] = true
	if c.session != "" {
		h.bySession[c.session] = c
	}
	h.mu.Unlock()

	go c.writeLoop()
	go c.readLoop()
	h.replay(c)
}

// CloseSession closes every socket opened with the session within a second.
func (h *Hub) CloseSession(hashedToken string) {
	if hashedToken == "" {
		return
	}
	h.mu.Lock()
	c, ok := h.bySession[hashedToken]
	delete(h.bySession, hashedToken)
	h.mu.Unlock()
	if ok {
		c.shutdown()
	}
}

func (c *client) shutdown() {
	c.once.Do(func() {
		close(c.closed)
		c.conn.Close(websocket.StatusNormalClosure, "signed out")
		c.hub.remove(c)
	})
}

// replay sends every event above the asked sequence, once each, in order.
func (h *Hub) replay(c *client) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	latest, err := h.feed.Latest(ctx)
	if err != nil {
		return
	}
	for seq := c.since + 1; seq <= latest; seq++ {
		raw, ok := h.frameFor(ctx, seq, c)
		if !ok {
			continue
		}
		select {
		case c.send <- raw:
			h.mu.Lock()
			c.since = seq
			h.mu.Unlock()
		case <-c.closed:
			return
		case <-time.After(3 * time.Second):
			return
		}
	}
}

func (h *Hub) frameFor(ctx context.Context, seq int64, c *client) ([]byte, bool) {
	frame, err := h.feed.Frame(ctx, seq, c.person)
	if err != nil || frame == nil {
		return nil, false
	}
	raw, err := json.Marshal(frame)
	if err != nil {
		return nil, false
	}
	return raw, true
}

func (h *Hub) pump() {
	for range h.wake {
		h.deliver()
	}
}

// deliver walks every open socket and sends the frames it has not yet seen.
func (h *Hub) deliver() {
	h.mu.Lock()
	seq := h.seq
	clients := make([]*client, 0, len(h.clients))
	for c := range h.clients {
		clients = append(clients, c)
	}
	h.mu.Unlock()
	if len(clients) == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, c := range clients {
		h.mu.Lock()
		from := c.since + 1
		h.mu.Unlock()
		for s := from; s <= seq; s++ {
			raw, ok := h.frameFor(ctx, s, c)
			if !ok {
				h.mu.Lock()
				c.since = s
				h.mu.Unlock()
				continue
			}
			select {
			case c.send <- raw:
				h.mu.Lock()
				c.since = s
				h.mu.Unlock()
			case <-c.closed:
				s = seq
			}
		}
	}
}

func (c *client) writeLoop() {
	for {
		select {
		case <-c.closed:
			return
		case raw := <-c.send:
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			if err := c.conn.Write(ctx, websocket.MessageText, raw); err != nil {
				cancel()
				c.shutdown()
				return
			}
			cancel()
		}
	}
}

// readLoop keeps the socket healthy; the browser never sends anything.
func (c *client) readLoop() {
	for {
		ctx, cancel := context.WithTimeout(context.Background(), time.Hour)
		_, _, err := c.conn.Read(ctx)
		cancel()
		if err != nil {
			c.shutdown()
			return
		}
	}
}

func (h *Hub) remove(c *client) {
	h.mu.Lock()
	delete(h.clients, c)
	if c.session != "" && h.bySession[c.session] == c {
		delete(h.bySession, c.session)
	}
	h.mu.Unlock()
}
