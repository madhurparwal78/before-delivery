import { Redis } from 'ioredis';
import { config, LEASE_TTL_MS, STREAM_MAX_LEN } from '../config.js';

function makeClient(): Redis {
  const client = new Redis(config.valkeyUrl, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: () => 2000,
  });
  client.on('error', () => undefined);
  return client;
}

const commandClient = makeClient();
const readClient = makeClient();

let up = false;
let lastProbe = 0;

export async function probeValkey(): Promise<boolean> {
  try {
    await commandClient.ping();
    up = true;
  } catch {
    up = false;
  }
  lastProbe = Date.now();
  return up;
}

/** Gives the first connection a moment so boot does not read a false outage. */
export async function awaitValkeyReady(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (commandClient.status !== 'ready' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return probeValkey();
}

export async function ensureProbed(maxAgeMs = 1000): Promise<boolean> {
  if (Date.now() - lastProbe > maxAgeMs) await probeValkey();
  return up;
}

export function sessionStream(sessionId: string): string {
  return `gandyboard:session:${sessionId}:events`;
}

export function layoutStream(layoutId: string): string {
  return `gandyboard:layout:${layoutId}:events`;
}

export function leaseKey(sessionId: string): string {
  return `gandyboard:session:${sessionId}:tick-lease`;
}

export async function appendEvent(
  stream: string,
  seq: number,
  type: string,
  payload: string,
): Promise<void> {
  try {
    await commandClient.xadd(
      stream,
      'MAXLEN',
      String(STREAM_MAX_LEN),
      `${seq}-0`,
      'type',
      type,
      'payload',
      payload,
    );
    up = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('equal or smaller')) return;
    throw error;
  }
}

export interface StreamEntry {
  seq: number;
  type: string;
  payload: string;
}

function parseEntries(entries: [string, string[]][]): StreamEntry[] {
  return entries.map(([id, fields]) => {
    const record = new Map<string, string>();
    for (let index = 0; index + 1 < fields.length; index += 2) {
      record.set(fields[index], fields[index + 1]);
    }
    return {
      seq: Number.parseInt(id.split('-')[0] ?? '0', 10),
      type: record.get('type') ?? '',
      payload: record.get('payload') ?? '{}',
    };
  });
}

export async function rangeAfter(stream: string, afterSeq: number): Promise<StreamEntry[]> {
  const entries = (await readClient.xrange(stream, `${afterSeq + 1}-0`, '+')) as [
    string,
    string[],
  ][];
  return parseEntries(entries ?? []);
}

export async function lastSeq(stream: string): Promise<number> {
  const entries = (await readClient.xrevrange(stream, '+', '-', 'COUNT', 1)) as [
    string,
    string[],
  ][];
  if (!entries || entries.length === 0) return 0;
  return Number.parseInt(entries[0][0].split('-')[0] ?? '0', 10);
}

export async function firstSeq(stream: string): Promise<number | null> {
  const entries = (await readClient.xrange(stream, '-', '+', 'COUNT', 1)) as [string, string[]][];
  if (!entries || entries.length === 0) return null;
  return Number.parseInt(entries[0][0].split('-')[0] ?? '0', 10);
}

export async function readBlocking(
  cursors: { stream: string; lastSeq: number }[],
  blockMs: number,
): Promise<{ stream: string; entries: StreamEntry[] }[]> {
  if (cursors.length === 0) return [];
  const tail: string[] = [];
  for (const cursor of cursors) tail.push(cursor.stream);
  for (const cursor of cursors) tail.push(`${cursor.lastSeq}-0`);
  const result = (await readClient.xread(
    'COUNT',
    200,
    'BLOCK',
    blockMs,
    'STREAMS',
    ...tail,
  )) as [string, [string, string[]][]][] | null;
  up = true;
  if (!result) return [];
  return result.map(([stream, entries]) => ({ stream, entries: parseEntries(entries) }));
}

const RENEW_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0`;

export async function takeLease(sessionId: string, instanceId: string): Promise<boolean> {
  const held = await commandClient.set(
    leaseKey(sessionId),
    instanceId,
    'PX',
    LEASE_TTL_MS,
    'NX',
  );
  return held === 'OK';
}

export async function renewLease(sessionId: string, instanceId: string): Promise<boolean> {
  const result = await commandClient.eval(
    RENEW_SCRIPT,
    1,
    leaseKey(sessionId),
    instanceId,
    String(LEASE_TTL_MS),
  );
  return result === 1;
}

export async function allLeases(): Promise<Map<string, string[]>> {
  const grouped = new Map<string, string[]>();
  const keys = await commandClient.keys('gandyboard:session:*:tick-lease');
  for (const key of keys) {
    const holder = await commandClient.get(key);
    if (!holder) continue;
    const sessionId = key.split(':')[2] ?? '';
    const list = grouped.get(holder) ?? [];
    list.push(sessionId);
    grouped.set(holder, list);
  }
  return grouped;
}
