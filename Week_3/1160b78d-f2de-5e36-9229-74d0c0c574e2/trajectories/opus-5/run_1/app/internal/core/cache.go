package core

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

// rateScript counts one routing key's events inside its 60-second window. The
// window opens at the first counted event; only events that pass intake
// validation count.
var rateScript = redis.NewScript(`
local key = KEYS[1]
local now = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local mode = ARGV[3]
local ws = tonumber(redis.call('HGET', key, 'window_start') or '0')
local count = tonumber(redis.call('HGET', key, 'count') or '0')
if ws == 0 or now >= ws + 60 then
  ws = 0
  count = 0
end
if mode == 'count' then
  if ws == 0 then
    ws = now
    count = 0
  end
  if count >= limit then
    return {count, ws, 0}
  end
  count = count + 1
  redis.call('HSET', key, 'window_start', ws, 'count', count)
  redis.call('EXPIRE', key, 172800)
  return {count, ws, 1}
end
return {count, ws, 1}
`)

// rateReturnScript gives a slot back when the event was not accepted after
// all, so a broker outage uses no slot.
var rateReturnScript = redis.NewScript(`
local key = KEYS[1]
local count = tonumber(redis.call('HGET', key, 'count') or '0')
if count <= 1 then
  redis.call('DEL', key)
  return 0
end
redis.call('HSET', key, 'count', count - 1)
return count - 1
`)

const rateLimit = 120

type rateState struct {
	Available   bool
	Count       *int
	RetryAfter  *int
	CacheIsDown bool
}

func (a *App) rateWindow(ctx context.Context, routingKey string, count bool) (rateState, bool) {
	if a.rdb == nil || !a.cacheUp.Load() {
		return rateState{Available: true, CacheIsDown: true}, true
	}
	mode := "peek"
	if count {
		mode = "count"
	}
	now := a.Clock.Now().Unix()
	res, err := rateScript.Run(ctx, a.rdb, []string{a.key("rate", routingKey)}, now, rateLimit, mode).Int64Slice()
	if err != nil || len(res) != 3 {
		a.cacheUp.Store(false)
		return rateState{Available: true, CacheIsDown: true}, true
	}
	used := int(res[0])
	windowStart := res[1]
	allowed := res[2] == 1
	state := rateState{Available: true, Count: ptr(used)}
	if windowStart == 0 {
		state.Count = ptr(0)
		return state, allowed
	}
	if used >= rateLimit {
		remaining := int(windowStart + 60 - now)
		if remaining < 1 {
			remaining = 1
		}
		state.Available = false
		state.RetryAfter = ptr(remaining)
	}
	return state, allowed
}

// returnRateSlot gives one counted event back to its window.
func (a *App) returnRateSlot(ctx context.Context, routingKey string) {
	if a.rdb == nil || !a.cacheUp.Load() {
		return
	}
	if err := rateReturnScript.Run(ctx, a.rdb, []string{a.key("rate", routingKey)}).Err(); err != nil {
		a.cacheUp.Store(false)
	}
}

func (a *App) cacheGet(ctx context.Context, key string) (etag, body string, ok bool) {
	if a.rdb == nil || !a.cacheUp.Load() {
		return "", "", false
	}
	values, err := a.rdb.HMGet(ctx, a.key(key), "etag", "body").Result()
	if err != nil || len(values) != 2 || values[0] == nil || values[1] == nil {
		if err != nil {
			a.cacheUp.Store(false)
		}
		return "", "", false
	}
	e, _ := values[0].(string)
	b, _ := values[1].(string)
	return e, b, true
}

func (a *App) cacheSet(ctx context.Context, key, etag, body string, ttl time.Duration) {
	if a.rdb == nil || !a.cacheUp.Load() || ttl <= 0 {
		return
	}
	full := a.key(key)
	pipe := a.rdb.Pipeline()
	pipe.HSet(ctx, full, "etag", etag, "body", body)
	pipe.Expire(ctx, full, ttl)
	if _, err := pipe.Exec(ctx); err != nil {
		a.cacheUp.Store(false)
	}
}

func (a *App) cacheDel(ctx context.Context, keys ...string) {
	if a.rdb == nil {
		return
	}
	full := make([]string, 0, len(keys))
	for _, k := range keys {
		full = append(full, a.key(k))
	}
	if err := a.rdb.Del(ctx, full...).Err(); err != nil {
		a.cacheUp.Store(false)
	}
}

func (a *App) cacheDelPrefix(ctx context.Context, prefix string) {
	if a.rdb == nil {
		return
	}
	iter := a.rdb.Scan(ctx, 0, a.key(prefix)+"*", 200).Iterator()
	var keys []string
	for iter.Next(ctx) {
		keys = append(keys, iter.Val())
	}
	if len(keys) > 0 {
		if err := a.rdb.Del(ctx, keys...).Err(); err != nil {
			a.cacheUp.Store(false)
		}
	}
}

// clearStatusCache drops the cached status page, on every edit that could
// change it, before the response returns.
func (a *App) clearStatusCache(ctx context.Context) {
	a.cacheDel(ctx, "cache:status:json", "cache:status:html")
}

func (a *App) clearOncallCache(ctx context.Context) {
	a.cacheDelPrefix(ctx, "cache:oncall:")
}

func (a *App) clearAnalyticsCache(ctx context.Context) {
	a.cacheDelPrefix(ctx, "cache:analytics:")
}

func (a *App) CacheUp() bool { return a.cacheUp.Load() }
