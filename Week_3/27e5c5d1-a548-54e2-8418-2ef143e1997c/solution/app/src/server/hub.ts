import type { ServerResponse } from 'node:http';
import { Redis } from 'ioredis';
import type { LiveEvent, Role } from '../shared/types.ts';
import { boardAccess } from './access.ts';
import { sessionAlive } from './auth.ts';
import { database } from './db.ts';
import type { Envelope } from './events.ts';

/**
 * The one seam for live fan-out. Board events travel between the two workers over Valkey, which reconnects
 * on its own and never holds the only copy of anything (a failed publish is dropped). Access and session
 * changes are also checked against PostgreSQL every second, so a stream closes in time even while Valkey is
 * down.
 */

type LiveState = 'up' | 'paused';

interface Stream {
  response: ServerResponse;
  userId: string;
  boardId: string;
  tokenHash: string;
  role: Role;
  heartbeat: NodeJS.Timeout;
}

type RelayMessage = { kind: 'envelope'; envelope: Envelope } | { kind: 'recheck' };

const BOARD_CHANNEL = 'kinfold:board:';
const USER_CHANNEL = 'kinfold:user:';
const RETRY_MS = 1000;
const PROBE_MS = 2000;
const HEARTBEAT_MS = 10_000;
const RECHECK_MS = 1000;

const boardChannel = (boardId: string): string => `${BOARD_CHANNEL}${boardId}`;
const userChannel = (userId: string): string => `${USER_CHANNEL}${userId}`;
const frame = (event: LiveEvent): string => `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;

const streams = new Set<Stream>();
let state: LiveState = 'paused';
let publisher: Redis;
let subscriber: Redis;
let markSettled: () => void = () => undefined;
const settled = new Promise<void>((resolve) => {
  markSettled = resolve;
});

/** Connects to Valkey and starts the per-second access re-check; resolves once the first attempt settles. */
export function startHub(valkeyUrl: string): Promise<void> {
  const options = {
    retryStrategy: () => RETRY_MS,
    connectTimeout: 2000,
    commandTimeout: 2000,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    lazyConnect: true,
  };
  publisher = new Redis(valkeyUrl, options);
  subscriber = new Redis(valkeyUrl, options);
  for (const client of [publisher, subscriber]) {
    client.on('error', () => undefined);
    client.on('close', () => setState('paused'));
  }
  subscriber.on('ready', () => {
    subscriber
      .psubscribe(`${BOARD_CHANNEL}*`, `${USER_CHANNEL}*`)
      .then(probe)
      .catch(() => setState('paused'));
  });
  subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
    try {
      receive(channel, JSON.parse(message) as RelayMessage);
    } catch {
      // a malformed relay message is dropped
    }
  });
  publisher.on('ready', probe);
  subscriber.connect().catch(() => undefined);
  publisher.connect().catch(() => undefined);
  setInterval(probe, PROBE_MS).unref();
  setInterval(() => void recheck(() => true), RECHECK_MS).unref();
  return settled;
}

export const liveState = (): LiveState => state;

function setState(next: LiveState): void {
  markSettled();
  if (next === state) return;
  state = next;
  const event: LiveEvent = next === 'up' ? { type: 'live.resumed', data: {} } : { type: 'live.paused', data: {} };
  for (const stream of streams) stream.response.write(frame(event));
}

function probe(): void {
  if (publisher.status !== 'ready' || subscriber.status !== 'ready') {
    setState('paused');
    return;
  }
  publisher
    .ping()
    .then(() => setState('up'))
    .catch(() => setState('paused'));
}

async function relay(channel: string, message: RelayMessage): Promise<void> {
  try {
    await publisher.publish(channel, JSON.stringify(message));
  } catch {
    setState('paused');
  }
}

export function openStream(
  response: ServerResponse,
  who: { userId: string; boardId: string; tokenHash: string; role: Role },
): void {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.write(': open\n\n');
  const stream: Stream = {
    ...who,
    response,
    heartbeat: setInterval(() => response.write(': keepalive\n\n'), HEARTBEAT_MS),
  };
  streams.add(stream);
  response.on('close', () => drop(stream));
  if (state === 'paused') response.write(frame({ type: 'live.paused', data: {} }));
}

function drop(stream: Stream): void {
  clearInterval(stream.heartbeat);
  streams.delete(stream);
}

function close(stream: Stream, last: LiveEvent): void {
  stream.response.write(frame(last));
  stream.response.end();
  drop(stream);
}

function receive(channel: string, message: RelayMessage): void {
  if (message.kind === 'envelope') {
    deliver(message.envelope);
    return;
  }
  if (channel.startsWith(USER_CHANNEL)) {
    const userId = channel.slice(USER_CHANNEL.length);
    void recheck((stream) => stream.userId === userId);
  } else {
    const boardId = channel.slice(BOARD_CHANNEL.length);
    void recheck((stream) => stream.boardId === boardId);
  }
}

function deliver(envelope: Envelope): void {
  for (const stream of streams) {
    if (stream.boardId !== envelope.boardId) continue;
    for (const delivery of envelope.deliveries) {
      const addressed =
        delivery.audience === 'all' ||
        (delivery.audience === 'observers' ? stream.role === 'observer' : delivery.audience.includes(stream.userId));
      if (addressed) for (const event of delivery.events) stream.response.write(frame(event));
    }
  }
}

/** Tells this worker and the other one that a board's events happened. */
export async function publishEnvelope(envelope: Envelope): Promise<void> {
  if (envelope.deliveries.length === 0) return;
  await relay(boardChannel(envelope.boardId), { kind: 'envelope', envelope });
}

/** Access or session changes: re-check the local streams now and tell the other worker to do the same. */
export async function accessChanged(target: { boardId?: string; userId?: string }): Promise<void> {
  void recheck(
    (stream) =>
      (target.boardId === undefined || stream.boardId === target.boardId) &&
      (target.userId === undefined || stream.userId === target.userId),
  );
  if (target.boardId) await relay(boardChannel(target.boardId), { kind: 'recheck' });
  if (target.userId) await relay(userChannel(target.userId), { kind: 'recheck' });
}

async function recheck(matches: (stream: Stream) => boolean): Promise<void> {
  for (const stream of [...streams].filter(matches)) {
    try {
      if (!(await sessionAlive(database(), stream.tokenHash))) {
        close(stream, { type: 'session.ended', data: {} });
        continue;
      }
      const access = await boardAccess(database(), stream.userId, stream.boardId);
      if ((access?.role ?? null) !== stream.role) {
        close(stream, { type: 'access.changed', data: { role: access?.role ?? null } });
      }
    } catch {
      // the next check tries again
    }
  }
}
