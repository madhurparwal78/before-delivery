// Command switchlamp serves the on-call and incident desk.
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"switchlamp/internal/broker"
	"switchlamp/internal/cache"
	"switchlamp/internal/clock"
	"switchlamp/internal/config"
	"switchlamp/internal/db"
	"switchlamp/internal/seed"
	"switchlamp/internal/serve"
	"switchlamp/internal/store"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("reading configuration: %v", err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Postgres is the system of record; boot keeps retrying until it answers.
	st, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("connecting to Postgres: %v", err)
	}
	if err := st.Migrate(ctx); err != nil {
		log.Fatalf("applying schema: %v", err)
	}
	storeObj := store.New(st.Pool)
	if err := seed.Load(ctx, st.Pool); err != nil {
		log.Fatalf("loading seed data: %v", err)
	}

	// Valkey, RabbitMQ, mail and the receiver are allowed to be unreachable at
	// boot: the app starts, answers health and recovers when they return.
	valkey, err := cache.New(cfg.ValkeyURL, cfg.Instance)
	if err != nil {
		log.Printf("parsing VALKEY_URL: %v", err)
	}
	clk, err := clock.New(ctx, st)
	if err != nil {
		log.Fatalf("loading the server clock: %v", err)
	}

	br := broker.New(cfg.AMQPURL, cfg.Instance)
	go func() {
		for {
			if err := br.Connect(); err == nil {
				log.Printf("connected to the broker")
				return
			} else {
				log.Printf("broker connect: %v", err)
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(5 * time.Second):
			}
		}
	}()

	srv := serve.New(serve.Options{
		Cfg: cfg, Store: storeObj, Clock: clk, Cache: valkey, Broker: br,
	})
	if err := srv.LoadSeq(ctx); err != nil {
		log.Printf("resuming the live sequence: %v", err)
	}
	// The one process runs intake, workers and timers itself.
	srv.ConsumeEventsFrom(br)
	srv.Start(ctx)

	addr := fmt.Sprintf("0.0.0.0:%s", cfg.Port)
	httpSrv := &http.Server{Addr: addr, Handler: srv.Handler()}
	go func() {
		log.Printf("Switchlamp listening on %s", addr)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("serving: %v", err)
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	httpSrv.Shutdown(shutdownCtx)
	fmt.Println("Switchlamp stopped")
}
