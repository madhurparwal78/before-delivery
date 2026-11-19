import { Redis } from 'ioredis';
import type { AppConfig } from './config.js';

export function redisOptions(url: string): { host: string; port: number; username?: string; password?: string; db: number } {
  const parsed = new URL(url);
  const db = parsed.pathname && parsed.pathname.length > 1 ? Number.parseInt(parsed.pathname.slice(1), 10) : 0;
  const opts: { host: string; port: number; username?: string; password?: string; db: number } = {
    host: parsed.hostname,
    port: Number.parseInt(parsed.port || '6379', 10),
    db: Number.isFinite(db) ? db : 0,
  };
  if (parsed.username) opts.username = parsed.username;
  if (parsed.password) opts.password = parsed.password;
  return opts;
}

export function createRedis(config: AppConfig): Redis {
  const redis = new Redis({ ...redisOptions(config.valkeyUrl), lazyConnect: true, maxRetriesPerRequest: 2, enableOfflineQueue: false });
  redis.on('error', () => {
    // errors surfaced per-request
  });
  return redis;
}

export interface RateBucket {
  rate: number;
  tokens: number;
  updatedMs: number;
}

const RATE_SCRIPT = `
local rate = tonumber(redis.call('HGET', KEYS[1], 'rate') or '0')
local tokens = tonumber(redis.call('HGET', KEYS[1], 'tokens') or rate)
local updated = tonumber(redis.call('HGET', KEYS[1], 'updated_ms') or tostring(ARGV[1]))
local now = tonumber(ARGV[1])
if rate == 0 then return -1 end
local elapsed = math.max(0, now - updated)
tokens = math.min(rate, tokens + (elapsed / 1000) * rate)
if tokens >= 1 then
  tokens = tokens - 1
  redis.call('HSET', KEYS[1], 'tokens', tokens, 'updated_ms', now)
  return 1
else
  redis.call('HSET', KEYS[1], 'tokens', tokens, 'updated_ms', now)
  local wait = math.ceil((1 - tokens) / rate * 1000)
  return wait
end
`;

export class RateLimiter {
  constructor(private readonly redis: Redis) {}

  async setRate(keyId: string, rate: number): Promise<void> {
    await this.redis.hset(`ratelimit:${keyId}`, { rate: String(rate), tokens: String(rate), updated_ms: String(Date.now()) });
  }

  async consume(keyId: string): Promise<{ allowed: boolean; retryAfterMs: number }> {
    const result = await this.redis.eval(RATE_SCRIPT, 1, `ratelimit:${keyId}`, Date.now().toString());
    const value = Number(result);
    if (value === 1) return { allowed: true, retryAfterMs: 0 };
    if (value === -1) return { allowed: false, retryAfterMs: 1000 };
    return { allowed: false, retryAfterMs: Math.max(1, value) };
  }

  async removeKey(keyId: string): Promise<void> {
    await this.redis.del(`ratelimit:${keyId}`);
  }
}

export class Bus {
  constructor(private readonly redis: Redis) {}

  async publish(channel: string, event: string, data: Record<string, unknown>): Promise<void> {
    await this.redis.publish(channel, JSON.stringify({ event, data }));
  }
}

export function createSubscriber(config: AppConfig): Redis {
  const sub = new Redis({ ...redisOptions(config.valkeyUrl), lazyConnect: true, maxRetriesPerRequest: null, enableOfflineQueue: true });
  sub.on('error', () => {
    // reconnect handled by ioredis
  });
  return sub;
}
