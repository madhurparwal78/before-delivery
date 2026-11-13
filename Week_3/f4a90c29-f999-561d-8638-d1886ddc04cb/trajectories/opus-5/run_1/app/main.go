// Command server runs Wren Calendar: the API, the live connection and the
// built front end, from one Go binary.
package main

import (
	"context"
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"sundialwren/internal/api"
	"sundialwren/internal/clock"
	"sundialwren/internal/config"
	"sundialwren/internal/live"
	"sundialwren/internal/objstore"
	"sundialwren/internal/printer"
	"sundialwren/internal/store"
)

//go:embed all:web/dist
var assets embed.FS

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("wren: %v", err)
	}
	dist, err := fs.Sub(assets, "web/dist")
	if err != nil {
		log.Fatalf("wren: %v", err)
	}
	api.Assets = dist

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	st, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("wren: %v", err)
	}
	defer st.Close()

	server := api.New(st, clock.New(cfg.ClockStart, cfg.ClockStartSet, cfg.ClockRate), live.NewHub(),
		objstore.New(cfg.S3Endpoint, cfg.S3Region, cfg.S3Bucket, cfg.S3AccessKeyID, cfg.S3SecretAccessKey, cfg.S3ForcePathStyle),
		printer.New(cfg.GotenbergURL), cfg)

	// Postgres down at boot does not stop the app: it keeps answering the
	// starting health check, retries every second, and applies the schema and
	// seed once connected.
	go func() {
		for ctx.Err() == nil {
			if err := st.Ping(ctx); err == nil {
				if err := st.ApplySchema(ctx); err != nil {
					log.Printf("wren: %v", err)
				} else if err := st.Seed(ctx); err != nil {
					log.Printf("wren: %v", err)
				} else {
					go server.RunReminders(ctx)
					go server.RunSweeps(ctx)
					go server.RunPrintRecovery(ctx)
					return
				}
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Second):
			}
		}
	}()

	httpServer := &http.Server{
		Addr:              "0.0.0.0:" + cfg.Port,
		Handler:           server,
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdown)
	}()
	log.Printf("wren: listening on %s", httpServer.Addr)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("wren: %v", err)
	}
}
