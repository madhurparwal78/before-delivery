import { createClient, type RedisClientType } from 'redis';
import { config } from './config.js';

/**
 * Two connections: one for commands (locks, presence, publish), one for
 * pub/sub. A client that subscribes refuses all other commands.
 */
function makeClient(): RedisClientType {
  return createClient({
    url: config.valkeyUrl,
    socket: {
      connectTimeout: 2000,
      // keep retrying forever; the app must pick the service up again
      reconnectStrategy: (times: number) => Math.min(1000 + times * 500, 10_000),
    },
  }) as unknown as RedisClientType;
}

export const redis = makeClient();
let subRedis: RedisClientType | null = null;

redis.on('error', () => { /* availability tracked by the probe */ });

let connected = false;
redis.on('ready', () => { connected = true; });
redis.on('end', () => { connected = false; });
redis.on('reconnecting', () => { connected = false; });

export function valkeyAvailable(): boolean { return connected && redis.isReady; }

/** Probe with a hard timeout so health always answers. */
export async function checkValkey(): Promise<boolean> {
  const probe = (async (): Promise<boolean> => {
    try {
      if (!redis.isOpen) {
        await redis.connect();
      }
      if (!redis.isReady) return false;
      await redis.ping();
      return true;
    } catch {
      return false;
    }
  })();
  const timeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), 3000));
  const ok = await Promise.race([probe, timeout]);
  connected = ok;
  return ok;
}

/** The subscriber connection, created once. */
async function subscriber(): Promise<RedisClientType> {
  if (subRedis && subRedis.isOpen && subRedis.isReady) return subRedis;
  if (!subRedis) {
    subRedis = makeClient();
    subRedis.on('error', () => undefined);
  }
  if (!subRedis.isOpen) {
    await subRedis.connect();
  }
  return subRedis;
}

export async function subscribe(
  channel: string,
  handler: (message: string) => void
): Promise<() => void> {
  const sub = await subscriber();
  const fn = (message: string, _channel: string): void => handler(message);
  await sub.subscribe(channel, fn);
  return () => {
    void sub.unsubscribe(channel, fn).catch(() => undefined);
  };
}

/** Command guard: fail fast (as unavailable) instead of queueing forever. */
export async function guard<T>(p: Promise<T>, ms = 2000): Promise<T | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));
  return Promise.race([p.catch(() => null), timeout]);
}

export async function publish(channel: string, message: string): Promise<void> {
  if (!valkeyAvailable()) return; // events are dropped while down
  await guard(redis.publish(channel, message));
}

export const roomChannel = (roomId: string) => `room:${roomId}`;
export const sessionChannel = (sessionId: string) => `playtest:${sessionId}`;
