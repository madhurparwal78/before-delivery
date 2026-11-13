// Package cache wraps the shared Valkey counter and cached responses.
package cache

import (
	"context"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// Cache talks to Valkey, degrading gracefully when it is unreachable.
type Cache struct {
	Client  *redis.Client
	prefix  string
	mu      sync.Mutex
	knownUp bool
	lastTry time.Time
	mailUp  bool
	tried   bool
}

// New builds a Cache from the Valkey URL.
func New(valkeyURL, instance string) (*Cache, error) {
	opts, err := redis.ParseURL(valkeyURL)
	if err != nil {
		return nil, err
	}
	c := &Cache{Client: redis.NewClient(opts), prefix: "switchlamp:" + instance + ":"}
	return c, nil
}

// Up reports whether Valkey answered recently.
func (c *Cache) Up(ctx context.Context) bool {
	c.mu.Lock()
	if c.knownUp {
		c.mu.Unlock()
		return true
	}
	if c.tried && time.Since(c.lastTry) < 2*time.Second {
		c.mu.Unlock()
		return false
	}
	c.tried = true
	c.lastTry = time.Now()
	c.mu.Unlock()
	if err := c.Client.Ping(ctx).Err(); err == nil {
		c.mu.Lock()
		c.knownUp = true
		c.mu.Unlock()
		return true
	}
	return false
}

// markDown notes that Valkey failed.
func (c *Cache) markDown() {
	c.mu.Lock()
	c.knownUp = false
	c.tried = true
	c.lastTry = time.Now()
	c.mu.Unlock()
}

// markUp notes that Valkey answered.
func (c *Cache) markUp() {
	c.mu.Lock()
	c.knownUp = true
	c.mu.Unlock()
}

// RateResult is the published rate counter state.
type RateResult struct {
	Count      *int64 `json:"count"`
	Available  bool   `json:"available"`
	RetryAfter *int64 `json:"retry_after"`
	WindowEnd  int64
}

var rateScript = redis.NewScript(`
local key = KEYS[1]
local now = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local start = tonumber(redis.call('HGET', key, 'window_start') or '0')
local count = tonumber(redis.call('HGET', key, 'count') or '0')
if start == 0 or now >= start + 60 then
	start = now
	count = 0
end
if count >= limit then
	local retry = start + 60 - now
	if retry < 1 then retry = 1 end
	redis.call('HSET', key, 'window_start', start, 'count', count)
	redis.call('EXPIRE', key, 86400)
	return {count, start, retry}
end
count = count + 1
redis.call('HSET', key, 'window_start', start, 'count', count)
redis.call('EXPIRE', key, 86400)
return {count, start, 0}
`)

// RateCount counts an event in the Business rules window. The 120th is allowed.
func (c *Cache) RateCount(ctx context.Context, routingKey string, nowSec, limit int64) (RateResult, error) {
	key := c.prefix + "rate:" + routingKey
	v, err := rateScript.Run(ctx, c.Client, []string{key}, nowSec, limit).Slice()
	if err != nil {
		c.markDown()
		return RateResult{}, err
	}
	c.markUp()
	cnt := v[0].(int64)
	start := v[1].(int64)
	retry := v[2].(int64)
	rr := RateResult{Count: &cnt, Available: true, WindowEnd: start + 60}
	if retry > 0 {
		rr.Available = false
		rr.RetryAfter = &retry
	}
	return rr, nil
}

// RateRead reads the counter without counting.
func (c *Cache) RateRead(ctx context.Context, routingKey string, nowSec, limit int64) (RateResult, error) {
	key := c.prefix + "rate:" + routingKey
	start, err := c.Client.HGet(ctx, key, "window_start").Int64()
	if err == redis.Nil {
		c.markUp()
		zero := int64(0)
		return RateResult{Count: &zero, Available: true}, nil
	}
	if err != nil {
		c.markDown()
		return RateResult{}, err
	}
	count, err := c.Client.HGet(ctx, key, "count").Int64()
	if err != nil {
		c.markDown()
		return RateResult{}, err
	}
	c.markUp()
	if start == 0 || nowSec >= start+60 {
		zero := int64(0)
		return RateResult{Count: &zero, Available: true, WindowEnd: 0}, nil
	}
	rr := RateResult{Count: &count, Available: true, WindowEnd: start + 60}
	if count >= limit {
		retry := start + 60 - nowSec
		if retry < 1 {
			retry = 1
		}
		rr.Available = false
		rr.RetryAfter = &retry
	}
	return rr, nil
}

// Get fetches a cached value by name.
func (c *Cache) Get(ctx context.Context, name string) (etag, body string, ok bool) {
	etag, err := c.Client.HGet(ctx, c.prefix+name, "etag").Result()
	if err != nil {
		return "", "", false
	}
	body, err = c.Client.HGet(ctx, c.prefix+name, "body").Result()
	if err != nil {
		return "", "", false
	}
	c.markUp()
	return etag, body, true
}

// Set stores a cached value with a five minute lifetime.
func (c *Cache) Set(ctx context.Context, name, etag, body string) error {
	err := c.Client.HSet(ctx, c.prefix+name, map[string]string{"etag": etag, "body": body}).Err()
	if err != nil {
		c.markDown()
		return err
	}
	c.markUp()
	return c.Client.Expire(ctx, c.prefix+name, 5*time.Minute).Err()
}

// Del clears cached copies at once.
func (c *Cache) Del(ctx context.Context, names ...string) {
	args := make([]string, 0, len(names))
	for _, n := range names {
		args = append(args, c.prefix+n)
	}
	if err := c.Client.Del(ctx, args...).Err(); err != nil {
		c.markDown()
	}
}

// GetAnalytics reads a finished analytics result.
func (c *Cache) GetAnalytics(ctx context.Context, from, to string) (string, bool) {
	_, body, ok := c.Get(ctx, "cache:analytics:"+from+":"+to)
	return body, ok
}

// SetAnalytics stores a finished analytics result with no fixed lifetime.
func (c *Cache) SetAnalytics(ctx context.Context, from, to, body string) error {
	err := c.Client.HSet(ctx, c.prefix+"cache:analytics:"+from+":"+to, map[string]string{"etag": from, "body": body}).Err()
	if err != nil {
		c.markDown()
		return err
	}
	c.markUp()
	return nil
}

// NoteMail records the mail health shown on the incident page and status desk.
func (c *Cache) NoteMail(up bool) {
	c.mu.Lock()
	c.mailUp = up
	c.mu.Unlock()
}

// MailUp reports the recorded mail health.
func (c *Cache) MailUp() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.mailUp
}
