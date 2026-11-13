// Command interline-desk serves the Interline Desk API and browser app.
package main

import (
	"context"
	"embed"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"os/signal"
	"strconv"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/marlowquill/interline-desk/internal/api"
	"github.com/marlowquill/interline-desk/internal/config"
	"github.com/marlowquill/interline-desk/internal/s3lite"
	"github.com/marlowquill/interline-desk/internal/store"
)

//go:embed all:dist
var assets embed.FS

func main() {
	log.SetFlags(log.LstdFlags | log.LUTC)
	if err := run(); err != nil {
		log.Fatalf("interline desk: %v", err)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	built, err := fs.Sub(assets, "dist")
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	st, err := store.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer st.Pool.Close()

	var ready atomic.Bool
	server := api.New(cfg, st, built, ready.Load)

	go prepare(ctx, cfg, st, &ready, server)

	httpServer := &http.Server{
		Addr:              "0.0.0.0:" + strconv.Itoa(cfg.Port),
		Handler:           server.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(shutdownCtx); err != nil {
			log.Printf("shut down: %v", err)
		}
	}()

	log.Printf("interline desk listening on %s", httpServer.Addr)
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// prepare applies the schema and writes the seed, retrying while Postgres is
// unreachable. The server serves pages throughout.
func prepare(ctx context.Context, cfg *config.Config, st *store.Store, ready *atomic.Bool, server *api.Server) {
	for {
		if err := st.Ping(ctx); err != nil {
			log.Printf("waiting for Postgres: %v", err)
		} else if err := st.Migrate(ctx); err != nil {
			log.Printf("applying schema: %v", err)
		} else if err := st.Seed(ctx); err != nil {
			log.Printf("writing seed: %v", err)
		} else {
			ready.Store(true)
			break
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}

	objects := s3lite.New(cfg.S3Endpoint, cfg.S3Region, cfg.S3Bucket, cfg.S3PathStyle,
		cfg.S3AccessKeyID, cfg.S3SecretKey)
	bucketCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := objects.EnsureBucket(bucketCtx); err != nil {
		log.Printf("file storage is not answering yet: %v", err)
	}
	server.StartWorkers(ctx)
}
