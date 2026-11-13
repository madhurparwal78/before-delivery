// Package core holds the Switchlamp domain: the one server clock, event intake
// and application, incidents and their timers, schedules, status and delivery.
package core

import (
	"context"
	_ "embed"
	"fmt"
	"log"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"switchlamp/internal/config"
	"switchlamp/internal/live"
)

//go:embed schema.sql
var schemaSQL string

type App struct {
	Cfg   config.Config
	Clock *Clock
	Hub   *live.Hub

	pool   *pgxpool.Pool
	rdb    *redis.Client
	broker *broker

	ready    atomic.Bool
	cacheUp  atomic.Bool
	mailUp   atomic.Bool
	queueUp  atomic.Bool
	recvUp   atomic.Bool
	upgrade  atomic.Value // scheduleUpgradeState
	secret   []byte
	secretMu sync.RWMutex

	// mu serialises every state-changing domain operation, so the first
	// decision on an incident wins and timers never interleave with actions.
	mu sync.Mutex
}

type scheduleUpgradeState struct {
	State      string     `json:"state"`
	Upgraded   int        `json:"upgraded"`
	FinishedAt *time.Time `json:"finished_at"`
}

func New(cfg config.Config) *App {
	a := &App{Cfg: cfg, Hub: live.NewHub()}
	a.upgrade.Store(scheduleUpgradeState{State: "running"})
	a.recvUp.Store(true)
	return a
}

func (a *App) Ready() bool { return a.ready.Load() }

// Start brings the app up without blocking: with Postgres unreachable it keeps
// retrying, and with any other dependency unreachable it starts anyway and
// recovers when that dependency returns.
func (a *App) Start(ctx context.Context) {
	go func() {
		for {
			if err := a.boot(ctx); err != nil {
				log.Printf("boot: %v", err)
				select {
				case <-ctx.Done():
					return
				case <-time.After(5 * time.Second):
					continue
				}
			}
			return
		}
	}()
}

func (a *App) boot(ctx context.Context) error {
	pool, err := connectPostgres(ctx, a.Cfg.DatabaseURL)
	if err != nil {
		return err
	}
	a.pool = pool
	if _, err := pool.Exec(ctx, schemaSQL); err != nil {
		return fmt.Errorf("apply schema: %w", err)
	}
	a.Clock = newClock(pool)
	if err := a.Clock.load(ctx); err != nil {
		return err
	}
	if err := a.loadSecret(ctx); err != nil {
		return err
	}
	if err := a.seed(ctx); err != nil {
		return err
	}

	a.rdb = connectValkey(a.Cfg.ValkeyURL)
	a.broker = newBroker(a.Cfg.AMQPURL, a.Cfg.Instance)
	a.broker.handler = a.handleEventMessage

	a.ready.Store(true)
	a.LastSeq(ctx)

	go a.cacheProbe(ctx)
	go a.mailProbe(ctx)
	go a.broker.run(ctx, a)
	go a.timerLoop(ctx)
	go a.pendingLoop(ctx)
	go a.mailLoop(ctx)
	go a.webhookLoop(ctx)
	go a.countdownLoop(ctx)
	go a.upgradeSchedules(ctx)
	return nil
}

func connectPostgres(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	if cfg.ConnConfig.RuntimeParams == nil {
		cfg.ConnConfig.RuntimeParams = map[string]string{}
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = "switchlamp"
	cfg.MaxConns = 16
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("connect postgres: %w", err)
	}
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	// The schema statement needs the schema to exist before search_path works.
	if _, err := pool.Exec(ctx, `CREATE SCHEMA IF NOT EXISTS switchlamp`); err != nil {
		pool.Close()
		return nil, fmt.Errorf("create schema: %w", err)
	}
	return pool, nil
}

func connectValkey(url string) *redis.Client {
	opt, err := redis.ParseURL(url)
	if err != nil {
		log.Printf("valkey url: %v", err)
		return nil
	}
	opt.DialTimeout = 2 * time.Second
	opt.ReadTimeout = 2 * time.Second
	opt.WriteTimeout = 2 * time.Second
	opt.MaxRetries = 0
	return redis.NewClient(opt)
}

func (a *App) loadSecret(ctx context.Context) error {
	var value string
	err := a.pool.QueryRow(ctx, `INSERT INTO app_secrets (key, value) VALUES ('signing', $1)
		ON CONFLICT (key) DO UPDATE SET key = 'signing' RETURNING value`, randomHex(32)).Scan(&value)
	if err != nil {
		return fmt.Errorf("load signing secret: %w", err)
	}
	a.secretMu.Lock()
	a.secret = []byte(value)
	a.secretMu.Unlock()
	return nil
}

func (a *App) signingSecret() []byte {
	a.secretMu.RLock()
	defer a.secretMu.RUnlock()
	return a.secret
}

func (a *App) cacheProbe(ctx context.Context) {
	for {
		if a.rdb != nil {
			probe, cancel := context.WithTimeout(ctx, 2*time.Second)
			err := a.rdb.Ping(probe).Err()
			cancel()
			a.cacheUp.Store(err == nil)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}
}

// SystemState reports the dependencies for /api/system and the outage bars.
func (a *App) SystemState() map[string]any {
	state := func(up bool) string {
		if up {
			return "ok"
		}
		return "down"
	}
	up, _ := a.upgrade.Load().(scheduleUpgradeState)
	return map[string]any{
		"queue":            state(a.queueUp.Load()),
		"cache":            state(a.cacheUp.Load()),
		"mail":             state(a.mailUp.Load()),
		"receiver":         state(a.recvUp.Load()),
		"schedule_upgrade": up,
	}
}

func (a *App) Pool() *pgxpool.Pool { return a.pool }

// Lock takes the domain lock. Every state change holds it, so simultaneous
// requests are decided one after the other.
func (a *App) Lock()   { a.mu.Lock() }
func (a *App) Unlock() { a.mu.Unlock() }

func (a *App) key(parts ...string) string {
	return "switchlamp:" + a.Cfg.Instance + ":" + strings.Join(parts, ":")
}
