package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "time/tzdata" // zone rules travel with the binary
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := run(ctx); err != nil {
		log.Printf("switchlamp: %v", err)
		os.Exit(1)
	}
}

func run(ctx context.Context) error {
	cfg := loadConfig()
	a := &App{cfg: cfg, mux: http.NewServeMux()}
	a.hub = newHub(a)
	cache, err := newCache(cfg.ValkeyURL)
	if err != nil {
		return fmt.Errorf("configure valkey: %w", err)
	}
	a.cache = cache
	for _, setup := range routeSetups {
		setup(a)
	}
	a.registerPages()

	server := &http.Server{Addr: "0.0.0.0:" + cfg.Port, Handler: a.mux, ReadHeaderTimeout: 10 * time.Second}
	serveErr := make(chan error, 1)
	go func() { serveErr <- server.ListenAndServe() }()
	go a.boot(ctx)

	select {
	case err := <-serveErr:
		return fmt.Errorf("serve: %w", err)
	case <-ctx.Done():
		// ctx has already ended; the shutdown gets its own five seconds to finish the requests in flight.
		shutdown, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdown); err != nil && !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("shutdown: %w", err)
		}
		return nil
	}
}

// boot connects to Postgres (retrying every five seconds), prepares the record and starts the workers. Until it is
// done every route answers 503 {"status":"starting"}.
func (a *App) boot(ctx context.Context) {
	pool, err := connectDatabase(ctx, a.cfg.DatabaseURL)
	if err != nil {
		log.Printf("boot: %v", err)
		return
	}
	a.db = pool
	a.clock = newClock(pool)
	steps := []struct {
		name string
		run  func(context.Context) error
	}{
		{"migrate schema", func(c context.Context) error {
			if err := migrate(c, pool); err != nil {
				return fmt.Errorf("migrate schema: %w", err)
			}
			return nil
		}},
		{"load clock", a.clock.load},
		{"resume live sequence", a.hub.load},
		{"seed", a.runSeeders},
	}
	for _, step := range steps {
		if err := step.run(ctx); err != nil {
			log.Printf("boot: %s: %v", step.name, err)
			os.Exit(1)
		}
	}
	a.cache.ping(ctx)
	go a.cache.Watch(ctx)
	go a.runTicker(ctx)
	go a.hub.Run(ctx)
	for _, start := range workerSetups {
		start(a, ctx)
	}
	a.ready.Store(true)
	log.Printf("switchlamp ready on :%s (instance %s)", a.cfg.Port, a.cfg.Instance)
}
