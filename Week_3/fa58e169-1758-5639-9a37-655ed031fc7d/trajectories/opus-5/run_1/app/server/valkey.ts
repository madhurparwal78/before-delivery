import Redis from 'ioredis';
import { config, limits } from './config';

const options = {
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  commandTimeout: 800,
  retryStrategy: (attempt: number): number => Math.min(500 * attempt, 2000),
  reconnectOnError: (): boolean => true,
};

export const valkey = new Redis(config.valkeyUrl, options);
const subscriber = new Redis(config.valkeyUrl, options);

let listener: ((patternId: string, message: string) => void) | null = null;
let liveState = false;
const liveWatchers = new Set<(on: boolean) => void>();

function setLive(on: boolean): void {
  if (liveState === on) return;
  liveState = on;
  for (const watcher of liveWatchers) watcher(on);
}

export function liveUpdatesOn(): boolean {
  return liveState;
}

export function watchLive(watcher: (on: boolean) => void): () => void {
  liveWatchers.add(watcher);
  return () => liveWatchers.delete(watcher);
}

export function startValkey(): void {
  const quiet = (): void => undefined;
  valkey.on('error', quiet);
  subscriber.on('error', quiet);
  valkey.on('end', () => setLive(false));
  subscriber.on('message', (channel: string, message: string) => {
    const patternId = channel.slice('pattern:'.length);
    listener?.(patternId, message);
  });
  subscriber.on('ready', () => {
    void subscriber.psubscribe('pattern:*').catch(quiet);
  });
  subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
    const patternId = channel.slice('pattern:'.length);
    listener?.(patternId, message);
  });
  valkey.connect().catch(quiet);
  subscriber.connect().catch(quiet);
  setInterval(() => {
    void probe();
  }, 1000).unref();
  void probe();
}

async function probe(): Promise<void> {
  try {
    await valkey.ping();
    setLive(true);
    if (subscriber.status === 'end' || subscriber.status === 'close') {
      subscriber.connect().catch(() => undefined);
    }
  } catch {
    setLive(false);
    if (valkey.status === 'end' || valkey.status === 'close') {
      valkey.connect().catch(() => undefined);
    }
  }
}

export function onPatternMessage(handler: (patternId: string, message: string) => void): void {
  listener = handler;
}

export async function publishPattern(patternId: string, message: unknown): Promise<void> {
  try {
    await valkey.publish(`pattern:${patternId}`, JSON.stringify(message));
  } catch {
    setLive(false);
  }
}

export async function presenceJoin(patternId: string, userId: string, name: string): Promise<void> {
  try {
    await valkey.hset(`presence:${patternId}`, userId, name);
    await valkey.expire(`presence:${patternId}`, limits.presenceTtlSeconds);
  } catch {
    setLive(false);
  }
}

export async function presenceTouch(patternId: string): Promise<void> {
  try {
    await valkey.expire(`presence:${patternId}`, limits.presenceTtlSeconds);
  } catch {
    setLive(false);
  }
}

export async function presenceLeave(patternId: string, userId: string): Promise<void> {
  try {
    await valkey.hdel(`presence:${patternId}`, userId);
  } catch {
    setLive(false);
  }
}

export async function presenceList(patternId: string): Promise<Record<string, string> | null> {
  try {
    return await valkey.hgetall(`presence:${patternId}`);
  } catch {
    setLive(false);
    return null;
  }
}

const STEP_SCRIPT = `
local current = redis.call('get', KEYS[1])
if not current then return -1 end
local from = tonumber(ARGV[1])
local step = tonumber(ARGV[2])
local total = tonumber(ARGV[3])
local row = tonumber(current)
if row ~= from then return row end
local next = row + step
if next < 1 or next > total then return row end
redis.call('set', KEYS[1], next)
return next
`;

/** Compares and moves the tester's row in Valkey. Null when Valkey cannot answer. */
export async function counterStep(
  patternId: string,
  userId: string,
  from: number,
  step: number,
  total: number,
  loadRow: () => Promise<number>,
): Promise<number | null> {
  const key = `counter:${patternId}:${userId}`;
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = (await valkey.eval(STEP_SCRIPT, 1, key, from, step, total)) as number;
      if (result !== -1) return result;
      const stored = await loadRow();
      await valkey.set(key, stored);
    }
    return null;
  } catch {
    setLive(false);
    return null;
  }
}

export async function counterSet(patternId: string, userId: string, row: number): Promise<void> {
  try {
    await valkey.set(`counter:${patternId}:${userId}`, row);
  } catch {
    setLive(false);
  }
}
