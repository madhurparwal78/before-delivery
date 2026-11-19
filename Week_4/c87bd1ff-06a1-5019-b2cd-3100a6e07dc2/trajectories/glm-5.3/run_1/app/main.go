// Gavelhouse is the online saleroom of Harrow & Gilt Auctioneers.
package main

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"gavelhouse/internal/authn"
	"gavelhouse/internal/cfg"
	"gavelhouse/internal/httpapi"
	"gavelhouse/internal/keycloak"
	"gavelhouse/internal/live"
	"gavelhouse/internal/postgres"
	"gavelhouse/internal/seed"
	"gavelhouse/internal/store"
	"gavelhouse/internal/timing"
)

func main() {
	config, err := cfg.Load()
	if err != nil {
		log.Fatalf("gavelhouse: %v", err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db, err := postgres.Open(config.DatabaseURL)
	if err != nil {
		log.Fatalf("gavelhouse: %v", err)
	}
	// PostgreSQL is required before anything is served.
	if err := db.WaitReady(ctx); err != nil {
		log.Fatalf("gavelhouse: %v", err)
	}

	kc := keycloak.New(config.KeycloakURL, config.KeycloakRealm, config.AuthIssuerURL, config.AuthClientID, config.AuthClientSecret)
	seed.EnsureKeycloak(ctx, kc)

	shop := store.New(store.Config{
		LotGap:      config.LotGap,
		SoftClose:   config.SoftClose,
		PaymentDue:  config.PaymentDue,
		OfferWindow: config.OfferWindow,
		WatchNotice: config.WatchNotice,
	}, db)
	shop.SetKeycloakCheck(kc.Healthy)
	shop.SetRealmRoleAdder(func(sub, role string) error {
		return kc.AddRealmRole(sub, role)
	})

	if err := seed.Apply(ctx, db.Pool(), kc, config.LotGap); err != nil {
		log.Fatalf("gavelhouse: %v", err)
	}

	secure := strings.HasPrefix(config.PublicURL, "https://")
	auth := authn.New(kc, shop, config.PublicURL, secure)

	hub := live.NewHub(nil)
	live.SessionTokenOf = authn.SessionToken
	api := httpapi.New(httpapi.Config{PublicURL: config.PublicURL}, shop, auth, hub)
	hub.SetFeed(api.Feed())

	worker := timing.New(shop, hub)
	go worker.Run(ctx)

	// The latest sequence drives hub delivery between requests.
	go pollSeq(ctx, shop, hub)

	handler := api.Handler()
	addr := net.JoinHostPort("0.0.0.0", config.PublicPort)
	srv := &http.Server{Addr: addr, Handler: handler}
	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("gavelhouse: serving: %v", err)
		}
	}()
	log.Printf("gavelhouse: serving on %s", addr)
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(shutdownCtx)
}

// pollSeq keeps this process's hub aware of other processes' commits.
func pollSeq(ctx context.Context, shop *store.Store, hub *live.Hub) {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			var latest int64
			err := shop.WithTx(ctx, func(ctx context.Context, tx store.Tx) error {
				var err error
				latest, err = tx.LatestSeq(ctx)
				return err
			})
			if err == nil {
				hub.Advance(latest)
			}
		}
	}
}
