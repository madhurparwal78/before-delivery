package main

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	rateLimit         = 120
	rateWindowSeconds = 60
	rateTTL           = 25 * time.Hour // no less than a day
)

var rateLimitReason = fmt.Sprintf("Over the limit of %d events a minute.", rateLimit)

// rateWindowScript is the one place the rate window rule lives. A window opens at the first counted event and lasts
// rateWindowSeconds on the server clock; its end second already belongs to the next window. ARGV: now, limit, window,
// "take" to count one event (anything else only reads), time to live. It answers {allowed, count, retry_after, window_start}.
var rateWindowScript = redis.NewScript(`
local now, limit, window = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
local start = tonumber(redis.call('HGET', KEYS[1], 'window_start'))
local count = tonumber(redis.call('HGET', KEYS[1], 'count')) or 0
if start == nil or now >= start + window then
  start = now
  count = 0
end
local allowed = count < limit
if ARGV[4] == 'take' and allowed then
  count = count + 1
  redis.call('HSET', KEYS[1], 'window_start', start, 'count', count)
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[5]))
end
local retry = 0
if count >= limit then
  retry = start + window - now
end
return {allowed and 1 or 0, count, retry, start}
`)

// rateReleaseScript gives back the slot of an event the broker did not confirm, so it opens no window and uses no slot.
// ARGV: the window_start the slot was taken in.
var rateReleaseScript = redis.NewScript(`
if tonumber(redis.call('HGET', KEYS[1], 'window_start')) ~= tonumber(ARGV[1]) then
  return 0
end
if redis.call('HINCRBY', KEYS[1], 'count', -1) <= 0 then
  redis.call('DEL', KEYS[1])
end
return 1
`)

// rateState is a routing key's rate window at one instant.
type rateState struct {
	Allowed    bool
	Count      int
	RetryAfter int // whole seconds to the window's end while the limit is reached, else 0
	Start      int64
}

// rateWindow reads the window, or counts one event in it when take is set. ok is false when Valkey is unreachable.
func (d *eventDesk) rateWindow(ctx context.Context, routingKey string, take bool) (state rateState, ok bool) {
	mode := "peek"
	if take {
		mode = "take"
	}
	result, ok := d.a.cache.Eval(ctx, rateWindowScript, []string{d.a.cfg.cacheKey("rate", routingKey)},
		d.a.clock.Now().Unix(), rateLimit, rateWindowSeconds, mode, int64(rateTTL/time.Second))
	if !ok {
		return rateState{}, false
	}
	values, isList := result.([]any)
	if !isList || len(values) != 4 {
		return rateState{}, false
	}
	return rateState{
		Allowed: values[0].(int64) == 1, Count: int(values[1].(int64)), RetryAfter: int(values[2].(int64)), Start: values[3].(int64),
	}, true
}

// takeSlot counts one event. counted is false when Valkey is unreachable: the event is then accepted uncounted.
func (d *eventDesk) takeSlot(ctx context.Context, routingKey string) (state rateState, counted bool) {
	return d.rateWindow(ctx, routingKey, true)
}

func (d *eventDesk) releaseSlot(ctx context.Context, routingKey string, windowStart int64) {
	d.a.cache.Eval(ctx, rateReleaseScript, []string{d.a.cfg.cacheKey("rate", routingKey)}, windowStart)
}

// rateCounter is the published counter of an integration.
type rateCounter struct {
	Count      *int `json:"count"`
	Limit      int  `json:"limit"`
	RetryAfter *int `json:"retry_after"`
	Available  bool `json:"available"`
}

// counter is the counter of a routing key now. With Valkey unreachable it has no count and no countdown.
func (d *eventDesk) counter(ctx context.Context, routingKey string) rateCounter {
	state, ok := d.rateWindow(ctx, routingKey, false)
	if !ok {
		return rateCounter{Limit: rateLimit, Available: true}
	}
	counter := rateCounter{Count: &state.Count, Limit: rateLimit, Available: state.Allowed}
	if !state.Allowed {
		counter.RetryAfter = &state.RetryAfter
	}
	return counter
}

// announce tells open integration pages that the counter, the log or the dead letters changed.
func (d *eventDesk) announce(ctx context.Context, integrationID string) {
	d.a.hub.Publish(ctx, "integration", map[string]string{"integration_id": integrationID})
}
