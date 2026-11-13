import { Redis } from "ioredis";
import { config } from "../config";
import { LockStoreError } from "../errors";

interface LockValue {
  userId: string;
  displayName: string;
  tab: string | null;
  fence: number;
}
export interface LockEntry extends LockValue {
  objectId: string;
  expiresAt: string;
}
interface PresenceValue {
  displayName: string;
  cursor: [number, number, number] | null;
  selected: string | null;
}
export interface PresenceEntry extends PresenceValue {
  userId: string;
  tab: string;
}

const client = new Redis(config.valkeyUrl, {
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  connectTimeout: 2000,
  commandTimeout: 2000,
  retryStrategy: (times) => Math.min(100 * times, 500),
});
client.on("error", () => undefined);
client.connect().catch(() => undefined);

client.defineCommand("grantLock", {
  numberOfKeys: 2,
  lua: `
local current = redis.call('GET', KEYS[1])
if current then
  local held = cjson.decode(current)
  local tab = held.tab
  if tab == nil or tab == cjson.null then tab = '' end
  if held.userId == ARGV[1] and tab == ARGV[2] then
    redis.call('PEXPIRE', KEYS[1], ARGV[4])
    return {1, current, redis.call('PTTL', KEYS[1])}
  end
  return {0, current, redis.call('PTTL', KEYS[1])}
end
local fence = redis.call('INCR', KEYS[2])
local value = ARGV[3] .. fence .. '}'
redis.call('SET', KEYS[1], value, 'PX', ARGV[4])
return {1, value, tonumber(ARGV[4])}
`,
});

type GrantCommand = (lockKey: string, fenceKey: string, userId: string, tab: string, prefix: string, ttlMs: number) => Promise<[number, string, number]>;
const grantLock = (client as unknown as { grantLock: GrantCommand }).grantLock.bind(client);

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch {
    throw new LockStoreError("lock store unreachable");
  }
}

const lockKey = (sceneId: string, objectId: string): string => `rw:lock:${sceneId}:${objectId}`;
const presenceKey = (sceneId: string, userId: string, tab: string): string => `rw:presence:${sceneId}:${userId}:${tab}`;

async function scan(pattern: string): Promise<string[]> {
  const found: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await client.scan(cursor, "MATCH", pattern, "COUNT", 500);
    cursor = next;
    found.push(...batch);
  } while (cursor !== "0");
  return found;
}

type Grant = { granted: true; lock: LockEntry } | { granted: false; holder: LockEntry };

export const valkey = {
  async ping(): Promise<void> {
    await guarded(async () => {
      await client.ping();
    });
  },

  /** Of any number of simultaneous requests for a free object, exactly one is granted (one atomic script). */
  grant(sceneId: string, objectId: string, user: { id: string; displayName: string }, tab: string | null): Promise<Grant> {
    return guarded(async () => {
      const prefix = JSON.stringify({ userId: user.id, displayName: user.displayName, tab, fence: 0 }).replace(/0\}$/, "");
      const [granted, json, ttl] = await grantLock(lockKey(sceneId, objectId), `rw:fence:${sceneId}:${objectId}`, user.id, tab ?? "", prefix, config.lockTtlSeconds * 1000);
      const lock: LockEntry = { ...(JSON.parse(json) as LockValue), objectId, expiresAt: new Date(Date.now() + ttl).toISOString() };
      return granted === 1 ? { granted: true, lock } : { granted: false, holder: lock };
    });
  },

  async get(sceneId: string, objectId: string): Promise<LockEntry | null> {
    return guarded(async () => {
      const key = lockKey(sceneId, objectId);
      const [[, json], [, ttl]] = (await client.multi().get(key).pttl(key).exec()) as [[unknown, string | null], [unknown, number]];
      return json ? { ...(JSON.parse(json) as LockValue), objectId, expiresAt: new Date(Date.now() + Math.max(ttl, 0)).toISOString() } : null;
    });
  },

  async list(sceneId: string): Promise<LockEntry[]> {
    return guarded(async () => {
      const keys = await scan(`rw:lock:${sceneId}:*`);
      if (keys.length === 0) return [];
      const pipeline = client.multi();
      for (const key of keys) pipeline.get(key).pttl(key);
      const replies = (await pipeline.exec()) as Array<[unknown, string | number | null]>;
      const entries: LockEntry[] = [];
      keys.forEach((key, i) => {
        const json = replies[i * 2][1] as string | null;
        const ttl = replies[i * 2 + 1][1] as number;
        if (json) entries.push({ ...(JSON.parse(json) as LockValue), objectId: key.slice(`rw:lock:${sceneId}:`.length), expiresAt: new Date(Date.now() + Math.max(ttl, 0)).toISOString() });
      });
      return entries.sort((a, b) => (a.objectId < b.objectId ? -1 : 1));
    });
  },

  /** Deletes a lease the user holds; reports whether it was free, released, or held by someone else. */
  async release(sceneId: string, objectId: string, userId: string): Promise<{ result: "free" | "released" } | { result: "held"; holder: LockEntry }> {
    const lock = await valkey.get(sceneId, objectId);
    if (!lock) return { result: "free" };
    if (lock.userId !== userId) return { result: "held", holder: lock };
    await guarded(async () => {
      await client.del(lockKey(sceneId, objectId));
    });
    return { result: "released" };
  },

  async releaseWhere(sceneId: string, matches: (lock: LockEntry) => boolean): Promise<string[]> {
    const freed: string[] = [];
    for (const lock of await valkey.list(sceneId)) {
      if (!matches(lock)) continue;
      await guarded(async () => {
        await client.del(lockKey(sceneId, lock.objectId));
      });
      freed.push(lock.objectId);
    }
    return freed;
  },

  async deleteLocks(sceneId: string, objectIds: string[]): Promise<void> {
    if (objectIds.length === 0) return;
    await guarded(async () => {
      await client.del(...objectIds.map((id) => lockKey(sceneId, id)));
    });
  },

  async extendLock(sceneId: string, objectId: string, userId: string, tab: string): Promise<void> {
    const lock = await valkey.get(sceneId, objectId);
    if (lock && lock.userId === userId && lock.tab === tab) {
      await guarded(async () => {
        await client.pexpire(lockKey(sceneId, objectId), config.lockTtlSeconds * 1000);
      });
    }
  },

  async putPresence(sceneId: string, userId: string, tab: string, value: PresenceValue): Promise<void> {
    await guarded(async () => {
      await client.set(presenceKey(sceneId, userId, tab), JSON.stringify(value), "EX", config.presenceTtlSeconds);
    });
  },

  async touchPresence(sceneId: string, userId: string, tab: string, displayName: string): Promise<PresenceValue> {
    return guarded(async () => {
      const key = presenceKey(sceneId, userId, tab);
      const current = await client.get(key);
      if (current) {
        await client.expire(key, config.presenceTtlSeconds);
        return JSON.parse(current) as PresenceValue;
      }
      const fresh: PresenceValue = { displayName, cursor: null, selected: null };
      await client.set(key, JSON.stringify(fresh), "EX", config.presenceTtlSeconds);
      return fresh;
    });
  },

  async deletePresence(sceneId: string, userId: string, tab: string): Promise<void> {
    await guarded(async () => {
      await client.del(presenceKey(sceneId, userId, tab));
    });
  },

  async listPresence(sceneId: string): Promise<PresenceEntry[]> {
    return guarded(async () => {
      const prefix = `rw:presence:${sceneId}:`;
      const keys = (await scan(`${prefix}*`)).sort();
      if (keys.length === 0) return [];
      const values = await client.mget(...keys);
      const entries: PresenceEntry[] = [];
      keys.forEach((key, i) => {
        const raw = values[i];
        if (!raw) return;
        const rest = key.slice(prefix.length);
        const split = rest.indexOf(":");
        entries.push({ ...(JSON.parse(raw) as PresenceValue), userId: rest.slice(0, split), tab: rest.slice(split + 1) });
      });
      return entries;
    });
  },
};
