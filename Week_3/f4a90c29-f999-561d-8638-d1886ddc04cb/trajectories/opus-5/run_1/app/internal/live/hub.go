// Package live fans every committed change out to the open screens allowed to
// see it.
package live

import (
	"sync"

	"sundialwren/internal/store"
)

// Subscriber is one open connection's queue of changes.
type Subscriber struct {
	PersonID string
	Changes  chan store.Change
}

type Hub struct {
	mu   sync.Mutex
	subs map[*Subscriber]struct{}
}

func NewHub() *Hub {
	return &Hub{subs: map[*Subscriber]struct{}{}}
}

func (h *Hub) Subscribe(personID string) *Subscriber {
	s := &Subscriber{PersonID: personID, Changes: make(chan store.Change, 256)}
	h.mu.Lock()
	h.subs[s] = struct{}{}
	h.mu.Unlock()
	return s
}

func (h *Hub) Unsubscribe(s *Subscriber) {
	h.mu.Lock()
	delete(h.subs, s)
	h.mu.Unlock()
	close(s.Changes)
}

// Publish hands a committed change to every open connection. A connection
// whose queue is full catches up from the change log on its next reconnect.
func (h *Hub) Publish(c store.Change) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for s := range h.subs {
		select {
		case s.Changes <- c:
		default:
		}
	}
}
