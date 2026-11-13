// Package live carries decided events out to every open screen.
package live

import (
	"encoding/json"
	"sync"
	"time"
)

// Message is one socket frame.
type Message struct {
	Seq  int64     `json:"seq"`
	Type string    `json:"type"`
	At   time.Time `json:"at"`
	Data any       `json:"data"`
}

// Client is one open socket.
type Client struct {
	UserID string
	out    chan []byte
	closed chan struct{}
	code   int
	once   sync.Once
}

func NewClient(userID string) *Client {
	return &Client{UserID: userID, out: make(chan []byte, 256), closed: make(chan struct{})}
}

func (c *Client) Out() <-chan []byte      { return c.out }
func (c *Client) Closed() <-chan struct{} { return c.closed }
func (c *Client) CloseCode() int          { return c.code }

func (c *Client) Send(msg Message) {
	b, err := json.Marshal(msg)
	if err != nil {
		return
	}
	select {
	case c.out <- b:
	default:
	}
}

func (c *Client) close(code int) {
	c.once.Do(func() {
		c.code = code
		close(c.closed)
	})
}

// Hub fans decided events out to the open sockets.
type Hub struct {
	mu      sync.RWMutex
	clients map[*Client]struct{}
}

func NewHub() *Hub { return &Hub{clients: map[*Client]struct{}{}} }

func (h *Hub) Add(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.clients[c] = struct{}{}
}

func (h *Hub) Remove(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients, c)
	c.close(1000)
}

func (h *Hub) Broadcast(msg Message) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		select {
		case <-c.closed:
		default:
			c.Send(msg)
		}
	}
}

// CloseUser ends every socket of one person, so nothing further reaches a
// screen whose access has changed.
func (h *Hub) CloseUser(userID string, code int) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		if c.UserID == userID {
			c.close(code)
		}
	}
}
