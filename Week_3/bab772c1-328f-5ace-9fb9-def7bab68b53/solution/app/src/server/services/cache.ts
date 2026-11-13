/** Valkey: the share rate-limit window and reader presence. */

import { Redis } from "ioredis";
import { config } from "../config.js";

export const RATE_LIMIT = 120;
export const RATE_WINDOW_SECONDS = 60;
const READER_TTL_SECONDS = 30;

const client = new Redis(config.valkeyUrl, {
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  commandTimeout: 3000,
  retryStrategy: (attempt: number) => Math.min(1000 * attempt, 5000),
});
client.on("error", () => undefined);
void client.connect().catch(() => undefined);

export async function probeCache(): Promise<boolean> {
  try {
    await client.ping();
    return true;
  } catch {
    return false;
  }
}

type RateDecision = {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
};

const RATE_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('zremrangebyscore', key, 0, now - windowMs)
local counted = redis.call('zcard', key)
if counted >= limit then
  local oldest = redis.call('zrange', key, 0, 0, 'WITHSCORES')
  local reset = 1
  if oldest[2] then
    reset = math.ceil((tonumber(oldest[2]) + windowMs - now) / 1000)
    if reset < 1 then reset = 1 end
  end
  return {0, 0, reset}
end
redis.call('zadd', key, now, member)
redis.call('pexpire', key, windowMs)
local total = counted + 1
local oldest = redis.call('zrange', key, 0, 0, 'WITHSCORES')
local reset = 1
if oldest[2] then
  reset = math.ceil((tonumber(oldest[2]) + windowMs - now) / 1000)
  if reset < 1 then reset = 1 end
end
return {1, limit - total, reset}
`;

/** Counts one share request against its token's rolling window, atomically. */
export async function countShareRequest(token: string): Promise<RateDecision | null> {
  try {
    const now = Date.now();
    const result = (await client.eval(
      RATE_SCRIPT,
      1,
      `perilune:share-rate:${token}`,
      String(now),
      String(RATE_WINDOW_SECONDS * 1000),
      String(RATE_LIMIT),
      `${now}-${Math.random().toString(36).slice(2)}`,
    )) as [number, number, number];
    return { allowed: result[0] === 1, remaining: result[1], resetSeconds: result[2] };
  } catch {
    return null;
  }
}

function readerKey(missionId: string, streamId: string): string {
  return `perilune:reader:${missionId}:${streamId}`;
}

export async function touchReader(missionId: string, streamId: string): Promise<void> {
  try {
    await client.set(readerKey(missionId, streamId), "1", "EX", READER_TTL_SECONDS);
  } catch {
    /* a reader the cache cannot hold is simply not counted */
  }
}

export async function releaseReader(missionId: string, streamId: string): Promise<void> {
  try {
    await client.del(readerKey(missionId, streamId));
  } catch {
    /* the key expires on its own */
  }
}

/** The number of open share streams of the mission, or null while the cache is down. */
export async function countReaders(missionId: string): Promise<number | null> {
  try {
    const pattern = `perilune:reader:${missionId}:*`;
    let cursor = "0";
    let total = 0;
    do {
      const [next, keys] = await client.scan(cursor, "MATCH", pattern, "COUNT", 500);
      cursor = next;
      total += keys.length;
    } while (cursor !== "0");
    return total;
  } catch {
    return null;
  }
}
