import { createClient, type RedisClientType } from 'redis';
import { config, names, namespaced } from '../config.js';

const client: RedisClientType = createClient({
  url: config.valkeyUrl,
  socket: { reconnectStrategy: (retries) => Math.min(1000, 100 * (retries + 1)) },
});
client.on('error', () => undefined);

export function startValkey(): void {
  void client.connect().catch(() => undefined);
}

export function valkeyUp(): boolean {
  return client.isReady;
}

export interface HoldClaim {
  token: string;
  remainingMs: number;
}

/** Set-if-absent with a TTL: exactly one reach for a number wins. */
export async function takeHold(boxNumber: number, token: string, holdSeconds: number): Promise<boolean> {
  const reply = await client.set(names.holdKey(boxNumber), token, { NX: true, EX: holdSeconds });
  return reply === 'OK';
}

export async function readHold(boxNumber: number): Promise<HoldClaim | null> {
  const key = names.holdKey(boxNumber);
  const token = await client.get(key);
  if (token === null) return null;
  const ttl = await client.pTTL(key);
  if (ttl < 0) return null;
  return { token, remainingMs: ttl };
}

export async function releaseHold(boxNumber: number): Promise<void> {
  await client.del(names.holdKey(boxNumber));
}

export async function liveHoldNumbers(): Promise<Set<number>> {
  const prefix = namespaced('hold:');
  const found = new Set<number>();
  for await (const batch of client.scanIterator({ MATCH: `${prefix}*`, COUNT: 500 })) {
    for (const key of Array.isArray(batch) ? batch : [batch]) {
      const number = Number.parseInt(String(key).slice(prefix.length), 10);
      if (Number.isInteger(number)) found.add(number);
    }
  }
  return found;
}

export async function countRefusedLookup(clientKey: string, windowSeconds: number): Promise<void> {
  const key = names.lookupKey(clientKey);
  const count = await client.incr(key);
  if (count === 1) await client.expire(key, windowSeconds);
}

export async function readRefusedLookups(clientKey: string): Promise<{ count: number; ttl: number }> {
  const key = names.lookupKey(clientKey);
  const raw = await client.get(key);
  const ttl = await client.ttl(key);
  return { count: raw === null ? 0 : Number.parseInt(raw, 10), ttl: ttl < 0 ? 1 : ttl };
}
