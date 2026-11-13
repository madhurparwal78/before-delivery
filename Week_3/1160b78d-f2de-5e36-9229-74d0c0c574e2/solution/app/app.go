package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// dbq is what both the pool and a transaction offer; read helpers take it so they serve either.
type dbq interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// App is the running Switchlamp process.
type App struct {
	cfg   Config
	db    *pgxpool.Pool
	clock *Clock
	hub   *Hub
	cache *Cache
	mux   *http.ServeMux
	ready atomic.Bool

	// mu is the domain lock: every state change runs under it, so the first request to commit wins and messages
	// are published in commit order. Network calls (broker, SMTP, webhooks) never run under it.
	mu sync.Mutex
}

// Registries filled by each domain file's init, so a domain adds itself without editing shared files.
var (
	routeSetups  []func(*App)
	workerSetups []func(*App, context.Context)
	seeders      []seeder
	// timerHandlers fire a due timer. Work.Now is the timer's own deadline.
	timerHandlers = map[string]func(*App, *Work, string) error{}
)

type seeder struct {
	order int
	name  string
	fn    func(*App, *Work) error
}

// Work is one unit of domain work: a transaction under the domain lock at one server second.
type Work struct {
	Ctx  context.Context
	Tx   pgx.Tx
	A    *App
	Now  time.Time // the server clock second this work happens at (a timer's own deadline when a timer fires)
	msgs []liveDraft
	post []func(ctx context.Context)
}

type liveDraft struct {
	typ  string
	data any
}

// Publish queues a replayable live message; it is sent after the transaction commits, in order.
func (w *Work) Publish(typ string, data any) {
	w.msgs = append(w.msgs, liveDraft{typ: typ, data: data})
}

// After queues a function to run once the transaction has committed and before the live messages are sent, such as
// clearing a cached copy, so the cache is clear before the request's response returns.
func (w *Work) After(fn func(ctx context.Context)) { w.post = append(w.post, fn) }

// Do runs fn as one unit of work. Due timers are applied first, so no answer is ever stale.
func (a *App) Do(ctx context.Context, fn func(w *Work) error) error {
	if err := a.settle(ctx); err != nil {
		return fmt.Errorf("apply due timers: %w", err)
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.runLocked(ctx, a.clock.Now(), fn); err != nil {
		return fmt.Errorf("apply work: %w", err)
	}
	return nil
}

func (a *App) runLocked(ctx context.Context, now time.Time, fn func(w *Work) error) error {
	tx, err := a.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	w := &Work{Ctx: ctx, Tx: tx, A: a, Now: now}
	if err := fn(w); err != nil {
		if rollbackErr := tx.Rollback(ctx); rollbackErr != nil && !errors.Is(rollbackErr, pgx.ErrTxClosed) {
			log.Printf("rollback: %v", rollbackErr)
		}
		return fmt.Errorf("run unit of work: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}
	for _, fn := range w.post {
		fn(ctx)
	}
	for _, m := range w.msgs {
		a.hub.Publish(ctx, m.typ, m.data)
	}
	return nil
}

// settle applies every timer that is due on the server clock, in deadline order, each stamped with its own deadline.
func (a *App) settle(ctx context.Context) error {
	for {
		var kind, ref string
		var due time.Time
		// due_at <= now is the SQL form of the edge rule (edge.go): a timer fires at its due second.
		err := a.db.QueryRow(ctx, `select kind, ref, due_at from timers where due_at <= $1 order by due_at, id limit 1`,
			a.clock.Now()).Scan(&kind, &ref, &due)
		if isNoRows(err) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("find due timer: %w", err)
		}
		if err := a.fire(ctx, kind, ref, due); err != nil {
			return fmt.Errorf("fire %s timer %s: %w", kind, ref, err)
		}
	}
}

func (a *App) fire(ctx context.Context, kind, ref string, due time.Time) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.runLocked(ctx, due.UTC(), func(w *Work) error {
		tag, err := w.Tx.Exec(ctx, `delete from timers where kind = $1 and ref = $2 and due_at = $3`, kind, ref, due)
		if err != nil {
			return fmt.Errorf("claim timer: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return nil
		}
		if err := timerHandlers[kind](a, w, ref); err != nil {
			return fmt.Errorf("run %s timer handler: %w", kind, err)
		}
		return nil
	}); err != nil {
		return fmt.Errorf("run timer: %w", err)
	}
	return nil
}

// setTimer arms (or moves) the one timer of a kind and reference.
func (w *Work) setTimer(kind, ref string, due time.Time) error {
	_, err := w.Tx.Exec(w.Ctx, `insert into timers (kind, ref, due_at) values ($1, $2, $3)
		on conflict (kind, ref) do update set due_at = excluded.due_at, id = nextval('timers_id_seq')`, kind, ref, due.UTC())
	if err != nil {
		return fmt.Errorf("set %s timer: %w", kind, err)
	}
	return nil
}

// clearTimer disarms a timer.
func (w *Work) clearTimer(kind, ref string) error {
	if _, err := w.Tx.Exec(w.Ctx, `delete from timers where kind = $1 and ref = $2`, kind, ref); err != nil {
		return fmt.Errorf("clear %s timer: %w", kind, err)
	}
	return nil
}

// runTicker applies due timers about five times a second while the clock runs, and when asked after a clock move.
func (a *App) runTicker(ctx context.Context) {
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := a.settle(ctx); err != nil && ctx.Err() == nil {
				log.Printf("ticker: %v", err)
			}
		}
	}
}

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// runSeeders loads seed data once, in order, when the database is empty.
func (a *App) runSeeders(ctx context.Context) error {
	sort.SliceStable(seeders, func(i, j int) bool { return seeders[i].order < seeders[j].order })
	if err := a.Do(ctx, func(w *Work) error {
		if _, err := w.Tx.Exec(ctx, `select pg_advisory_xact_lock(7001)`); err != nil {
			return fmt.Errorf("lock seed: %w", err)
		}
		var seeded bool
		if err := w.Tx.QueryRow(ctx, `select exists (select 1 from meta where key = 'seeded')`).Scan(&seeded); err != nil {
			return fmt.Errorf("read seed flag: %w", err)
		}
		if seeded {
			return nil
		}
		for _, s := range seeders {
			if err := s.fn(a, w); err != nil {
				return fmt.Errorf("seed %s: %w", s.name, err)
			}
		}
		_, err := w.Tx.Exec(ctx, `insert into meta (key, value) values ('seeded', $1)`, formatInstant(w.Now))
		if err != nil {
			return fmt.Errorf("mark seeded: %w", err)
		}
		w.msgs = nil
		return nil
	}); err != nil {
		return fmt.Errorf("load seed data: %w", err)
	}
	return nil
}
