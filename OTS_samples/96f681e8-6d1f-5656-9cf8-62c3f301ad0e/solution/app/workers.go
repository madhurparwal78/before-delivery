package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	workerTick        = 500 * time.Millisecond
	noticeSenders     = 4
	startupRetryEvery = 2 * time.Second
)

// runWorkers starts the background loops: hold expiry, the match cut-off, settlement, guarantee refresh, owed voids
// and the notice senders. Several instances may run them at once; every step claims its work in the database.
func (a *App) runWorkers(ctx context.Context) {
	loops := []struct {
		name string
		step func(context.Context) error
	}{
		{"hold expiry", a.expireHolds},
		{"match cut-off", func(ctx context.Context) error { return drain(ctx, a.cancelStalledMatch) }},
		{"settlement", func(ctx context.Context) error {
			if err := a.voidStartedShares(ctx); err != nil {
				return err
			}
			return drain(ctx, a.settleNextShare)
		}},
		{"guarantee refresh", func(ctx context.Context) error { return drain(ctx, a.refreshNextGuarantee) }},
		{"owed voids", func(ctx context.Context) error { return drain(ctx, a.sendNextOwedVoid) }},
	}
	for _, loop := range loops {
		go every(ctx, loop.name, loop.step)
	}
	for i := 0; i < noticeSenders; i++ {
		go every(ctx, "notice sender", func(ctx context.Context) error { return drain(ctx, a.deliverNextNotice) })
	}
}

// drain repeats a step while it finds work.
func drain(ctx context.Context, step func(context.Context) (bool, error)) error {
	for ctx.Err() == nil {
		found, err := step(ctx)
		if err != nil || !found {
			return err
		}
	}
	return nil
}

func every(ctx context.Context, name string, step func(context.Context) error) {
	ticker := time.NewTicker(workerTick)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			stepCtx, cancel := context.WithTimeout(ctx, requestTimeout)
			if err := step(stepCtx); err != nil && !errors.Is(err, context.Canceled) {
				log.Printf("%s: %v", name, err)
			}
			cancel()
		}
	}
}

// expireHolds releases every hold whose expires_at has passed.
func (a *App) expireHolds(ctx context.Context) error {
	return drain(ctx, func(ctx context.Context) (bool, error) {
		var found bool
		err := withTx(ctx, a.pool, func(tx pgx.Tx) error {
			var id string
			err := tx.QueryRow(ctx, "SELECT id FROM bookings WHERE status = $1 AND expires_at <= clock_timestamp() ORDER BY expires_at LIMIT 1 FOR UPDATE SKIP LOCKED",
				bookingHeld).Scan(&id)
			if errors.Is(err, pgx.ErrNoRows) {
				return nil
			}
			if err != nil {
				return fmt.Errorf("find expired hold: %w", err)
			}
			found = true
			b, err := loadBooking(ctx, tx, id, false)
			if err != nil {
				return err
			}
			return a.releaseHold(ctx, tx, b)
		})
		return found, err
	})
}

// startUp prepares the database, the seed and the sign-in realm, retrying every two seconds until PostgreSQL and
// Keycloak are both reached; only then does the health check answer 200.
func (a *App) startUp(ctx context.Context) {
	databaseReady := false
	for ctx.Err() == nil {
		if !databaseReady {
			if err := a.prepareDatabase(ctx); err != nil {
				log.Printf("waiting for PostgreSQL: %v", err)
				sleepOrDone(ctx, startupRetryEvery)
				continue
			}
			databaseReady = true
			a.runWorkers(ctx)
		}
		if err := a.keycloak.ensureRealm(ctx, seedPeople, seedPassword); err != nil {
			log.Printf("waiting for Keycloak: %v", err)
			sleepOrDone(ctx, startupRetryEvery)
			continue
		}
		a.ready.Store(true)
		return
	}
}

func (a *App) prepareDatabase(ctx context.Context) error {
	if a.pool == nil {
		pool, err := openPool(ctx, a.cfg.DatabaseURL)
		if err != nil {
			return err
		}
		a.pool = pool
	}
	if err := applySchema(ctx, a.pool); err != nil {
		return err
	}
	return a.seedIfEmpty(ctx)
}

func sleepOrDone(ctx context.Context, d time.Duration) {
	select {
	case <-ctx.Done():
	case <-time.After(d):
	}
}
