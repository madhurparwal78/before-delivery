package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Close codes the brief publishes, and how many live messages are kept for replay.
const (
	closeSignedOut   = 4401
	closeRoleChanged = 4403
	liveKeep         = 20000
	pingEvery        = 20 * time.Second
	readIdle         = 70 * time.Second
	closeGrace       = 2 * time.Second
)

// upgrader accepts any origin because the boundary check in http.go already refused a foreign one. A refused handshake
// is answered by writeError like every other failure.
var upgrader = websocket.Upgrader{
	CheckOrigin: func(*http.Request) bool { return true },
	Error: func(w http.ResponseWriter, _ *http.Request, status int, _ error) {
		writeError(w, errBadHandshake(status))
	},
}

// liveMessage is one socket message.
type liveMessage struct {
	Seq  int64  `json:"seq"`
	Type string `json:"type"`
	At   string `json:"at"`
	Data any    `json:"data"`
}

// Hub owns the live socket: sequence numbers, replay after a drop, and the per-second countdown and clock messages.
type Hub struct {
	a          *App
	mu         sync.Mutex
	seq        int64
	conns      map[*liveConn]struct{}
	countdowns map[string]func(ctx context.Context, id string) (any, error)
	inserts    int
}

type liveConn struct {
	userID  string
	out     chan []byte
	watches map[string]struct{} // "scope:id"
	ws      *websocket.Conn
}

// closeConn sends a close frame with a published code and drops the connection shortly after if the peer does not answer.
func (h *Hub) closeConn(c *liveConn, code int, reason string) {
	frame := websocket.FormatCloseMessage(code, reason)
	if err := c.ws.WriteControl(websocket.CloseMessage, frame, h.a.clock.Real().Add(closeGrace)); err != nil {
		log.Printf("send close frame: %v", err)
	}
	time.AfterFunc(closeGrace, func() { _ = c.ws.Close() })
}

func newHub(a *App) *Hub {
	return &Hub{a: a, conns: map[*liveConn]struct{}{}, countdowns: map[string]func(context.Context, string) (any, error){}}
}

// load resumes the sequence after a restart.
func (h *Hub) load(ctx context.Context) error {
	if err := h.a.db.QueryRow(ctx, `select coalesce(max(seq), 0) from live_log`).Scan(&h.seq); err != nil {
		return fmt.Errorf("read live sequence: %w", err)
	}
	return nil
}

// Seq is the latest sequence number handed out.
func (h *Hub) Seq() int64 {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.seq
}

// RegisterCountdown names a scope whose countdown the server sends every second to sockets watching an id.
func (h *Hub) RegisterCountdown(scope string, fn func(ctx context.Context, id string) (any, error)) {
	h.countdowns[scope] = fn
}

// Publish stores a replayable message and sends it to every open socket. The data is encoded once and shared by the
// stored copy and the sent one.
func (h *Hub) Publish(ctx context.Context, typ string, data any) {
	encodedData, err := json.Marshal(data)
	if err != nil {
		log.Printf("encode live message data: %v", err)
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.seq++
	at := h.a.clock.Now()
	encoded, err := json.Marshal(liveMessage{Seq: h.seq, Type: typ, At: formatInstant(at), Data: json.RawMessage(encodedData)})
	if err != nil {
		log.Printf("encode live message: %v", err)
		return
	}
	_, err = h.a.db.Exec(ctx, `insert into live_log (seq, type, at, data) values ($1, $2, $3, $4)`,
		h.seq, typ, at, json.RawMessage(encodedData))
	if err != nil {
		log.Printf("store live message: %v", err)
	}
	if h.inserts++; h.inserts%500 == 0 {
		if _, err := h.a.db.Exec(ctx, `delete from live_log where seq < $1`, h.seq-liveKeep); err != nil {
			log.Printf("prune live log: %v", err)
		}
	}
	h.sendLocked(encoded)
}

// Broadcast sends a message that is not replayed (clock and countdown).
func (h *Hub) Broadcast(typ string, data any) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.seq++
	encoded, err := json.Marshal(liveMessage{Seq: h.seq, Type: typ, At: formatInstant(h.a.clock.Now()), Data: data})
	if err != nil {
		log.Printf("encode live message: %v", err)
		return
	}
	h.sendLocked(encoded)
}

func (h *Hub) sendLocked(encoded []byte) {
	for c := range h.conns {
		h.enqueue(c, encoded)
	}
}

func (h *Hub) enqueue(c *liveConn, encoded []byte) {
	select {
	case c.out <- encoded:
	default:
		go h.closeConn(c, websocket.ClosePolicyViolation, "too slow")
	}
}

// CloseUser closes every socket of a person with a published code.
func (h *Hub) CloseUser(userID string, code int, reason string) {
	h.mu.Lock()
	var doomed []*liveConn
	for c := range h.conns {
		if c.userID == userID {
			doomed = append(doomed, c)
		}
	}
	h.mu.Unlock()
	for _, c := range doomed {
		go h.closeConn(c, code, reason)
	}
}

// Run sends the clock and every watched countdown once a second.
func (h *Hub) Run(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.Pulse(ctx)
		}
	}
}

// Pulse sends the clock and the countdowns now; the operator clock calls it after a move.
func (h *Hub) Pulse(ctx context.Context) {
	h.mu.Lock()
	watched := map[string]struct{}{}
	for c := range h.conns {
		for key := range c.watches {
			watched[key] = struct{}{}
		}
	}
	h.mu.Unlock()
	if len(watched) == 0 && !h.hasConns() {
		return
	}
	h.Broadcast("clock", h.a.clock.State())
	for key := range watched {
		scope, id := splitWatch(key)
		fn := h.countdowns[scope]
		if fn == nil {
			continue
		}
		data, err := fn(ctx, id)
		if err != nil || data == nil {
			continue
		}
		h.mu.Lock()
		h.seq++
		encoded, err := json.Marshal(liveMessage{Seq: h.seq, Type: "countdown", At: formatInstant(h.a.clock.Now()),
			Data: map[string]any{"scope": scope, "id": id, "countdown": data}})
		if err == nil {
			for c := range h.conns {
				if _, ok := c.watches[key]; ok {
					h.enqueue(c, encoded)
				}
			}
		}
		h.mu.Unlock()
	}
}

func (h *Hub) hasConns() bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.conns) > 0
}

func splitWatch(key string) (string, string) {
	for i := 0; i < len(key); i++ {
		if key[i] == ':' {
			return key[:i], key[i+1:]
		}
	}
	return key, ""
}

// hLive upgrades GET /api/live. A page opens exactly one socket, sends {"type":"hello"} once it is open, may then
// send {"type":"watch","scope":"incident","id":"..."} for a countdown, and reconnects with ?after=<last seq seen>.
func (a *App) hLive(rq *Req) error {
	var after int64
	replay := rq.Query("after") != ""
	if replay {
		if _, err := fmt.Sscan(rq.Query("after"), &after); err != nil {
			return errField("after", "Use the sequence number of the last message seen.")
		}
	}
	ws, err := upgrader.Upgrade(rq.W, rq.R, nil)
	if err != nil {
		return nil
	}
	defer ws.Close()
	conn := &liveConn{userID: rq.Actor.ID, out: make(chan []byte, 512), watches: map[string]struct{}{}, ws: ws}
	ctx, stop := context.WithCancel(rq.R.Context())
	defer stop()
	backlog, err := a.hub.attach(ctx, conn, after, replay)
	if err != nil {
		a.hub.closeConn(conn, websocket.CloseInternalServerErr, "replay failed")
		return nil
	}
	go a.hub.writeLoop(ctx, conn, backlog)
	a.hub.readLoop(conn)
	a.hub.detach(conn)
	return nil
}

// attach replays everything after a sequence number and registers the socket, with no gap between the two.
func (h *Hub) attach(ctx context.Context, c *liveConn, after int64, replay bool) ([][]byte, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	var backlog [][]byte
	if replay {
		rows, err := h.a.db.Query(ctx, `select seq, type, at, data from live_log where seq > $1 order by seq`, after)
		if err != nil {
			return nil, fmt.Errorf("read live log: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var m liveMessage
			var at time.Time
			var data json.RawMessage
			if err := rows.Scan(&m.Seq, &m.Type, &at, &data); err != nil {
				return nil, fmt.Errorf("scan live log: %w", err)
			}
			m.At, m.Data = formatInstant(at), data
			encoded, err := json.Marshal(m)
			if err != nil {
				return nil, fmt.Errorf("encode live log message %d: %w", m.Seq, err)
			}
			backlog = append(backlog, encoded)
		}
		if err := rows.Err(); err != nil {
			return nil, fmt.Errorf("read live log: %w", err)
		}
	}
	h.conns[c] = struct{}{}
	return backlog, nil
}

func (h *Hub) detach(c *liveConn) {
	h.mu.Lock()
	delete(h.conns, c)
	h.mu.Unlock()
}

// writeLoop is the only writer of text frames on a socket: the replay first, then live messages and pings.
func (h *Hub) writeLoop(ctx context.Context, c *liveConn, backlog [][]byte) {
	for _, encoded := range backlog {
		if err := c.ws.WriteMessage(websocket.TextMessage, encoded); err != nil {
			return
		}
	}
	ping := time.NewTicker(pingEvery)
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case encoded := <-c.out:
			if err := c.ws.WriteMessage(websocket.TextMessage, encoded); err != nil {
				return
			}
		case <-ping.C:
			if err := c.ws.WriteControl(websocket.PingMessage, nil, h.a.clock.Real().Add(closeGrace)); err != nil {
				return
			}
		}
	}
}

// readLoop reads the page's frames (hello, watch) until the socket closes; a pong keeps an idle page alive.
func (h *Hub) readLoop(c *liveConn) {
	extend := func() error {
		if err := c.ws.SetReadDeadline(h.a.clock.Real().Add(readIdle)); err != nil {
			return fmt.Errorf("set read deadline: %w", err)
		}
		return nil
	}
	c.ws.SetPongHandler(func(string) error {
		if err := extend(); err != nil {
			return fmt.Errorf("extend read deadline: %w", err)
		}
		return nil
	})
	if err := extend(); err != nil {
		return
	}
	for {
		_, data, err := c.ws.ReadMessage()
		if err != nil {
			return
		}
		if err := extend(); err != nil {
			return
		}
		var frame struct {
			Type  string `json:"type"`
			Scope string `json:"scope"`
			ID    string `json:"id"`
		}
		if json.Unmarshal(data, &frame) != nil || frame.Type != "watch" {
			continue
		}
		h.mu.Lock()
		c.watches[frame.Scope+":"+frame.ID] = struct{}{}
		h.mu.Unlock()
	}
}
