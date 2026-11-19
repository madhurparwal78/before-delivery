package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"gavelhouse/internal/saleroom"
)

// Hub holds every open live socket and delivers each committed change to the
// sockets that can see it, in the viewer's projection.
type Hub struct {
	room    *saleroom.Saleroom
	mu      sync.Mutex
	sockets map[*socket]struct{}
}

type socket struct {
	viewer    saleroom.Viewer
	sessionID string
	conn      *websocket.Conn
	hints     chan int64
	closeOnce sync.Once
	done      chan struct{}
	cursor    int64
}

func newHub(room *saleroom.Saleroom) *Hub {
	return &Hub{room: room, sockets: map[*socket]struct{}{}}
}

// Run delivers each committed change to the open sockets and closes the
// sockets of any session that has signed out.
func (h *Hub) Run(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case seq := <-h.room.Changes:
			for _, s := range h.snapshot() {
				select {
				case s.hints <- seq:
				default:
				}
			}
		case <-ticker.C:
			h.closeEndedSessions(ctx)
		}
	}
}

func (h *Hub) snapshot() []*socket {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]*socket, 0, len(h.sockets))
	for s := range h.sockets {
		out = append(out, s)
	}
	return out
}

func (h *Hub) add(s *socket) {
	h.mu.Lock()
	h.sockets[s] = struct{}{}
	h.mu.Unlock()
}

func (h *Hub) remove(s *socket) {
	h.mu.Lock()
	delete(h.sockets, s)
	h.mu.Unlock()
}

// closeSession shuts every socket a signed-out session opened, so no open tab
// goes on receiving that person's notices or their own maximum.
func (h *Hub) closeSession(sessionID string) {
	for _, s := range h.snapshot() {
		if s.sessionID == sessionID {
			s.close()
		}
	}
}

func (h *Hub) closeEndedSessions(ctx context.Context) {
	for _, s := range h.snapshot() {
		if s.sessionID == "" {
			continue
		}
		v, err := h.room.SessionViewer(ctx, s.sessionID)
		if err == nil && !v.SignedIn {
			s.close()
		}
	}
}

func (s *socket) close() {
	s.closeOnce.Do(func() {
		close(s.done)
		_ = s.conn.Close()
	})
}

var upgrader = websocket.Upgrader{
	HandshakeTimeout: 5 * time.Second,
	// The boundary has already refused any Origin that is not the saleroom's.
	CheckOrigin: func(*http.Request) bool { return true },
}

func (s *Server) handleLive(w http.ResponseWriter, r *http.Request) {
	v, sessionID, err := s.viewerOf(r)
	if err != nil {
		fail(w, err)
		return
	}
	cursor, err := s.room.LatestSeq(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	if since := r.URL.Query().Get("since"); since != "" {
		if n, convErr := strconv.ParseInt(since, 10, 64); convErr == nil && n >= 0 {
			cursor = n
		}
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	sock := &socket{
		viewer:    v,
		sessionID: sessionID,
		conn:      conn,
		hints:     make(chan int64, 64),
		done:      make(chan struct{}),
		cursor:    cursor,
	}
	s.hub.add(sock)
	go sock.drainReads()
	go s.pump(sock)
}

// drainReads keeps the connection's control frames flowing. The browser sends
// nothing over the socket.
func (s *socket) drainReads() {
	for {
		if _, _, err := s.conn.ReadMessage(); err != nil {
			s.close()
			return
		}
	}
}

// pump delivers every visible event above the socket's cursor, in order and
// once each, then follows the live feed.
func (s *Server) pump(sock *socket) {
	defer func() {
		s.hub.remove(sock)
		sock.close()
	}()
	ctx := context.Background()
	if err := s.deliver(ctx, sock); err != nil {
		return
	}
	heartbeat := time.NewTicker(25 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-sock.done:
			return
		case <-sock.hints:
			if err := s.deliver(ctx, sock); err != nil {
				return
			}
		case <-heartbeat.C:
			deadline := time.Now().Add(5 * time.Second)
			if err := sock.conn.WriteControl(websocket.PingMessage, nil, deadline); err != nil {
				return
			}
		}
	}
}

func (s *Server) deliver(ctx context.Context, sock *socket) error {
	for {
		events, err := s.room.EventsSince(ctx, sock.cursor, 500)
		if err != nil {
			return err
		}
		if len(events) == 0 {
			return nil
		}
		for _, e := range events {
			frame, send := s.frameFor(ctx, sock.viewer, e)
			sock.cursor = e.Seq
			if !send {
				continue
			}
			raw, err := json.Marshal(frame)
			if err != nil {
				log.Printf("httpapi: encode socket frame: %v", err)
				continue
			}
			deadline := time.Now().Add(5 * time.Second)
			if err := sock.conn.SetWriteDeadline(deadline); err != nil {
				return err
			}
			if err := sock.conn.WriteMessage(websocket.TextMessage, raw); err != nil {
				return err
			}
		}
	}
}

// frameFor projects one change-feed event for one socket. A notice goes only
// to its recipient, and a watch frame only to the bidder who watched the lot.
func (s *Server) frameFor(ctx context.Context, v saleroom.Viewer, e saleroom.Event) (map[string]any, bool) {
	switch e.Type {
	case saleroom.EventNotice:
		if !v.SignedIn || v.PersonID != e.PersonID {
			return nil, false
		}
		notice, err := s.room.Notice(ctx, e.NoticeID)
		if err != nil {
			return nil, false
		}
		return map[string]any{"seq": e.Seq, "type": saleroom.EventNotice, "notice": notice}, true
	case saleroom.EventLotChanged:
		if e.Cause == saleroom.CauseWatch && (!v.SignedIn || v.PersonID != e.PersonID) {
			return nil, false
		}
		lot, history, err := s.room.LotFrame(ctx, v, e.LotID)
		if err != nil {
			if !errors.Is(err, saleroom.ErrNotFound) {
				log.Printf("httpapi: project lot frame: %v", err)
			}
			return nil, false
		}
		return map[string]any{
			"seq":     e.Seq,
			"type":    saleroom.EventLotChanged,
			"cause":   e.Cause,
			"lot":     lot,
			"history": history,
		}, true
	}
	return nil, false
}
