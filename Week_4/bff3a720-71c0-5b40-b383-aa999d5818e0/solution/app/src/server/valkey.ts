import { Redis } from "ioredis";
import { config } from "./config";

export const valkey = new Redis(config.valkeyUrl, { maxRetriesPerRequest: 2, enableOfflineQueue: false, lazyConnect: true });
valkey.on("error", () => undefined);

/** A dedicated connection for pub/sub: a subscribed connection cannot run other commands. */
export const subscriber = new Redis(config.valkeyUrl, { maxRetriesPerRequest: null, lazyConnect: true });
subscriber.on("error", () => undefined);

export const EVENTS_CHANNEL = "longseat:events";
const REQUEST_DEADLINES = "longseat:request-deadlines";
const LAST_SEEN = "longseat:last-seen";

const holdKey = (rideId: string, leg: number, seat: number): string => `longseat:hold:${rideId}:${leg}:${seat}`;
const presenceKey = (bookingId: string): string => `longseat:presence:${bookingId}`;
export const requestRateKey = (memberId: string): string => `longseat:rate:requests:${memberId}`;
export const messageRateKey = (memberId: string): string => `longseat:rate:messages:${memberId}`;
export const codeRateKey = (email: string): string => `longseat:rate:codes:${email}`;

const WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
if redis.call('ZCARD', key) >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  return {0, tonumber(oldest[2]) + window - now}
end
redis.call('ZADD', key, now, ARGV[4])
return {1, 0}
`;

valkey.defineCommand("slideWindow", { numberOfKeys: 1, lua: WINDOW_SCRIPT });

declare module "ioredis" {
  interface RedisCommander<Context> {
    slideWindow(key: string, nowMs: number, windowMs: number, limit: number, member: string): Promise<[number, number]>;
  }
}

interface WindowVerdict {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Sliding-window limiter over a sorted set of attempt times in server-time milliseconds. A refused attempt writes nothing. */
export async function takeFromWindow(key: string, nowMs: number, windowMs: number, limit: number, member: string): Promise<WindowVerdict> {
  const [allowed, retryMs] = await valkey.slideWindow(key, nowMs, windowMs, limit, member);
  return { allowed: allowed === 1, retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)) };
}

export async function placeHold(rideId: string, legs: number[], seats: number[], bookingId: string, remainingMs: number): Promise<void> {
  const pipeline = valkey.pipeline();
  for (const leg of legs) for (const seat of seats) pipeline.set(holdKey(rideId, leg, seat), bookingId, "PX", Math.max(1, remainingMs));
  await pipeline.exec();
}

export async function releaseHold(rideId: string, legs: number[], seats: number[]): Promise<void> {
  const keys = legs.flatMap((leg) => seats.map((seat) => holdKey(rideId, leg, seat)));
  if (keys.length) await valkey.del(...keys);
}

export async function restoreHold(rideId: string, legs: number[], seats: number[], bookingId: string, remainingMs: number): Promise<void> {
  const pipeline = valkey.pipeline();
  for (const leg of legs) for (const seat of seats) pipeline.set(holdKey(rideId, leg, seat), bookingId, "PX", Math.max(1, remainingMs), "NX");
  await pipeline.exec();
}

export async function setRequestDeadline(bookingId: string, deadlineMs: number): Promise<void> {
  await valkey.zadd(REQUEST_DEADLINES, deadlineMs, bookingId);
}

export async function clearRequestDeadline(bookingId: string): Promise<void> {
  await valkey.zrem(REQUEST_DEADLINES, bookingId);
}

export async function restoreRate(key: string, entries: { member: string; scoreMs: number }[]): Promise<void> {
  if (!entries.length) return;
  const have = await valkey.zcard(key);
  if (have >= entries.length) return;
  await valkey.zadd(key, ...entries.flatMap((entry) => [entry.scoreMs, entry.member]));
}

export async function markOnline(bookingId: string, memberId: string): Promise<void> {
  await valkey.sadd(presenceKey(bookingId), memberId);
}

export async function markOffline(bookingId: string, memberId: string, seenAtIso: string): Promise<void> {
  await valkey.srem(presenceKey(bookingId), memberId);
  await valkey.hset(LAST_SEEN, `${bookingId}:${memberId}`, seenAtIso);
}

export async function presenceOf(bookingId: string, memberId: string): Promise<{ online: boolean; lastSeen: string | null }> {
  const [online, lastSeen] = await Promise.all([valkey.sismember(presenceKey(bookingId), memberId), valkey.hget(LAST_SEEN, `${bookingId}:${memberId}`)]);
  return { online: online === 1, lastSeen };
}
