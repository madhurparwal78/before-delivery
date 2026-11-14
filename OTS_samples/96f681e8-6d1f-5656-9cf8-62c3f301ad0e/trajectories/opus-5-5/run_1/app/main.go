package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "time/tzdata"
)

type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type app struct {
	cfg      *config
	db       *pgxpool.Pool
	kc       *keycloak
	courtpay *courtpay
	ready    atomic.Bool
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	a := &app{cfg: cfg, kc: newKeycloak(cfg), courtpay: newCourtpay(cfg.WiremockURL)}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	srv := &http.Server{
		Addr:              net.JoinHostPort("0.0.0.0", cfg.Port),
		Handler:           a.routes(),
		ReadHeaderTimeout: 10 * time.Second,
		BaseContext:       func(net.Listener) context.Context { return ctx },
	}
	go a.boot(ctx)
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdown); err != nil {
			log.Printf("shutdown: %v", err)
		}
	}()
	log.Printf("yardline listening on %s", srv.Addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("listen: %v", err)
	}
}

// boot reaches PostgreSQL and Keycloak, retrying every 2 seconds, then starts the workers.
func (a *app) boot(ctx context.Context) {
	for {
		if err := a.connectDatabase(ctx); err != nil {
			log.Printf("database not ready: %v", err)
		} else {
			break
		}
		if !sleepCtx(ctx, 2*time.Second) {
			return
		}
	}
	for {
		if err := a.kc.bootstrap(ctx, a.db); err != nil {
			log.Printf("keycloak not ready: %v", err)
		} else {
			break
		}
		if !sleepCtx(ctx, 2*time.Second) {
			return
		}
	}
	a.ready.Store(true)
	log.Printf("yardline ready")
	go a.runWorkers(ctx)
}

func (a *app) connectDatabase(ctx context.Context) error {
	if a.db == nil {
		pool, err := pgxpool.New(ctx, a.cfg.DatabaseURL)
		if err != nil {
			return fmt.Errorf("open pool: %w", err)
		}
		a.db = pool
	}
	if err := a.db.Ping(ctx); err != nil {
		return fmt.Errorf("ping: %w", err)
	}
	if err := a.migrate(ctx); err != nil {
		return err
	}
	return a.seed(ctx)
}

func sleepCtx(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}

func (a *app) inTx(ctx context.Context, fn func(pgx.Tx) error) error {
	return pgx.BeginFunc(ctx, a.db, fn)
}
