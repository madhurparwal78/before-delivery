import Redis from 'ioredis';
import { config } from './config.js';
import { ApiError, Err } from './errors.js';
import { LOCK_TTL_SECONDS, PRESENCE_TTL_SECONDS } from '../shared/domain.js';

/** Valkey carries presence, lock leases and the fan-out of committed ops. */

const LOCK_TTL_MS = LOCK_TTL_SECONDS * 1000;

function createClient(): Redis {
  const client = new Redis(config.valkeyUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: () => 2000,
    reconnectOnError: () => true,
  });
  client.on('error', () => {
    collabOk = false;
  });
  client.on('ready', () => {
    collabOk = true;
  });
  return client;
}

let collabOk = false;
let commands: Redis | null = null;
let subscriber: Redis | null = null;

export function collabHealthy(): boolean {
  return collabOk;
}

function client(): Redis {
  if (commands === null || !collabOk) throw Err.collabOffline();
  return commands;
}

async function run<T>(work: (redis: Redis) => Promise<T>): Promise<T> {
  try {
    return await work(client());
  } catch (error) {
    if (error instanceof ApiError) throw error;
    collabOk = false;
    throw Err.collabOffline();
  }
}

export const lockKey = (setId: string, layerId: string): string => `afterglass:lock:${setId}:${layerId}`;
export const presenceKey = (setId: string, userId: string): string => `afterglass:presence:${setId}:${userId}`;
export const setChannel = (setId: string): string => `afterglass:set:${setId}`;

export interface LeaseHolder {
  userId: string;
  expiresAt: Date;
}

interface TrackedLease {
  setId: string;
  layerId: string;
  userId: string;
  expiresAt: number;
}

const tracked = new Map<string, TrackedLease>();

export async function acquireLease(setId: string, layerId: string, userId: string): Promise<LeaseHolder | null> {
  return run(async (redis) => {
    const key = lockKey(setId, layerId);
    const result = await redis.set(key, userId, 'PX', LOCK_TTL_MS, 'NX');
    if (result === 'OK') {
      const expiresAt = new Date(Date.now() + LOCK_TTL_MS);
      tracked.set(key, { setId, layerId, userId, expiresAt: expiresAt.getTime() });
      return { userId, expiresAt };
    }
    const holder = await redis.get(key);
    if (holder === null) {
      const retry = await redis.set(key, userId, 'PX', LOCK_TTL_MS, 'NX');
      if (retry === 'OK') {
        const expiresAt = new Date(Date.now() + LOCK_TTL_MS);
        tracked.set(key, { setId, layerId, userId, expiresAt: expiresAt.getTime() });
        return { userId, expiresAt };
      }
      return null;
    }
    if (holder === userId) {
      await redis.pexpire(key, LOCK_TTL_MS);
      const expiresAt = new Date(Date.now() + LOCK_TTL_MS);
      tracked.set(key, { setId, layerId, userId, expiresAt: expiresAt.getTime() });
      return { userId, expiresAt };
    }
    return null;
  });
}

export async function readLease(setId: string, layerId: string): Promise<LeaseHolder | null> {
  return run(async (redis) => {
    const key = lockKey(setId, layerId);
    const holder = await redis.get(key);
    if (holder === null) return null;
    const ttl = await redis.pttl(key);
    return { userId: holder, expiresAt: new Date(Date.now() + Math.max(0, ttl)) };
  });
}

const RENEW = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

export async function renewLease(setId: string, layerId: string, userId: string): Promise<Date | null> {
  return run(async (redis) => {
    const key = lockKey(setId, layerId);
    const result = await redis.eval(RENEW, 1, key, userId, String(LOCK_TTL_MS));
    if (result !== 1) return null;
    const expiresAt = new Date(Date.now() + LOCK_TTL_MS);
    tracked.set(key, { setId, layerId, userId, expiresAt: expiresAt.getTime() });
    return expiresAt;
  });
}

export async function releaseLease(setId: string, layerId: string, userId: string | null): Promise<boolean> {
  return run(async (redis) => {
    const key = lockKey(setId, layerId);
    const removed =
      userId === null ? await redis.del(key) : ((await redis.eval(RELEASE, 1, key, userId)) as number);
    if (removed === 1) tracked.delete(key);
    return removed === 1;
  });
}

/** Removing a layer frees its lock; ignored while collaboration is offline. */
export async function dropLeaseQuietly(setId: string, layerId: string): Promise<void> {
  if (commands === null || !collabOk) return;
  try {
    await commands.del(lockKey(setId, layerId));
    tracked.delete(lockKey(setId, layerId));
  } catch {
    collabOk = false;
  }
}

export async function listLeases(setId: string): Promise<{ layerId: string; userId: string; expiresAt: Date }[]> {
  return run(async (redis) => {
    const prefix = `afterglass:lock:${setId}:`;
    const found: { layerId: string; userId: string; expiresAt: Date }[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
      cursor = next;
      for (const key of batch) {
        const holder = await redis.get(key);
        if (holder === null) continue;
        const ttl = await redis.pttl(key);
        found.push({
          layerId: key.slice(prefix.length),
          userId: holder,
          expiresAt: new Date(Date.now() + Math.max(0, ttl)),
        });
      }
    } while (cursor !== '0');
    return found;
  });
}

export interface PresenceRecord {
  display_name: string;
  colour: string;
  selection: string | null;
}

export async function writePresence(setId: string, userId: string, record: PresenceRecord): Promise<void> {
  await run(async (redis) => {
    await redis.set(presenceKey(setId, userId), JSON.stringify(record), 'EX', PRESENCE_TTL_SECONDS);
  });
}

export async function readPresence(setId: string): Promise<{ userId: string; record: PresenceRecord }[]> {
  return run(async (redis) => {
    const prefix = `afterglass:presence:${setId}:`;
    const members: { userId: string; record: PresenceRecord }[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
      cursor = next;
      for (const key of batch) {
        const raw = await redis.get(key);
        if (raw === null) continue;
        members.push({ userId: key.slice(prefix.length), record: JSON.parse(raw) as PresenceRecord });
      }
    } while (cursor !== '0');
    return members;
  });
}

export async function publish(setId: string, message: unknown): Promise<void> {
  if (commands === null || !collabOk) return;
  try {
    await commands.publish(setChannel(setId), JSON.stringify(message));
  } catch {
    collabOk = false;
  }
}

type Relay = (setId: string, message: unknown) => void;
type ExpiryHandler = (setId: string, layerId: string, userId: string) => void;

export function startCollab(relay: Relay, onExpiry: ExpiryHandler): void {
  commands = createClient();
  subscriber = createClient();
  void commands.connect().catch(() => undefined);
  void subscriber
    .connect()
    .then(() => subscriber?.psubscribe('afterglass:set:*'))
    .catch(() => undefined);
  subscriber.on('pmessage', (_pattern, channel: string, raw: string) => {
    const setId = channel.slice('afterglass:set:'.length);
    relay(setId, JSON.parse(raw) as unknown);
  });
  subscriber.on('ready', () => {
    void subscriber?.psubscribe('afterglass:set:*').catch(() => undefined);
  });

  setInterval(() => {
    void (async () => {
      if (commands === null) return;
      try {
        await commands.ping();
        collabOk = true;
      } catch {
        collabOk = false;
        void commands.connect().catch(() => undefined);
      }
    })();
  }, 5000).unref();

  setInterval(() => {
    void (async () => {
      const now = Date.now();
      for (const [key, lease] of [...tracked]) {
        if (lease.expiresAt > now) continue;
        if (commands === null || !collabOk) continue;
        try {
          const holder = await commands.get(key);
          if (holder === null) {
            tracked.delete(key);
            onExpiry(lease.setId, lease.layerId, lease.userId);
          }
        } catch {
          collabOk = false;
        }
      }
    })();
  }, 1000).unref();
}
