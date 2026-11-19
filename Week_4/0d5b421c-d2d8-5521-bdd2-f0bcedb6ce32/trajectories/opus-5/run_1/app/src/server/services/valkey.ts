import Redis, { type RedisOptions } from 'ioredis';
import { config } from '../config';
import type { HostLiveEvent, PublicLiveEvent } from '../../shared/types';

const COMMAND_TIMEOUT_MS = 2000;
const EVENT_RETENTION_MS = 10 * 60 * 1000;

const baseOptions: RedisOptions = {
  lazyConnect: true,
  connectTimeout: COMMAND_TIMEOUT_MS,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  enableReadyCheck: true,
  retryStrategy: (attempt) => Math.min(200 * attempt, 2000),
};

const client = new Redis(config.valkeyUrl, {
  ...baseOptions,
  commandTimeout: COMMAND_TIMEOUT_MS,
});
client.on('error', () => undefined);

let reachable = false;

export function valkeyReachable(): boolean {
  return reachable;
}

function markUnreachable(): void {
  reachable = false;
}

function markReachable(): void {
  reachable = true;
}

/** Checks Valkey for real before an action is refused, so a stale probe never pauses holds. */
export async function valkeyAnswering(): Promise<boolean> {
  return reachable ? true : probeValkey();
}

export async function probeValkey(): Promise<boolean> {
  try {
    await client.ping();
    markReachable();
    return true;
  } catch {
    markUnreachable();
    return false;
  }
}

async function run<T>(action: () => Promise<T>): Promise<T> {
  try {
    const result = await action();
    markReachable();
    return result;
  } catch (error) {
    markUnreachable();
    throw error;
  }
}

export function connectValkey(): void {
  void client.connect().catch(() => undefined);
}

const prefix = config.valkeyKeyPrefix;

export function claimKey(tableId: string, date: string, time: string): string {
  return `${prefix}hold:${tableId}:${date}T${time}`;
}

export function offerKey(offerId: string): string {
  return `${prefix}offer:${offerId}`;
}

function eventsKey(date: string): string {
  return `${prefix}events:${date}`;
}

const CLAIM_SCRIPT = `
for index = 1, #KEYS do
  if redis.call('EXISTS', KEYS[index]) == 1 then
    return 0
  end
end
for index = 1, #KEYS do
  redis.call('SET', KEYS[index], ARGV[1], 'PX', tonumber(ARGV[2]))
end
return 1
`;

const RELEASE_SCRIPT = `
for index = 1, #KEYS do
  if redis.call('GET', KEYS[index]) == ARGV[1] then
    redis.call('DEL', KEYS[index])
  end
end
return 1
`;

/** Claims every covered slot for an owner, all or none. */
export async function claimSlots(keys: string[], ownerId: string, ttlMs: number): Promise<boolean> {
  if (keys.length === 0) return true;
  const taken = await run(() =>
    client.eval(CLAIM_SCRIPT, keys.length, ...keys, ownerId, String(ttlMs)),
  );
  return taken === 1;
}

export async function releaseSlots(keys: string[], ownerId: string): Promise<void> {
  if (keys.length === 0) return;
  await run(() => client.eval(RELEASE_SCRIPT, keys.length, ...keys, ownerId));
}

export async function setOfferKey(offerId: string, ttlMs: number): Promise<void> {
  await run(() => client.set(offerKey(offerId), offerId, 'PX', ttlMs));
}

export async function deleteOfferKey(offerId: string): Promise<void> {
  await run(() => client.del(offerKey(offerId)));
}

export interface StreamEvent {
  id: string;
  publicEvent: PublicLiveEvent;
  hostEvent: HostLiveEvent;
}

function parseEntry(id: string, fields: string[]): StreamEvent | null {
  let publicJson: string | null = null;
  let hostJson: string | null = null;
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const name = fields[index];
    const value = fields[index + 1] ?? '';
    if (name === 'public') publicJson = value;
    if (name === 'host') hostJson = value;
  }
  if (publicJson === null || hostJson === null) return null;
  return {
    id,
    publicEvent: JSON.parse(publicJson) as PublicLiveEvent,
    hostEvent: JSON.parse(hostJson) as HostLiveEvent,
  };
}

export async function publishEvent(
  publicEvent: PublicLiveEvent,
  hostEvent: HostLiveEvent,
): Promise<void> {
  const key = eventsKey(publicEvent.date);
  const minId = `${Date.now() - EVENT_RETENTION_MS}-0`;
  await run(async () => {
    await client.xadd(
      key,
      '*',
      'public',
      JSON.stringify(publicEvent),
      'host',
      JSON.stringify(hostEvent),
    );
    await client.xtrim(key, 'MINID', minId);
  });
}

export async function readEventsAfter(date: string, lastId: string): Promise<StreamEvent[]> {
  const entries = (await run(() => client.xrange(eventsKey(date), `(${lastId}`, '+'))) as [
    string,
    string[],
  ][];
  return entries
    .map(([id, fields]) => parseEntry(id, fields))
    .filter((event): event is StreamEvent => event !== null);
}

export async function lastEventId(date: string): Promise<string> {
  const entries = (await run(() => client.xrevrange(eventsKey(date), '+', '-', 'COUNT', 1))) as [
    string,
    string[],
  ][];
  const entry = entries[0];
  return entry ? entry[0] : '0-0';
}

type Listener = (event: StreamEvent) => void;

interface DateStream {
  listeners: Set<Listener>;
  connection: Redis | null;
  stopped: boolean;
}

const streams = new Map<string, DateStream>();

async function pump(date: string, stream: DateStream, startId: string): Promise<void> {
  const connection = new Redis(config.valkeyUrl, { ...baseOptions });
  connection.on('error', () => undefined);
  stream.connection = connection;
  let cursor = startId;
  while (!stream.stopped) {
    try {
      const response = (await connection.xread(
        'BLOCK',
        1000,
        'STREAMS',
        eventsKey(date),
        cursor,
      )) as [string, [string, string[]][]][] | null;
      if (response) {
        for (const [, entries] of response) {
          for (const [id, fields] of entries) {
            cursor = id;
            const event = parseEntry(id, fields);
            if (!event) continue;
            for (const listener of stream.listeners) listener(event);
          }
        }
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  connection.disconnect();
  stream.connection = null;
}

/** One Valkey reader per date fans events out to every open stream for that date. */
export function subscribeToDate(date: string, listener: Listener, startId: string): () => void {
  let stream = streams.get(date);
  if (!stream) {
    stream = { listeners: new Set(), connection: null, stopped: false };
    streams.set(date, stream);
    void pump(date, stream, startId);
  }
  stream.listeners.add(listener);
  const current = stream;
  return () => {
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      current.stopped = true;
      streams.delete(date);
    }
  };
}
