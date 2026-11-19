import { Redis } from 'ioredis';
import { config } from '../core/config.js';

export interface LiveEvent {
  event: string;
  data: unknown;
  topics: string[];
}

export interface StreamEntry {
  id: string;
  event: string;
  data: unknown;
  topics: string[];
}

const EVENTS_STREAM = `${config.valkey.keyPrefix}events`;
const LIVE_CHANNEL = `${config.valkey.keyPrefix}live`;
const STREAM_MAX_LENGTH = 1000;

function usableUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return ['redis:', 'rediss:', 'valkey:'].includes(parsed.protocol) ? url : null;
  } catch {
    return null;
  }
}

const url = usableUrl(config.valkey.url);

function createClient(kind: 'commands' | 'subscriber'): Redis | null {
  if (!url) return null;
  const client = new Redis(url, {
    lazyConnect: true,
    // Commands fail at once when Valkey is unreachable; the subscriber may queue its subscribe.
    enableOfflineQueue: kind === 'subscriber',
    maxRetriesPerRequest: kind === 'subscriber' ? null : 0,
    connectTimeout: 1000,
    retryStrategy: () => 2000,
    reconnectOnError: () => true,
  });
  client.on('error', () => {
    // Valkey being unreachable is a supported state; each call reports its own failure.
  });
  void client.connect().catch(() => undefined);
  return client;
}

const commands = createClient('commands');
const subscriber = createClient('subscriber');

/** Rolling-window counter in one round trip, so concurrent votes cannot overshoot the limit. */
const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('zremrangebyscore', key, 0, now - window)
local used = redis.call('zcard', key)
if used >= limit then
  local oldest = redis.call('zrange', key, 0, 0, 'WITHSCORES')
  local retry = window - (now - tonumber(oldest[2]))
  redis.call('expire', key, window)
  return {0, retry}
end
redis.call('zadd', key, now, member)
redis.call('expire', key, window)
return {1, 0}
`;

export interface RateDecision {
  allowed: boolean;
  retryAfter: number;
}

export class ValkeyUnavailable extends Error {
  constructor() {
    super('Valkey is unreachable');
    this.name = 'ValkeyUnavailable';
  }
}

export async function consumeRate(bucket: 'vote' | 'post', memberId: string, limit: number): Promise<RateDecision> {
  if (!commands) throw new ValkeyUnavailable();
  const key = `${config.valkey.keyPrefix}rl:${bucket}:${memberId}`;
  const now = Date.now() / 1000;
  const member = `${now}:${Math.random().toString(36).slice(2)}`;
  try {
    const result = (await commands.eval(RATE_LIMIT_SCRIPT, 1, key, String(now), '60', String(limit), member)) as [
      number,
      number,
    ];
    const allowed = Number(result[0]) === 1;
    return { allowed, retryAfter: allowed ? 0 : Math.max(1, Math.ceil(Number(result[1]))) };
  } catch {
    throw new ValkeyUnavailable();
  }
}

export async function publishEvent(event: LiveEvent): Promise<void> {
  if (!commands) return;
  try {
    const id = await commands.xadd(
      EVENTS_STREAM,
      'MAXLEN',
      '~',
      String(STREAM_MAX_LENGTH),
      '*',
      'event',
      event.event,
      'data',
      JSON.stringify(event.data),
      'topics',
      event.topics.join(','),
    );
    if (id) {
      await commands.publish(LIVE_CHANNEL, JSON.stringify({ id, ...event }));
    }
  } catch {
    // Events produced while Valkey is unreachable are dropped and never fail their action.
  }
}

export function onLiveEvent(handler: (entry: StreamEntry) => void): void {
  if (!subscriber) return;
  const subscribe = () => {
    void subscriber.subscribe(LIVE_CHANNEL).catch(() => undefined);
  };
  subscriber.on('ready', subscribe);
  subscribe();
  subscriber.on('message', (channel: string, payload: string) => {
    if (channel !== LIVE_CHANNEL) return;
    try {
      const parsed = JSON.parse(payload) as StreamEntry;
      handler(parsed);
    } catch {
      // a malformed payload cannot be fanned out
    }
  });
}

function parseEntries(rows: Array<[string, string[]]>): StreamEntry[] {
  return rows.map(([id, fields]) => {
    const record: Record<string, string> = {};
    for (let index = 0; index < fields.length; index += 2) record[fields[index]] = fields[index + 1];
    return {
      id,
      event: record.event ?? '',
      data: record.data ? (JSON.parse(record.data) as unknown) : null,
      topics: record.topics ? record.topics.split(',') : [],
    };
  });
}

export interface ReplayResult {
  entries: StreamEntry[];
  resync: boolean;
}

/** Replays retained events after an id, or asks the browser to resync when that id has been trimmed. */
export async function replayAfter(lastEventId: string): Promise<ReplayResult> {
  if (!commands) throw new ValkeyUnavailable();
  try {
    const retained = (await commands.xrange(EVENTS_STREAM, lastEventId, lastEventId)) as Array<[string, string[]]>;
    const streamLength = await commands.xlen(EVENTS_STREAM);
    if (retained.length === 0 && streamLength > 0) return { entries: [], resync: true };
    const rows = (await commands.xrange(EVENTS_STREAM, `(${lastEventId}`, '+')) as Array<[string, string[]]>;
    return { entries: parseEntries(rows), resync: false };
  } catch {
    throw new ValkeyUnavailable();
  }
}

export async function valkeyAvailable(): Promise<boolean> {
  if (!commands) return false;
  try {
    await commands.ping();
    return true;
  } catch {
    return false;
  }
}
