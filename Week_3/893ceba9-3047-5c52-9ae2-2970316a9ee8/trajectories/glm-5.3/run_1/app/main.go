package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"time"

	_ "github.com/lib/pq"
)

func main() {
	cfg, err := LoadConfig()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	// the server starts and serves pages even when Postgres is unreachable at
	// boot; it retries every 2 seconds and health reports starting.
	var db *sql.DB
	for {
		db, err = sql.Open("postgres", cfg.DatabaseURL)
		if err == nil {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			err = db.PingContext(ctx)
			cancel()
		}
		if err == nil {
			break
		}
		log.Printf("postgres not reachable: %v; retrying", err)
		time.Sleep(2 * time.Second)
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)

	srv := NewServer(cfg, db)

	// apply the schema idempotently, then seed exactly once
	go func() {
		for {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			if err := ApplySchema(ctx, db); err != nil {
				cancel()
				log.Printf("schema: %v; retrying", err)
				time.Sleep(2 * time.Second)
				continue
			}
			if err := SeedWorkspace(ctx, db); err != nil {
				cancel()
				log.Printf("seed: %v; retrying", err)
				time.Sleep(2 * time.Second)
				continue
			}
			cancel()
			break
		}
	}()

	// background workers: probes, webhook delivery, assignment expiry, retention
	go srv.workers()

	log.Printf("interline desk listening on 0.0.0.0:%s", cfg.PublicPort)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("serve: %v", err)
	}
}

func (s *Server) workers() {
	probeCtx, probeCancel := context.WithTimeout(context.Background(), 5*time.Second)
	s.probeServices(probeCtx)
	probeCancel()

	retentionTicker := time.NewTicker(60 * time.Second)
	defer retentionTicker.Stop()
	for {
		s.probeServices(context.Background())
		s.checkAssignments(context.Background())
		s.sendPendingEvents()
		s.expireAuditEntries(context.Background())
		select {
		case <-retentionTicker.C:
		case <-time.After(s.cfg.WebhookRetry):
		}
	}
}

// expireAuditEntries deletes entries older than the retention period.
func (s *Server) expireAuditEntries(ctx context.Context) {
	cutoff := time.Now().UTC().Add(-s.cfg.AuditRetention)
	if _, err := s.db.ExecContext(ctx, `DELETE FROM audit_log WHERE at < $1`, cutoff); err != nil {
		log.Printf("audit retention: %v", err)
	}
}

var _ = fmt.Sprintf
