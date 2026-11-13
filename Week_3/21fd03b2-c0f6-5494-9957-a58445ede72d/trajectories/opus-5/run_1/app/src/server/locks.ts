import { config } from './config.js';
import type { LockHolder, LockRow, PresencePerson } from '../shared/api.js';
import { valkey, type Reply } from './valkey.js';

const ACQUIRE = `
local lockKey = KEYS[1]
local fenceKey = KEYS[2]
local userId = ARGV[1]
local displayName = ARGV[2]
local tab = ARGV[3]
local ttl = tonumber(ARGV[4])
local current = redis.call('GET', lockKey)
if current then
  local holder = cjson.decode(current)
  if holder.userId == userId and holder.tab == tab then
    redis.call('SET', lockKey, current, 'EX', ttl)
    return {1, tostring(holder.fence), holder.userId, holder.displayName, tostring(ttl * 1000)}
  end
  return {0, tostring(holder.fence), holder.userId, holder.displayName, tostring(redis.call('PTTL', lockKey))}
end
local fence = redis.call('INCR', fenceKey)
local payload = string.format('{"displayName":%s,"fence":%d,"tab":%s,"userId":%s}', cjson.encode(displayName), fence, cjson.encode(tab), cjson.encode(userId))
redis.call('SET', lockKey, payload, 'EX', ttl)
return {1, tostring(fence), userId, displayName, tostring(ttl * 1000)}
`;

const RELEASE = `
local current = redis.call('GET', KEYS[1])
if not current then return 1 end
local holder = cjson.decode(current)
if holder.userId == ARGV[1] and holder.tab == ARGV[2] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`;

export interface LeaseHolderRecord {
  userId: string;
  displayName: string;
  tab: string;
  fence: number;
}

export type AcquireResult =
  | { granted: true; lease: LockRow }
  | { granted: false; holder: LockHolder; expiresAt: string };

function lockKey(sceneId: string, objectId: string): string {
  return `rw:lock:${sceneId}:${objectId}`;
}

function fenceKey(sceneId: string, objectId: string): string {
  return `rw:fence:${sceneId}:${objectId}`;
}

function presenceKey(sceneId: string, userId: string, tab: string): string {
  return `rw:presence:${sceneId}:${userId}:${tab}`;
}

function expiryFrom(millis: number): string {
  return new Date(Date.now() + Math.max(millis, 0)).toISOString();
}

export async function acquireLease(
  sceneId: string,
  objectId: string,
  holder: { userId: string; displayName: string },
  tab: string,
): Promise<AcquireResult> {
  const reply = (await valkey.command(
    'EVAL',
    ACQUIRE,
    2,
    lockKey(sceneId, objectId),
    fenceKey(sceneId, objectId),
    holder.userId,
    holder.displayName,
    tab,
    config.lockTtlSeconds,
  )) as Reply[];
  const granted = Number(reply[0]) === 1;
  const fence = Number(reply[1]);
  const userId = String(reply[2]);
  const displayName = String(reply[3]);
  const pttl = Number(reply[4]);
  if (!granted) {
    return { granted: false, holder: { userId, displayName }, expiresAt: expiryFrom(pttl) };
  }
  return {
    granted: true,
    lease: {
      objectId,
      holder: { userId, displayName },
      fence,
      expiresAt: expiryFrom(config.lockTtlSeconds * 1000),
    },
  };
}

export async function releaseLease(
  sceneId: string,
  objectId: string,
  userId: string,
  tab: string,
): Promise<boolean> {
  const reply = await valkey.command('EVAL', RELEASE, 1, lockKey(sceneId, objectId), userId, tab);
  return Number(reply) === 1;
}

export async function readLease(
  sceneId: string,
  objectId: string,
): Promise<LeaseHolderRecord | null> {
  const reply = await valkey.command('GET', lockKey(sceneId, objectId));
  if (typeof reply !== 'string') return null;
  return JSON.parse(reply) as LeaseHolderRecord;
}

export async function listLeases(sceneId: string): Promise<LockRow[]> {
  const keys = (await valkey.command('KEYS', `rw:lock:${sceneId}:*`)) as Reply[];
  const rows: LockRow[] = [];
  for (const key of keys) {
    if (typeof key !== 'string') continue;
    const value = await valkey.command('GET', key);
    const pttl = await valkey.command('PTTL', key);
    if (typeof value !== 'string') continue;
    const record = JSON.parse(value) as LeaseHolderRecord;
    rows.push({
      objectId: key.slice(`rw:lock:${sceneId}:`.length),
      holder: { userId: record.userId, displayName: record.displayName },
      fence: record.fence,
      expiresAt: expiryFrom(Number(pttl)),
    });
  }
  return rows.sort((a, b) => (a.objectId < b.objectId ? -1 : 1));
}

/** Releases every lease held under one tab, used when a live channel ends. */
export async function releaseLeasesForTab(
  sceneId: string,
  userId: string,
  tab: string,
): Promise<void> {
  for (const lease of await listLeases(sceneId)) {
    if (lease.holder.userId !== userId) continue;
    const record = await readLease(sceneId, lease.objectId);
    if (record && record.userId === userId && record.tab === tab)
      await valkey.command('DEL', lockKey(sceneId, lease.objectId));
  }
}

/** Releases every lease a person holds anywhere, used on demotion. */
export async function releaseLeasesForUser(userId: string): Promise<void> {
  const keys = (await valkey.command('KEYS', 'rw:lock:*')) as Reply[];
  for (const key of keys) {
    if (typeof key !== 'string') continue;
    const value = await valkey.command('GET', key);
    if (typeof value !== 'string') continue;
    const record = JSON.parse(value) as LeaseHolderRecord;
    if (record.userId === userId) await valkey.command('DEL', key);
  }
}

export interface PresenceInput {
  tab: string;
  cursor: [number, number, number] | null;
  selected: string | null;
}

export async function writePresence(
  sceneId: string,
  person: { userId: string; displayName: string },
  input: PresenceInput,
): Promise<void> {
  await valkey.command(
    'SET',
    presenceKey(sceneId, person.userId, input.tab),
    JSON.stringify({
      displayName: person.displayName,
      cursor: input.cursor,
      selected: input.selected,
    }),
    'EX',
    config.presenceTtlSeconds,
  );
}

export async function clearPresence(
  sceneId: string,
  userId: string,
  tab: string,
): Promise<void> {
  await valkey.command('DEL', presenceKey(sceneId, userId, tab));
}

export async function listPresence(sceneId: string): Promise<PresencePerson[]> {
  const keys = (await valkey.command('KEYS', `rw:presence:${sceneId}:*`)) as Reply[];
  const byUser = new Map<string, PresencePerson>();
  for (const key of keys) {
    if (typeof key !== 'string') continue;
    const value = await valkey.command('GET', key);
    if (typeof value !== 'string') continue;
    const parsed = JSON.parse(value) as {
      displayName: string;
      cursor: [number, number, number] | null;
      selected: string | null;
    };
    const userId = key.slice(`rw:presence:${sceneId}:`.length).split(':')[0];
    const existing = byUser.get(userId);
    byUser.set(userId, {
      userId,
      displayName: parsed.displayName,
      cursor: parsed.cursor ?? existing?.cursor ?? null,
      selected: parsed.selected ?? existing?.selected ?? null,
    });
  }
  return [...byUser.values()].sort((a, b) => (a.displayName < b.displayName ? -1 : 1));
}
