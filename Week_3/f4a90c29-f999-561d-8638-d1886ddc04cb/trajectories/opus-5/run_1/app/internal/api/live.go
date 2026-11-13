package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/coder/websocket"

	"sundialwren/internal/store"
)

// handleLive is the one connection a page opens. It first sends every change
// after the sequence number it asks for, then every change as it commits.
func (s *Server) handleLive(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil || cookie.Value == "" {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Sign in to use Wren.", nil)
		return
	}
	person, err := s.Store.SessionPerson(r.Context(), cookie.Value)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Sign in to use Wren.", nil)
		return
	}
	// A page that names no sequence number has just read the whole state, so
	// it starts from the head; a reconnect names its last one and catches up.
	after, err := s.Store.LatestSeq(r.Context())
	if err != nil {
		s.fail(w, err)
		return
	}
	if raw := r.URL.Query().Get("after"); raw != "" {
		if parsed, parseErr := strconv.ParseInt(raw, 10, 64); parseErr == nil {
			after = parsed
		}
	}
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: false})
	if err != nil {
		return
	}
	defer conn.CloseNow()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		for {
			if _, _, err := conn.Read(ctx); err != nil {
				cancel()
				return
			}
		}
	}()

	subscriber := s.Hub.Subscribe(person.ID)
	defer s.Hub.Unsubscribe(subscriber)

	missed, err := s.Store.ChangesAfter(ctx, after)
	if err != nil {
		return
	}
	sent := after
	for _, change := range missed {
		if !s.send(ctx, conn, person.ID, change) {
			return
		}
		sent = change.Seq
	}
	for {
		select {
		case <-ctx.Done():
			return
		case change, ok := <-subscriber.Changes:
			if !ok {
				return
			}
			if change.Seq <= sent {
				continue
			}
			if !s.send(ctx, conn, person.ID, change) {
				return
			}
			sent = change.Seq
		case <-time.After(25 * time.Second):
			if err := conn.Ping(ctx); err != nil {
				return
			}
		}
	}
}

// send projects one change for this person and writes it, or passes over a
// change they may not see.
func (s *Server) send(ctx context.Context, conn *websocket.Conn, personID string, change store.Change) bool {
	person, err := s.Store.Person(ctx, personID)
	if err != nil {
		return false
	}
	c, err := s.contextFor(ctx, person)
	if err != nil {
		return false
	}
	data, ok := s.projectChange(ctx, change, c)
	if !ok {
		return true
	}
	payload, err := json.Marshal(map[string]any{"seq": change.Seq, "type": change.Type, "data": data})
	if err != nil {
		return true
	}
	writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return conn.Write(writeCtx, websocket.MessageText, payload) == nil
}
