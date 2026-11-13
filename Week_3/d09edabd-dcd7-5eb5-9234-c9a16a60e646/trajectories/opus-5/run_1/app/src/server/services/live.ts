import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { config } from '../config.js';
import { errors } from '../errors.js';

export interface LiveEvent {
  event: string;
  data: unknown;
}

const instanceId = randomUUID();

function makeClient(): Redis {
  return new Redis(config.valkeyUrl, {
    lazyConnect: false,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => 2000,
    connectTimeout: 3000,
  });
}

const commands = makeClient();
const subscriber = makeClient();

let reachable = false;

function markDown(): void {
  reachable = false;
}

commands.on('ready', () => {
  reachable = true;
});
commands.on('end', markDown);
commands.on('error', markDown);

subscriber.on('ready', () => {
  void subscriber.psubscribe('room:*', 'playtest:*');
});
subscriber.on('error', () => undefined);

const listeners = new Map<string, Set<(event: LiveEvent) => void>>();

function dispatch(channel: string, event: LiveEvent): void {
  for (const listener of listeners.get(channel) ?? []) listener(event);
}

subscriber.on('pmessage', (_pattern: string, channel: string, payload: string) => {
  try {
    const parsed = JSON.parse(payload) as { from: string; event: string; data: unknown };
    if (parsed.from === instanceId) return;
    dispatch(channel, { event: parsed.event, data: parsed.data });
  } catch {
    markDown();
  }
});

export function liveUp(): boolean {
  return reachable;
}

export function onChannel(channel: string, listener: (event: LiveEvent) => void): () => void {
  const set = listeners.get(channel) ?? new Set();
  set.add(listener);
  listeners.set(channel, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(channel);
  };
}

/** Fans an event out to this instance at once and to the other instances through Valkey. */
export function publish(channel: string, event: LiveEvent): void {
  dispatch(channel, event);
  if (!reachable) return;
  void commands
    .publish(channel, JSON.stringify({ from: instanceId, event: event.event, data: event.data }))
    .catch(markDown);
}

export function roomChannel(roomId: string): string {
  return `room:${roomId}`;
}

export function sessionChannel(sessionId: string): string {
  return `playtest:${sessionId}`;
}

function requireLive(): Redis {
  if (!reachable) throw errors.liveUnavailable();
  return commands;
}

async function run<T>(action: (client: Redis) => Promise<T>): Promise<T> {
  const client = requireLive();
  try {
    return await action(client);
  } catch {
    markDown();
    throw errors.liveUnavailable();
  }
}

export interface LockHolder {
  userId: string;
  displayName: string;
}

export interface LockState {
  holder: LockHolder;
  expiresInSeconds: number;
}

function lockKey(roomId: string, targetType: string, targetId: string): string {
  return `lock:${roomId}:${targetType}:${targetId}`;
}

function encodeHolder(holder: LockHolder): string {
  return `${holder.userId}|${holder.displayName}`;
}

function decodeHolder(value: string): LockHolder {
  const separator = value.indexOf('|');
  return { userId: value.slice(0, separator), displayName: value.slice(separator + 1) };
}

const takeScript = `
local current = redis.call('GET', KEYS[1])
if current == false or current == ARGV[2] or ARGV[3] == '1' then
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[4])
  if current == false or current == ARGV[2] then return {1, ''} end
  return {1, current}
end
return {0, current}
`;

/** The one place a lock winner is decided, across both app instances. */
export async function takeLock(
  roomId: string,
  targetType: 'placement' | 'node',
  targetId: string,
  holder: LockHolder,
  takeOver: boolean,
): Promise<{ taken: true; takenFrom: LockHolder | null } | { taken: false; state: LockState }> {
  const key = lockKey(roomId, targetType, targetId);
  const value = encodeHolder(holder);
  const result = (await run((client) =>
    client.eval(takeScript, 1, key, value, value, takeOver ? '1' : '0', String(config.lockTtlSeconds)),
  )) as [number, string];
  if (result[0] === 1) {
    const previous = result[1];
    return { taken: true, takenFrom: previous === '' ? null : decodeHolder(previous) };
  }
  const ttl = await run((client) => client.ttl(key));
  return {
    taken: false,
    state: {
      holder: decodeHolder(result[1]),
      expiresInSeconds: ttl > 0 ? ttl : config.lockTtlSeconds,
    },
  };
}

export async function readLock(
  roomId: string,
  targetType: 'placement' | 'node',
  targetId: string,
): Promise<LockState | null> {
  const key = lockKey(roomId, targetType, targetId);
  const value = await run((client) => client.get(key));
  if (value === null) return null;
  const ttl = await run((client) => client.ttl(key));
  return {
    holder: decodeHolder(value),
    expiresInSeconds: ttl > 0 ? ttl : config.lockTtlSeconds,
  };
}

export async function releaseLock(
  roomId: string,
  targetType: 'placement' | 'node',
  targetId: string,
): Promise<void> {
  await run((client) => client.del(lockKey(roomId, targetType, targetId)));
}

export async function markPresence(
  roomId: string,
  userId: string,
  displayName: string,
): Promise<void> {
  await run((client) => client.set(`presence:${roomId}:${userId}`, displayName, 'EX', 30));
}

export async function dropPresence(roomId: string, userId: string): Promise<void> {
  await run((client) => client.del(`presence:${roomId}:${userId}`));
}

export async function presence(roomId: string): Promise<LockHolder[]> {
  const prefix = `presence:${roomId}:`;
  const keys = await run((client) => client.keys(`${prefix}*`));
  if (keys.length === 0) return [];
  const values = await run((client) => client.mget(keys));
  const members: LockHolder[] = [];
  keys.forEach((key, index) => {
    const name = values[index];
    if (name !== null) members.push({ userId: key.slice(prefix.length), displayName: name });
  });
  return members.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Of simultaneous attempts across instances, exactly one wins this gate. */
export async function claimOnce(key: string, seconds: number): Promise<boolean> {
  const result = await run((client) => client.set(key, '1', 'EX', seconds, 'NX'));
  return result === 'OK';
}

export async function clearClaim(key: string): Promise<void> {
  await run((client) => client.del(key));
}
