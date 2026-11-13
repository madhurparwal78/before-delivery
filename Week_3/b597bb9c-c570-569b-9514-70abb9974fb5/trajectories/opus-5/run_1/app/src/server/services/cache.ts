/**
 * Valkey: the shared allowance counters, waveform peaks and read-token rate windows.
 */
import Redis from 'ioredis';
import { config } from '../config.js';

export const valkey = new Redis(config.valkeyUrl, {
  lazyConnect: false,
  maxRetriesPerRequest: 2,
  enableOfflineQueue: true,
});

valkey.on('error', () => {
  /* ioredis reconnects on its own; callers see the rejected promise */
});

export const CacheKeys = {
  exportMinutes: (workspaceId: string, month: string): string => `gatecut:${workspaceId}:export-minutes:${month}`,
  storageBytes: (workspaceId: string): string => `gatecut:${workspaceId}:storage-bytes`,
  peaks: (sha256: string): string => `gatecut:peaks:${sha256}`,
  rate: (tokenId: string, window: number): string => `gatecut:rate:${tokenId}:${window}`,
};

export const EXPORT_MINUTES_TTL_SECONDS = 40 * 24 * 60 * 60;
export const RATE_WINDOW_SECONDS = 10;
export const RATE_KEY_TTL_SECONDS = 20;

/**
 * Take an amount from a counter only when the result stays inside the limit.
 * Returns the used amount, and whether this call took it.
 */
const TAKE_SCRIPT = `
local used = tonumber(redis.call('get', KEYS[1]) or '-1')
if used < 0 then
  return {-1, 0}
end
local amount = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
if used + amount > limit then
  return {used, 0}
end
redis.call('incrby', KEYS[1], amount)
return {used + amount, 1}
`;

export async function takeFromCounter(
  key: string,
  amount: number,
  limit: number,
): Promise<{ used: number; taken: boolean }> {
  const result = (await valkey.eval(TAKE_SCRIPT, 1, key, String(amount), String(limit))) as [number, number];
  return { used: Number(result[0]), taken: result[1] === 1 };
}

export async function giveBackToCounter(key: string, amount: number): Promise<void> {
  await valkey.decrby(key, amount);
}

export async function readCounter(key: string): Promise<number | null> {
  const value = await valkey.get(key);
  return value === null ? null : Number(value);
}

export async function setCounter(key: string, value: number, ttlSeconds?: number): Promise<void> {
  if (ttlSeconds === undefined) await valkey.set(key, String(value));
  else await valkey.set(key, String(value), 'EX', ttlSeconds);
}

export async function countRequest(tokenId: string, nowSeconds: number): Promise<{ count: number; window: number }> {
  const window = Math.floor(nowSeconds / RATE_WINDOW_SECONDS);
  const key = CacheKeys.rate(tokenId, window);
  const count = await valkey.incr(key);
  if (count === 1) await valkey.expire(key, RATE_KEY_TTL_SECONDS);
  return { count, window };
}

export async function readRequestCount(tokenId: string, nowSeconds: number): Promise<number> {
  const window = Math.floor(nowSeconds / RATE_WINDOW_SECONDS);
  const value = await valkey.get(CacheKeys.rate(tokenId, window));
  return value === null ? 0 : Number(value);
}
