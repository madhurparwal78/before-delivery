import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { config } from "./config.js";

const options = { maxRetriesPerRequest: 2, lazyConnect: false } as const;
const valkey = new Redis(config.valkeyUrl, options);
const subscriber = new Redis(config.valkeyUrl, options);
valkey.on("error", (error: Error) => console.error("valkey:", error.message));
subscriber.on("error", (error: Error) => console.error("valkey subscriber:", error.message));

// ---- rate limits: one token bucket per API key, `ratelimit:<key id>` {rate, tokens, updated_ms} ----

const rateKey = (keyId: string): string => `ratelimit:${keyId}`;

const TAKE = `
local rate = tonumber(redis.call('HGET', KEYS[1], 'rate'))
if not rate then return -1 end
local now = tonumber(ARGV[1])
local tokens = tonumber(redis.call('HGET', KEYS[1], 'tokens') or rate)
local updated = tonumber(redis.call('HGET', KEYS[1], 'updated_ms') or now)
tokens = math.min(rate, tokens + (now - updated) * rate / 1000)
if tokens >= 1 then
  redis.call('HSET', KEYS[1], 'tokens', tostring(tokens - 1), 'updated_ms', tostring(now))
  return 0
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'updated_ms', tostring(now))
return math.ceil((1 - tokens) * 1000 / rate)
`;

/** 0 when the request may pass, otherwise the milliseconds until a token is available. */
export async function takeToken(keyId: string): Promise<number> {
  const result = (await valkey.eval(TAKE, 1, rateKey(keyId), String(Date.now()))) as number;
  return Math.max(result, 0);
}

export async function createBucket(keyId: string, rate: number): Promise<void> {
  await valkey.hset(rateKey(keyId), { rate: String(rate), tokens: String(rate), updated_ms: String(Date.now()) });
}

export async function setRates(keyIds: readonly string[], rate: number): Promise<void> {
  if (keyIds.length === 0) return;
  const pipeline = valkey.pipeline();
  for (const id of keyIds) pipeline.hset(rateKey(id), "rate", String(rate));
  await pipeline.exec();
}

export async function deleteBucket(keyId: string): Promise<void> {
  await valkey.del(rateKey(keyId));
}

// ---- startup lock: instances on different databases share one Keycloak realm and one Kill Bill tenant ----

const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;

/** Runs `work` while holding `lock:<name>` across every instance; the lock lapses after 60 s if its holder dies. */
export async function withSharedLock<T>(name: string, work: () => Promise<T>): Promise<T> {
  const key = `lock:${name}`;
  const token = randomUUID();
  while ((await valkey.set(key, token, "PX", 60_000, "NX")) !== "OK") await new Promise((resolve) => setTimeout(resolve, 200));
  try {
    return await work();
  } finally {
    await valkey.eval(RELEASE, 1, key, token);
  }
}

// ---- live fan-out: market:<id> and member:<id> channels relayed to open streams ----

type Listener = (event: string, data: unknown) => void;
const listeners = new Map<string, Set<Listener>>();

subscriber.on("message", (channel: string, message: string) => {
  const { event, data } = JSON.parse(message) as { event: string; data: unknown };
  for (const listener of listeners.get(channel) ?? []) listener(event, data);
});

export async function listen(channel: string, listener: Listener): Promise<() => void> {
  let set = listeners.get(channel);
  if (!set) {
    set = new Set();
    listeners.set(channel, set);
    await subscriber.subscribe(channel);
  }
  set.add(listener);
  return () => {
    const current = listeners.get(channel);
    current?.delete(listener);
    if (current && current.size === 0) {
      listeners.delete(channel);
      void subscriber.unsubscribe(channel);
    }
  };
}

export function publish(channel: string, event: string, data: unknown): void {
  valkey.publish(channel, JSON.stringify({ event, data })).catch((error: Error) => console.error("publish:", error.message));
}

export async function reachable(): Promise<boolean> {
  try {
    return (await Promise.race([valkey.ping(), new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 2000))])) === "PONG";
  } catch {
    return false;
  }
}
