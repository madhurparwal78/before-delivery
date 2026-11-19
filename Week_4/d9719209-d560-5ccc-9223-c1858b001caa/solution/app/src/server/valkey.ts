import { Redis } from 'ioredis';
import { config } from './config.js';
import { AppError } from './errors.js';

const STREAM_CAP = 1000;
const WINDOW_MS = 60_000;
const streamKey = `${config.valkeyKeyPrefix}events`;
const liveChannel = `${config.valkeyKeyPrefix}live`;

function connectionUrl(): string | null {
  if (!config.valkeyUrl) return null;
  try {
    const url = new URL(config.valkeyUrl);
    return url.protocol === 'redis:' || url.protocol === 'rediss:' ? config.valkeyUrl : null;
  } catch {
    return null;
  }
}

const url = connectionUrl();

function connect(): Redis | null {
  if (!url) return null;
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
    commandTimeout: 2000,
    retryStrategy: (attempt) => Math.min(attempt * 500, 5000),
  });
  client.on('error', () => undefined);
  return client;
}

const client = connect();
const subscriber = url ? new Redis(url, { connectTimeout: 2000, retryStrategy: (attempt) => Math.min(attempt * 500, 5000) }) : null;
subscriber?.on('error', () => undefined);

export const valkeyUnavailable = (): AppError =>
  new AppError('SERVICE_UNAVAILABLE', 'Live services are unavailable right now');

function ready(): Redis {
  if (!client) throw valkeyUnavailable();
  return client;
}

export async function valkeyAnswers(): Promise<boolean> {
  try {
    return (await ready().ping()) === 'PONG';
  } catch {
    return false;
  }
}

export interface RateDecision { allowed: boolean; retryAfter: number }

const SLIDING_WINDOW = `
local key, now, window, limit, member = KEYS[1], tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]), ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
if redis.call('ZCARD', key) >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  return {0, tonumber(oldest[2]) + window - now}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return {1, 0}
`;

let sequence = 0;

/** A rolling 60-second counter per member; every request, including no-ops, takes a slot. */
export async function takeSlot(kind: 'vote' | 'post', memberId: string, limit: number): Promise<RateDecision> {
  const now = Date.now();
  sequence += 1;
  const reply = (await ready().eval(
    SLIDING_WINDOW, 1, `${config.valkeyKeyPrefix}rl:${kind}:${memberId}`, now, WINDOW_MS, limit, `${now}-${sequence}`,
  )) as [number, number];
  return { allowed: reply[0] === 1, retryAfter: Math.max(1, Math.ceil(reply[1] / 1000)) };
}

export interface LiveEvent {
  id: string;
  topics: string[];
  event: string;
  data: unknown;
}

/** Appends to the replay stream, then fans out on the live channel. Failures never fail the caller. */
export async function emit(topics: string[], event: string, data: unknown): Promise<void> {
  try {
    const redis = ready();
    const id = await redis.xadd(streamKey, 'MAXLEN', '~', STREAM_CAP, '*',
      'topics', JSON.stringify(topics), 'event', event, 'data', JSON.stringify(data));
    if (id) await redis.publish(liveChannel, JSON.stringify({ id, topics, event, data } satisfies LiveEvent));
  } catch {
    // Events produced while Valkey is unreachable are dropped.
  }
}

function parseEntry(id: string, fields: string[]): LiveEvent {
  const map = new Map<string, string>();
  for (let i = 0; i + 1 < fields.length; i += 2) map.set(fields[i] as string, fields[i + 1] as string);
  return {
    id,
    topics: JSON.parse(map.get('topics') ?? '[]') as string[],
    event: map.get('event') ?? '',
    data: JSON.parse(map.get('data') ?? 'null') as unknown,
  };
}

function streamIdOrder(a: string, b: string): number {
  const [aMs = 0, aSeq = 0] = a.split('-').map(Number);
  const [bMs = 0, bSeq = 0] = b.split('-').map(Number);
  return aMs - bMs || aSeq - bSeq;
}

export const isAfter = (id: string, other: string): boolean => streamIdOrder(id, other) > 0;

/** True when entries after `lastId` were trimmed away, so a replay would have gaps. */
export async function replayHasGap(lastId: string): Promise<boolean> {
  const info = (await ready().xinfo('STREAM', streamKey)) as unknown[];
  for (let i = 0; i + 1 < info.length; i += 2) {
    if (info[i] === 'max-deleted-entry-id') return isAfter(String(info[i + 1]), lastId);
  }
  return false;
}

export async function eventsAfter(lastId: string): Promise<LiveEvent[]> {
  const entries = (await ready().xrange(streamKey, `(${lastId}`, '+')) as [string, string[]][];
  return entries.map(([id, fields]) => parseEntry(id, fields));
}

export function onLiveEvent(handler: (event: LiveEvent) => void): void {
  if (!subscriber) return;
  subscriber.on('message', (_channel, message) => handler(JSON.parse(message) as LiveEvent));
  const subscribe = (): void => {
    subscriber.subscribe(liveChannel).catch(() => setTimeout(subscribe, 2000));
  };
  subscribe();
}
