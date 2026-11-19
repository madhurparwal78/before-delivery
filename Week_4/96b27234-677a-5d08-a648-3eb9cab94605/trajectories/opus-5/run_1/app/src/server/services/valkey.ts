import { Redis } from 'ioredis';
import { config } from '../config.js';
import { ServiceDownError } from '../errors.js';
import { isForcedDown } from './outage.js';

const CLAIM_TILE = `
local key = KEYS[1]
local person = ARGV[1]
local facing = ARGV[2]
local seated = ARGV[3]
local seedCount = tonumber(ARGV[4])
local index = 5
if redis.call('EXISTS', key) == 0 then
  for i = 1, seedCount do
    redis.call('HSET', key, ARGV[index], ARGV[index + 1])
    index = index + 2
  end
else
  index = index + seedCount * 2
end
local taken = {}
local all = redis.call('HGETALL', key)
for i = 1, #all, 2 do
  if all[i] ~= person then
    local x, y = string.match(all[i + 1], '^(%-?%d+),(%-?%d+)')
    if x ~= nil then taken[x .. ',' .. y] = true end
  end
end
for i = index, #ARGV do
  if taken[ARGV[i]] == nil then
    redis.call('HSET', key, person, ARGV[i] .. ',' .. facing .. ',' .. seated)
    return ARGV[i]
  end
end
return ''
`;

const CLAIM_PLACE = `
local key = KEYS[1]
local person = ARGV[1]
local capacity = tonumber(ARGV[2])
local seedCount = tonumber(ARGV[3])
if redis.call('EXISTS', key) == 0 then
  for i = 1, seedCount do
    redis.call('SADD', key, ARGV[3 + i])
  end
end
if redis.call('SISMEMBER', key, person) == 1 then return 'in' end
if redis.call('SCARD', key) < capacity then
  redis.call('SADD', key, person)
  return 'ok'
end
return 'full'
`;

type Handler = (payload: unknown) => void;

const commands = new Redis(config.valkeyUrl, {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  retryStrategy: () => 1000,
  reconnectOnError: () => true
});
const subscriber = new Redis(config.valkeyUrl, {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  retryStrategy: () => 1000
});

commands.on('error', () => undefined);
subscriber.on('error', () => undefined);

const handlers = new Map<string, Set<Handler>>();

subscriber.on('message', (channel: string, raw: string) => {
  const set = handlers.get(channel);
  if (!set) return;
  const payload: unknown = JSON.parse(raw);
  for (const handler of set) handler(payload);
});

subscriber.on('ready', () => {
  for (const channel of handlers.keys()) void subscriber.subscribe(channel).catch(() => undefined);
});

export function valkeyUp(): boolean {
  return commands.status === 'ready' && !isForcedDown('valkey');
}

function client(): Redis {
  if (!valkeyUp()) throw new ServiceDownError('valkey');
  return commands;
}

const stateListeners = new Set<(up: boolean) => void>();
let lastState = false;

export function onValkeyState(listener: (up: boolean) => void): void {
  stateListeners.add(listener);
}

export function watchValkeyState(): void {
  setInterval(() => {
    const up = valkeyUp();
    if (up === lastState) return;
    lastState = up;
    for (const listener of stateListeners) listener(up);
  }, 500).unref();
}

export const positionsKey = (sessionId: string): string => `session:${sessionId}:positions`;
export const placesKey = (sessionId: string): string => `session:${sessionId}:places`;
export const sessionChannel = (sessionId: string): string => `session:${sessionId}:events`;
export const personChannel = (personId: string): string => `person:${personId}:events`;
export const presenceKey = (personId: string): string => `presence:${personId}`;

export interface TileSeed {
  personId: string;
  x: number;
  y: number;
  facing: string;
  seated: boolean;
}

export async function claimTile(
  sessionId: string,
  seed: TileSeed[],
  personId: string,
  facing: string,
  seated: boolean,
  candidates: Array<{ x: number; y: number }>
): Promise<{ x: number; y: number } | null> {
  const args: string[] = [personId, facing, seated ? '1' : '0', String(seed.length)];
  for (const entry of seed) {
    args.push(entry.personId, `${entry.x},${entry.y},${entry.facing},${entry.seated ? '1' : '0'}`);
  }
  for (const tile of candidates) args.push(`${tile.x},${tile.y}`);
  const chosen = (await client().eval(CLAIM_TILE, 1, positionsKey(sessionId), ...args)) as string;
  if (chosen === '') return null;
  const parts = chosen.split(',');
  return { x: Number(parts[0]), y: Number(parts[1]) };
}

export async function releaseTile(sessionId: string, personId: string): Promise<void> {
  await client().hdel(positionsKey(sessionId), personId);
}

export async function claimPlace(
  sessionId: string,
  seedMembers: string[],
  personId: string,
  capacity: number
): Promise<'in' | 'ok' | 'full'> {
  const args: string[] = [personId, String(capacity), String(seedMembers.length), ...seedMembers];
  const result = (await client().eval(CLAIM_PLACE, 1, placesKey(sessionId), ...args)) as string;
  return result as 'in' | 'ok' | 'full';
}

export async function releasePlace(sessionId: string, personId: string): Promise<void> {
  await client().srem(placesKey(sessionId), personId);
}

export async function clearSessionKeys(sessionId: string): Promise<void> {
  await client().del(positionsKey(sessionId), placesKey(sessionId));
}

export async function publish(channel: string, payload: unknown): Promise<void> {
  await client().publish(channel, JSON.stringify(payload));
}

export async function subscribe(channel: string, handler: Handler): Promise<void> {
  let set = handlers.get(channel);
  if (!set) {
    set = new Set();
    handlers.set(channel, set);
    await subscriber.subscribe(channel);
  }
  set.add(handler);
}

export async function unsubscribe(channel: string, handler: Handler): Promise<void> {
  const set = handlers.get(channel);
  if (!set) return;
  set.delete(handler);
  if (set.size === 0) {
    handlers.delete(channel);
    if (subscriber.status === 'ready') await subscriber.unsubscribe(channel).catch(() => undefined);
  }
}

export async function markOnline(personId: string): Promise<void> {
  await client().incr(presenceKey(personId));
}

export async function markOffline(personId: string): Promise<void> {
  const left = await client().decr(presenceKey(personId));
  if (left <= 0) await client().del(presenceKey(personId));
}

export async function onlineIds(ids: string[]): Promise<Set<string>> {
  const online = new Set<string>();
  if (ids.length === 0 || !valkeyUp()) return online;
  try {
    const values = await commands.mget(ids.map(presenceKey));
    ids.forEach((id, index) => {
      if (values[index] !== null && values[index] !== undefined) online.add(id);
    });
  } catch {
    return online;
  }
  return online;
}
