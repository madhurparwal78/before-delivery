// Command gavelhouse serves the online saleroom of Harrow & Gilt Auctioneers.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"gavelhouse/internal/config"
	"gavelhouse/internal/httpapi"
	"gavelhouse/internal/keycloak"
	"gavelhouse/internal/saleroom"
)

// timedEventInterval keeps every timed event inside one second of its due
// moment.
const timedEventInterval = 250 * time.Millisecond

func main() {
	log.SetFlags(log.LstdFlags | log.LUTC)
	if err := run(); err != nil {
		log.Fatalf("gavelhouse: %v", err)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("read configuration: %w", err)
	}

	// The server does not listen until PostgreSQL is ready.
	room, err := saleroom.Open(ctx, cfg)
	if err != nil {
		return err
	}
	defer room.Close()

	realm := keycloak.New(cfg)
	go ensureRealm(ctx, realm)

	server := httpapi.New(cfg, room, realm)
	go server.Hub().Run(ctx)
	go runTimedEvents(ctx, room)

	address := net.JoinHostPort("0.0.0.0", fmt.Sprint(cfg.PublicPort))
	httpServer := &http.Server{
		Addr:              address,
		Handler:           server.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdownCtx)
	}()
	log.Printf("gavelhouse: serving the saleroom on %s", address)
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("serve the saleroom: %w", err)
	}
	return nil
}

// ensureRealm makes sure the realm roles and the seed users exist. If
// Keycloak is unreachable at start, the saleroom serves anyway and retries
// every ten seconds.
func ensureRealm(ctx context.Context, realm *keycloak.Client) {
	for ctx.Err() == nil {
		err := realm.EnsureRealm(ctx, httpapi.RealmSeedUsers())
		if err == nil {
			log.Print("gavelhouse: realm roles and seed users are in place")
			return
		}
		log.Printf("gavelhouse: waiting for Keycloak: %v", err)
		select {
		case <-ctx.Done():
			return
		case <-time.After(10 * time.Second):
		}
	}
}

func runTimedEvents(ctx context.Context, room *saleroom.Saleroom) {
	ticker := time.NewTicker(timedEventInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := room.RunTimedEvents(ctx); err != nil && ctx.Err() == nil {
				log.Printf("gavelhouse: carry out timed events: %v", err)
			}
		}
	}
}
