package api

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/marlowquill/interline-desk/internal/store"
)

// owned holds the event ids this instance queued, because events are sent by
// the instance that queued them.
type owned struct {
	mu  sync.Mutex
	ids map[string]bool
}

func (o *owned) add(id string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.ids == nil {
		o.ids = map[string]bool{}
	}
	o.ids[id] = true
}

func (o *owned) holds(id string) bool {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.ids[id]
}

var ourEvents = &owned{}

func (s *Server) notifyEventQueued(eventID string) {
	ourEvents.add(eventID)
	select {
	case s.eventQueued <- eventID:
	default:
	}
}

// StartWorkers runs the background work of this instance: webhook delivery,
// audit retention and retried Svix application deletions.
func (s *Server) StartWorkers(ctx context.Context) {
	pending, err := s.store.PendingEvents(ctx)
	if err != nil {
		log.Printf("adopt pending events: %v", err)
	}
	for _, event := range pending {
		ourEvents.add(event.EventID)
	}

	go s.deliverEvents(ctx)
	go s.pruneAudit(ctx)
	go s.retryAppDeletions(ctx)
}

func (s *Server) deliverEvents(ctx context.Context) {
	ticker := time.NewTicker(s.cfg.WebhookRetry)
	defer ticker.Stop()
	s.sendPendingEvents(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.eventQueued:
			s.sendPendingEvents(ctx)
		case <-ticker.C:
			s.sendPendingEvents(ctx)
		}
	}
}

func (s *Server) sendPendingEvents(ctx context.Context) {
	pending, err := s.store.PendingEvents(ctx)
	if err != nil {
		log.Printf("list pending events: %v", err)
		return
	}
	for _, event := range pending {
		if !ourEvents.holds(event.EventID) {
			continue
		}
		if err := s.store.CountEventAttempt(ctx, event.EventID); err != nil {
			log.Printf("count event attempt: %v", err)
			continue
		}
		sendCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		err := s.webhooks.SendMessage(sendCtx, event.AppUID, event.Type, event.EventID, event.Payload)
		cancel()
		if err != nil {
			s.prober.Invalidate()
			continue
		}
		if err := s.store.MarkEventSent(ctx, event.EventID, store.Now()); err != nil {
			log.Printf("mark event sent: %v", err)
		}
	}
}

func (s *Server) pruneAudit(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		if err := s.store.PruneAudit(ctx, s.cfg.AuditRetention); err != nil {
			log.Printf("prune audit entries: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Server) retryAppDeletions(ctx context.Context) {
	ticker := time.NewTicker(s.cfg.WebhookRetry)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		uids, err := s.store.PendingAppDeletions(ctx)
		if err != nil {
			log.Printf("list application deletions: %v", err)
			continue
		}
		for _, uid := range uids {
			callCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := s.webhooks.DeleteApplication(callCtx, uid)
			cancel()
			if err != nil {
				continue
			}
			if err := s.store.ClearAppDeletion(ctx, uid); err != nil {
				log.Printf("clear application deletion: %v", err)
			}
		}
	}
}
