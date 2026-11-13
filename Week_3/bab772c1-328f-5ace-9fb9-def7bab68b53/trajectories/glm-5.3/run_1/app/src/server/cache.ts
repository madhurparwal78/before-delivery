// Valkey: the share rate limit and the live reader count. Both are written
// once here and shared by every app instance.

import { createClient } from "redis";
import { DependencyError, optionalEnv, requireEnv } from "./deps.js";

let client: ReturnType<typeof createClient> | null = null;
let connecting: Promise<ReturnType<typeof createClient>> | null = null;

export async function valkey(): Promise<ReturnType<typeof createClient>> {
  if (client && client.isReady) return client;
  if (connecting) {
    try {
      return await connecting;
    } catch {
      connecting = null;
    }
  }
  if (client && !client.isReady) {
    try {
      await client.disconnect();
    } catch {
      // Already closed.
    }
    client = null;
  }
  const url = requireEnv("VALKEY_URL");
  const next = createClient({ url });
  connecting = next
    .connect()
    .then((connected) => {
      client = connected;
      connected.on("error", () => {
        // Swallowed: probed live on each status call.
      });
      return connected;
    })
    .catch((err) => {
      connecting = null;
      throw err;
    });
  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

async function run<T>(fn: (c: ReturnType<typeof createClient>) => Promise<T>): Promise<T> {
  const c = await valkey();
  try {
    return await fn(c);
  } catch {
    throw new DependencyError("cache");
  }
}

// ---- Share rate limit ----
// One atomic Lua script: the check and the count in one operation.

const RATE_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local id = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
local function resetSeconds()
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  if not oldest[2] then return 1 end
  local seconds = math.ceil((tonumber(oldest[2]) + window - now) / 1000)
  if seconds < 1 then return 1 end
  return seconds
end
if count >= limit then
  return {0, resetSeconds()}
end
redis.call('ZADD', key, now, id)
redis.call('PEXPIRE', key, window + 1000)
local remaining = limit - redis.call('ZCARD', key)
return {1, remaining, resetSeconds()}
`;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
}

export async function consumeRateLimit(token: string): Promise<RateLimitResult> {
  return run(async (c) => {
    const result = (await c.eval(RATE_SCRIPT, {
      keys: [`perilune:share-rate:${token}`],
      arguments: [
        String(Date.now()),
        "60000",
        "120",
        `${Date.now()}:${Math.random().toString(36).slice(2)}`,
      ],
    })) as number[];
    if (result.length === 2 && result[0] === 0) {
      return { allowed: false, remaining: 0, resetSeconds: result[1] };
    }
    return { allowed: true, remaining: result[1], resetSeconds: result[2] };
  });
}

// The check and the count are one atomic operation. While the cache is
// unreachable, share routes are served without a limit and without fields.
export async function consumeRateLimitFailOpen(token: string): Promise<RateLimitResult | null> {
  try {
    return await consumeRateLimit(token);
  } catch {
    return null;
  }
}

// ---- Reader presence ----

export async function registerReader(
  missionId: string,
  streamId: string,
): Promise<void> {
  await run(async (c) => {
    const key = `perilune:reader:${missionId}:${streamId}`;
    await c.set(key, "1", { EX: 30 });
  });
}

export async function renewReader(missionId: string, streamId: string): Promise<void> {
  await registerReader(missionId, streamId);
}

export async function releaseReader(missionId: string, streamId: string): Promise<void> {
  await run(async (c) => {
    await c.del(`perilune:reader:${missionId}:${streamId}`);
  });
}

export async function readerCount(missionId: string): Promise<number | null> {
  return run(async (c) => {
    const keys = await c.keys(`perilune:reader:${missionId}:*`);
    return keys.length;
  });
}

export async function probeCache(): Promise<boolean> {
  try {
    const c = await valkey();
    await c.ping();
    return true;
  } catch {
    return false;
  }
}
