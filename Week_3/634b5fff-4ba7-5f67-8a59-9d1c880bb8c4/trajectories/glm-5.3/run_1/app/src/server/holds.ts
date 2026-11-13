import { Redis } from 'ioredis';
import { config, holdKey } from './config.js';

export const redis = new Redis(config.valkeyUrl, {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  lazyConnect: true,
  retryStrategy: (times: number) => Math.min(times * 200, 3000),
});

redis.on('error', () => { /* reconnection is managed by ioredis */ });
void redis.connect().catch(() => { /* it retries on its own */ });

export async function redisUp(): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

export interface Hold {
  token: string;
  /** Grant instant in real time. */
  grantedAtMs: number;
  holdMs: number;
}

/** Take a hold atomically with set-if-absent. Returns null when taken. */
export async function takeHold(number: number, token: string): Promise<Hold | null> {
  const key = holdKey(number);
  const holdMs = config.holdSeconds * 1000;
  const res = await redis.set(key, token, 'PX', holdMs, 'NX');
  if (res !== 'OK') return null;
  return { token, grantedAtMs: Date.now(), holdMs };
}

/** The server-side remaining milliseconds, or null when the hold has ended. */
export async function holdRemainingMs(number: number): Promise<number | null> {
  const ttl = await redis.pttl(holdKey(number));
  if (ttl === null || ttl < 0) return null;
  return ttl;
}

export async function holdToken(number: number): Promise<string | null> {
  const v = await redis.get(holdKey(number));
  return v;
}

export async function releaseHold(number: number, token: string): Promise<boolean> {
  const key = holdKey(number);
  const v = await redis.get(key);
  if (v !== token) return false;
  await redis.del(key);
  return true;
}

/** A hold converts to a claim only while its key still exists. */
export async function holdExists(number: number): Promise<boolean> {
  const v = await redis.exists(holdKey(number));
  return v === 1;
}
