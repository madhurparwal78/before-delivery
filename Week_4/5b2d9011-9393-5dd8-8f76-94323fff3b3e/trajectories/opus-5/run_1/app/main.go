// Command holdfast serves Holdfast Nights: the browser game, the night calendar
// and the API that referees every rule.
package main

import (
	"context"
	"embed"
	"errors"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/cinderlatch/holdfast/internal/api"
	"github.com/cinderlatch/holdfast/internal/clockx"
	"github.com/cinderlatch/holdfast/internal/config"
	"github.com/cinderlatch/holdfast/internal/mailer"
	"github.com/cinderlatch/holdfast/internal/pricing"
	"github.com/cinderlatch/holdfast/internal/registry"
	"github.com/cinderlatch/holdfast/internal/sim"
	"github.com/cinderlatch/holdfast/internal/store"
)

//go:embed all:web/dist
var builtFrontend embed.FS

// probeInterval is how often each dependency is checked, so /api/status follows a
// change well inside five seconds.
const probeInterval = 2 * time.Second

func main() {
	if err := run(); err != nil {
		log.Fatalf("holdfast: %v", err)
	}
}

func run() error {
	cfg := config.Load()

	zone, err := clockx.LoadZone(store.StudioZone)
	if err != nil {
		return err
	}
	clock := clockx.New(zone)

	assets, err := fs.Sub(builtFrontend, "web/dist")
	if err != nil {
		return err
	}

	db, err := store.New(cfg.DatabaseURL, zone)
	if err != nil {
		return err
	}
	defer db.Close()

	reg, err := registry.New(cfg.ValkeyURL)
	if err != nil {
		return err
	}
	defer reg.Close()

	post, err := mailer.New(cfg.SMTPHost, cfg.SMTPPort, cfg.MailFrom)
	if err != nil {
		return err
	}

	prices := pricing.NewCache(db)
	outbox := mailer.NewOutbox(db, post, clock)
	rooms := sim.NewManager(clock, prices, reg, db)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// A dependency that is down at boot does not stop the app: it is probed until
	// it answers, and recovery needs no restart.
	go probeDependencies(ctx, db, reg, post, prices)
	go outbox.Run(ctx, zone)
	go rooms.Run(ctx)

	server := api.New(api.Deps{
		Config: cfg, Clock: clock, Store: db, Registry: reg,
		Mail: post, Outbox: outbox, Prices: prices, Rooms: rooms,
		Zone: zone, Assets: assets,
	})

	address := net.JoinHostPort("0.0.0.0", strconv.Itoa(cfg.Port))
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

	log.Printf("holdfast listening on %s", address)
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// probeDependencies keeps each service's up or down state truthful, applies the
// schema and seeds once Postgres answers, and clears stale registry keys at boot.
func probeDependencies(ctx context.Context, db *store.Store, reg *registry.Registry, post *mailer.Mailer, prices *pricing.Cache) {
	registryCleared := false
	ticker := time.NewTicker(probeInterval)
	defer ticker.Stop()

	for {
		db.Probe(ctx)
		reg.Probe(ctx)
		post.Probe()

		if db.Up() {
			if err := prices.Refresh(ctx); err != nil {
				log.Printf("holdfast: price schedule refresh: %v", err)
			}
		}
		if reg.Up() && !registryCleared {
			if err := reg.ClearStale(ctx); err == nil {
				registryCleared = true
			}
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
