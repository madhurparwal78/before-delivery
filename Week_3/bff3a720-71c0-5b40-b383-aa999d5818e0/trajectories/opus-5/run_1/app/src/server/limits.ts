import { randomUUID } from 'node:crypto';
import { valkey } from './valkey.js';

export interface LimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * One sliding window judged by server time. A refused attempt writes nothing, so it does
 * not count against the window.
 */
export async function checkLimit(
  key: string,
  limit: number,
  windowMs: number,
  at: Date,
): Promise<LimitDecision> {
  const cutoff = at.getTime() - windowMs;
  await valkey.zremrangebyscore(key, 0, cutoff).catch(() => undefined);
  const count = await valkey.zcard(key).catch(() => 0);
  if (count < limit) return { allowed: true, retryAfterSeconds: 0 };
  const oldest = await valkey.zrange(key, 0, 0, 'WITHSCORES').catch(() => [] as string[]);
  const oldestScore = Number(oldest[1] ?? at.getTime());
  const retry = Math.max(1, Math.ceil((oldestScore + windowMs - at.getTime()) / 1000));
  return { allowed: false, retryAfterSeconds: retry };
}

export async function recordAttempt(key: string, at: Date): Promise<void> {
  await valkey.zadd(key, at.getTime(), `${at.getTime()}:${randomUUID()}`).catch(() => undefined);
}
