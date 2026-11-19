package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

func main() {
	if studioLocErr != nil {
		log.Fatalf("zone data: %v", studioLocErr)
	}
	if distErr != nil {
		log.Fatalf("frontend: %v", distErr)
	}
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	cfg := loadConfig()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	clock := &wallClock{}
	st, err := openStore(cfg.databaseURL, clock)
	if err != nil {
		return err
	}
	deps := &dependencies{}
	reg := &registry{deps: deps, instance: newID("i_")}
	if cfg.valkeyURL != "" {
		if reg.client, err = newValkeyClient(cfg.valkeyURL); err != nil {
			return err
		}
	}
	srv := &server{cfg: cfg, clock: clock, store: st, reg: reg, deps: deps, persist: newPersister(), sessions: map[string]player{}}
	srv.hub = newHub(srv)
	srv.mail = &mailer{cfg: cfg, store: st, deps: deps, clock: clock}
	deps.mail.Store(srv.mail.probe())

	var background sync.WaitGroup
	start := func(fn func(context.Context)) {
		background.Add(1)
		go func() {
			defer background.Done()
			fn(ctx)
		}()
	}
	start(srv.watchStorage)
	start(srv.persist.run)
	start(srv.hub.run)
	start(srv.mail.run)
	start(reg.probe)

	httpServer := &http.Server{Addr: "0.0.0.0:" + cfg.port, Handler: srv.routes(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(shutdown); err != nil {
			log.Printf("shutdown: %v", err)
		}
	}()
	log.Printf("holdfast listening on %s", httpServer.Addr)
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	stop()
	background.Wait()
	return nil
}

// watchStorage probes Postgres every two seconds, migrates once it answers and keeps the
// shop price cache fresh.
func (s *server) watchStorage(ctx context.Context) {
	migrated := false
	lastProblem := ""
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		probe, cancel := context.WithTimeout(ctx, 2500*time.Millisecond)
		err := s.store.ping(probe)
		cancel()
		s.deps.postgres.Store(err == nil)
		if err != nil && err.Error() != lastProblem {
			log.Printf("postgres: %v", err)
		}
		lastProblem = ""
		if err != nil {
			lastProblem = err.Error()
		}
		if err == nil && !migrated {
			migrateCtx, cancelMigrate := context.WithTimeout(ctx, 30*time.Second)
			if err := s.store.migrate(migrateCtx); err != nil {
				log.Printf("migrate: %v", err)
			} else {
				migrated = true
			}
			cancelMigrate()
		}
		if err == nil && migrated {
			s.refreshPrices()
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}
