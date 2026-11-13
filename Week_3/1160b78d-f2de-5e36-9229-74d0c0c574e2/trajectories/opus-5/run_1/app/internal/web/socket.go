package web

import (
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gorilla/websocket"

	"switchlamp/internal/live"
)

func (s *Server) socket(w http.ResponseWriter, r *http.Request) {
	actor, _, authErr := s.actorFor(r)
	if authErr != nil {
		writeJSON(w, authErr.Status, authErr.Body)
		return
	}
	if actor == nil {
		writeJSON(w, 401, map[string]any{"error": "unauthenticated"})
		return
	}
	// A stakeholder may not open the socket.
	if err := checkAccess(*actor, accessReader); err != nil {
		writeAPIError(w, err)
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" && !sameOrigin(origin, r) {
		writeJSON(w, 403, map[string]any{"error": "cross_origin"})
		return
	}
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			return origin == "" || sameOrigin(origin, r)
		},
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	userID := ""
	if actor.User != nil {
		userID = actor.User.ID
	}
	client := live.NewClient(userID)
	s.app.Hub.Add(client)
	defer s.app.Hub.Remove(client)

	if after := r.URL.Query().Get("after"); after != "" {
		if seq, err := strconv.ParseInt(after, 10, 64); err == nil {
			missed, err := s.app.Replay(r.Context(), seq)
			if err == nil {
				for _, message := range missed {
					client.Send(message)
				}
			}
		}
	}

	go func() {
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				s.app.Hub.Remove(client)
				return
			}
		}
	}()

	for {
		select {
		case frame := <-client.Out():
			if err := conn.SetWriteDeadline(time.Now().Add(10 * time.Second)); err != nil {
				return
			}
			if err := conn.WriteMessage(websocket.TextMessage, frame); err != nil {
				return
			}
		case <-client.Closed():
			code := client.CloseCode()
			message := websocket.FormatCloseMessage(code, "")
			if err := conn.WriteControl(websocket.CloseMessage, message, time.Now().Add(time.Second)); err != nil {
				log.Printf("close socket: %v", err)
			}
			_ = conn.Close()
			return
		}
	}
}
