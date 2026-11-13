import Redis from 'ioredis';

const url = process.env.VALKEY_URL ?? 'redis://127.0.0.1:6379';

const redis = new Redis(url, {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  lazyConnect: false,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});

redis.on('error', () => {
  /* status polled through locksStatus */
});

export const LOCK_TTL = Number(process.env.LOCK_TTL_SECONDS ?? 30);
export const PRESENCE_TTL = Number(process.env.PRESENCE_TTL_SECONDS ?? 20);

export type LockRecord = { userId: string; displayName: string; tab: string; fence: number };
export type PresenceRecord = { displayName: string; cursor: [number, number, number] | null; selected: string | null };

export async function redisAvailable(): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}


export class LockHeld extends Error {
  constructor(public holder: LockRecord) {
    super('lock held');
  }
}

export async function takeLease(sceneId: string, objectId: string, rec: Omit<LockRecord, 'fence'>): Promise<LockRecord> {
  const key = `rw:lock:${sceneId}:${objectId}`;
  const fenceKey = `rw:fence:${sceneId}:${objectId}`;
  const value = JSON.stringify(rec);
  // Grant only when free (SET NX); a live lease renews with its own fence.
  const current = await redis.get(key);
  if (current === null) {
    const result = await redis.set(key, value, 'EX', LOCK_TTL, 'NX');
    if (result === 'OK') {
      const fence = await redis.incr(fenceKey);
      const granted: LockRecord = { ...rec, fence };
      await redis.set(key, JSON.stringify(granted), 'EX', LOCK_TTL);
      return granted;
    }
    const retry = await redis.get(key);
    if (retry) {
      const parsed = JSON.parse(retry) as LockRecord;
      if (parsed.userId === rec.userId && parsed.tab === rec.tab) {
        await redis.set(key, retry, 'EX', LOCK_TTL);
        return parsed;
      }
      throw new LockHeld(parsed);
    }
    // expired between the calls; grant now
    const fence = await redis.incr(fenceKey);
    const granted: LockRecord = { ...rec, fence };
    await redis.set(key, JSON.stringify(granted), 'EX', LOCK_TTL);
    return granted;
  }
  const parsed = JSON.parse(current) as LockRecord;
  if (parsed.userId === rec.userId && parsed.tab === rec.tab) {
    await redis.set(key, current, 'EX', LOCK_TTL);
    return parsed;
  }
  throw new LockHeld(parsed);
}

export async function releaseLease(sceneId: string, objectId: string, userId: string, tab: string): Promise<boolean> {
  const key = `rw:lock:${sceneId}:${objectId}`;
  const current = await redis.get(key);
  if (!current) return true;
  const parsed = JSON.parse(current) as LockRecord;
  if (parsed.userId === userId && parsed.tab === tab) {
    await redis.del(key);
    return true;
  }
  return false;
}

export async function getLock(sceneId: string, objectId: string): Promise<LockRecord | null> {
  const current = await redis.get(`rw:lock:${sceneId}:${objectId}`);
  return current ? (JSON.parse(current) as LockRecord) : null;
}

export async function listLocks(sceneId: string, objectIds: string[]): Promise<Array<{ objectId: string; holder: LockRecord }>> {
  if (objectIds.length === 0) return [];
  const keys = objectIds.map((id) => `rw:lock:${sceneId}:${id}`);
  const values = await redis.mget(...keys);
  const out: Array<{ objectId: string; holder: LockRecord }> = [];
  values.forEach((v, i) => {
    if (v) out.push({ objectId: objectIds[i]!, holder: JSON.parse(v) as LockRecord });
  });
  return out;
}

export async function setPresence(sceneId: string, userId: string, tab: string, rec: PresenceRecord): Promise<void> {
  await redis.set(`rw:presence:${sceneId}:${userId}:${tab}`, JSON.stringify(rec), 'EX', PRESENCE_TTL);
}

export async function dropPresence(sceneId: string, userId: string, tab: string): Promise<void> {
  await redis.del(`rw:presence:${sceneId}:${userId}:${tab}`);
}

export async function releaseAllLeasesForTab(sceneId: string, userId: string, tab: string): Promise<string[]> {
  // Scan the scene's locks and release any held under this tab.
  const pattern = `rw:lock:${sceneId}:*`;
  const released: string[] = [];
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
    cursor = next;
    for (const key of keys) {
      const value = await redis.get(key);
      if (!value) continue;
      const parsed = JSON.parse(value) as LockRecord;
      if (parsed.userId === userId && parsed.tab === tab) {
        await redis.del(key);
        released.push(key.slice(`rw:lock:${sceneId}:`.length));
      }
    }
  } while (cursor !== '0');
  return released;
}

export async function releaseAllLeasesForUser(userId: string): Promise<Array<{ sceneId: string; objectId: string }>> {
  // Used on demotion; scans are scoped per scene by callers.
  const released: Array<{ sceneId: string; objectId: string }> = [];
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `rw:lock:*`, 'COUNT', 500);
    cursor = next;
    for (const key of keys) {
      const value = await redis.get(key);
      if (!value) continue;
      const parsed = JSON.parse(value) as LockRecord;
      if (parsed.userId === userId) {
        await redis.del(key);
        const rest = key.slice('rw:lock:'.length);
        const idx = rest.indexOf(':');
        released.push({ sceneId: rest.slice(0, idx), objectId: rest.slice(idx + 1) });
      }
    }
  } while (cursor !== '0');
  return released;
}

export async function listPresence(sceneId: string): Promise<Array<{ userId: string; tab: string; rec: PresenceRecord }>> {
  const pattern = `rw:presence:${sceneId}:*`;
  const out: Array<{ userId: string; tab: string; rec: PresenceRecord }> = [];
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
    cursor = next;
    for (const key of keys) {
      const value = await redis.get(key);
      if (!value) continue;
      const rest = key.slice(`rw:presence:${sceneId}:`.length);
      const idx = rest.lastIndexOf(':');
      const userId = rest.slice(0, idx);
      const tab = rest.slice(idx + 1);
      out.push({ userId, tab, rec: JSON.parse(value) as PresenceRecord });
    }
  } while (cursor !== '0');
  return out;
}

export async function locksStatus(): Promise<'ok' | 'down'> {
  return (await redisAvailable()) ? 'ok' : 'down';
}

export async function runWithLocksCheck<T>(fn: () => Promise<T>): Promise<T> {
  if (!(await redisAvailable())) {
    const err = new Error('lock store unavailable') as Error & { storeDown?: boolean };
    err.storeDown = true;
    throw err;
  }
  return fn();
}
