package main

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"sync/atomic"
)

// Cache is the Valkey connection: shared counters and cached responses. When Valkey is unreachable every operation
// reports it (ok == false) and callers compute from Postgres; a ping every second brings caching back with no restart.
type Cache struct {
	rdb *redis.Client
	up  atomic.Bool
}

func newCache(url string) (*Cache, error) {
	options, err := redis.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("parse cache url: %w", err)
	}
	options.Protocol = 2
	options.DisableIdentity = true
	options.MaxRetries = -1
	options.DialTimeout = 700 * time.Millisecond
	options.ReadTimeout = time.Second
	options.WriteTimeout = time.Second
	return &Cache{rdb: redis.NewClient(options)}, nil
}

// Up reports whether Valkey answered the last time it was asked.
func (c *Cache) Up() bool { return c.up.Load() }

// Watch pings Valkey every real second and tracks whether it is reachable.
func (c *Cache) Watch(ctx context.Context) {
	c.ping(ctx)
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.ping(ctx)
		}
	}
}

func (c *Cache) ping(ctx context.Context) {
	c.up.Store(c.rdb.Ping(ctx).Err() == nil)
}

// note records the outcome of a command: an unreachable server marks Valkey down.
func (c *Cache) note(err error) bool {
	if err == nil {
		return true
	}
	var server redis.Error
	if errors.As(err, &server) {
		return false
	}
	c.up.Store(false)
	return false
}

// Hash reads a cached hash. ok is false when Valkey is down or the key is absent.
func (c *Cache) Hash(ctx context.Context, key string) (map[string]string, bool) {
	if !c.Up() {
		return nil, false
	}
	fields, err := c.rdb.HGetAll(ctx, key).Result()
	if !c.note(err) || len(fields) == 0 {
		return nil, false
	}
	return fields, true
}

// SetHash stores a hash. A zero ttl keeps it with no lifetime.
func (c *Cache) SetHash(ctx context.Context, key string, fields map[string]any, ttl time.Duration) bool {
	if !c.Up() {
		return false
	}
	pipe := c.rdb.TxPipeline()
	pipe.Del(ctx, key)
	pipe.HSet(ctx, key, fields)
	if ttl > 0 {
		pipe.Expire(ctx, key, ttl)
	}
	_, err := pipe.Exec(ctx)
	return c.note(err)
}

// Del removes cached copies; the caller does this before its response returns.
func (c *Cache) Del(ctx context.Context, keys ...string) bool {
	if !c.Up() || len(keys) == 0 {
		return false
	}
	return c.note(c.rdb.Del(ctx, keys...).Err())
}

// Keys lists keys by pattern.
func (c *Cache) Keys(ctx context.Context, pattern string) ([]string, bool) {
	if !c.Up() {
		return nil, false
	}
	keys, err := c.rdb.Keys(ctx, pattern).Result()
	return keys, c.note(err)
}

// Eval runs a Lua script; ok is false when Valkey is unreachable.
func (c *Cache) Eval(ctx context.Context, script *redis.Script, keys []string, args ...any) (any, bool) {
	if !c.Up() {
		return nil, false
	}
	result, err := script.Run(ctx, c.rdb, keys, args...).Result()
	if !c.note(err) {
		return nil, false
	}
	return result, true
}
