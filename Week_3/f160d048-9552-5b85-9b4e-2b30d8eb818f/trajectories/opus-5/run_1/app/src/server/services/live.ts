import type { ServerResponse } from 'node:http';
import { Client } from 'pg';
import { config } from '../config';
import { db, type Db } from '../db/pool';
import type { SessionUser } from '../http/context';

export interface Audience {
  all?: boolean;
  roles?: ReadonlyArray<string>;
  user_ids?: ReadonlyArray<string>;
  company_ids?: ReadonlyArray<string>;
}

export type LiveEventType =
  | 'queue.changed'
  | 'queue.history'
  | 'post.state'
  | 'member.unlocked'
  | 'company.changed'
  | 'application.stage'
  | 'channel.post'
  | 'alert.matched';

interface StoredEvent {
  id: string;
  type: LiveEventType;
  payload: Record<string, unknown>;
  audience: Audience;
}

/** Builds the per-viewer data for an event whose payload depends on the viewer. */
export type PayloadRenderer = (
  event: { type: LiveEventType; payload: Record<string, unknown> },
  viewer: SessionUser | null,
) => Promise<Record<string, unknown> | null>;

let renderPayload: PayloadRenderer = async (event) => event.payload;

export function setPayloadRenderer(renderer: PayloadRenderer): void {
  renderPayload = renderer;
}

interface Stream {
  res: ServerResponse;
  viewer: SessionUser | null;
  heartbeat: NodeJS.Timeout;
}

const streams = new Set<Stream>();

function visibleTo(audience: Audience, viewer: SessionUser | null): boolean {
  if (audience.all) return true;
  if (!viewer) return false;
  if (audience.user_ids?.includes(viewer.id)) return true;
  if (audience.roles?.includes(viewer.role)) return true;
  if (viewer.company_id && audience.company_ids?.includes(viewer.company_id)) return true;
  return false;
}

function write(res: ServerResponse, text: string): void {
  if (!res.writableEnded) res.write(text);
}

async function deliver(stream: Stream, event: StoredEvent): Promise<void> {
  if (!visibleTo(event.audience, stream.viewer)) return;
  const data = await renderPayload({ type: event.type, payload: event.payload }, stream.viewer);
  if (!data) return;
  write(stream.res, `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Inserts the event and notifies every instance once the transaction commits. */
export async function publish(
  tx: Db,
  now: Date,
  type: LiveEventType,
  payload: Record<string, unknown>,
  audience: Audience,
): Promise<void> {
  const row = await tx.one<{ id: string }>(
    `INSERT INTO live_events (type, payload, audience, created_at) VALUES ($1, $2, $3, $4) RETURNING id`,
    [type, JSON.stringify(payload), JSON.stringify(audience), now],
  );
  await tx.query(`SELECT pg_notify('live_event', $1)`, [String(row?.id ?? '')]);
}

async function trim(): Promise<void> {
  await db.query(
    `DELETE FROM live_events WHERE id <= (
       SELECT min(id) FROM (SELECT id FROM live_events ORDER BY id DESC LIMIT $1) AS kept
     ) - 1`,
    [config.liveReplayLimit],
  );
}

async function loadEvent(id: string): Promise<StoredEvent | null> {
  return db.one<StoredEvent>('SELECT id::text AS id, type, payload, audience FROM live_events WHERE id = $1', [id]);
}

export async function startListener(): Promise<void> {
  const client = new Client({ connectionString: config.databaseUrl });
  client.on('notification', (message) => {
    void (async () => {
      if (!message.payload) return;
      const event = await loadEvent(message.payload);
      if (!event) return;
      for (const stream of streams) await deliver(stream, event);
    })();
  });
  client.on('error', () => {
    client.end().catch(() => undefined);
    setTimeout(() => void startListener(), 2000);
  });
  await client.connect();
  await client.query('LISTEN live_event');
}

export async function openStream(
  res: ServerResponse,
  viewer: SessionUser | null,
  lastEventId: string | null,
): Promise<void> {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  write(res, 'retry: 1000\n\n');

  const stream: Stream = {
    res,
    viewer,
    heartbeat: setInterval(() => write(res, ': keep-alive\n\n'), 15000),
  };
  streams.add(stream);
  res.on('close', () => {
    clearInterval(stream.heartbeat);
    streams.delete(stream);
  });

  const bounds = await db.one<{ oldest: string | null; newest: string | null }>(
    'SELECT min(id)::text AS oldest, max(id)::text AS newest FROM live_events',
  );
  const since = lastEventId !== null && /^\d+$/.test(lastEventId) ? Number(lastEventId) : null;
  const oldest = bounds?.oldest ? Number(bounds.oldest) : null;

  if (since === null || (oldest !== null && since < oldest - 1)) {
    write(res, `event: hello\ndata: ${JSON.stringify({ replay: 'reload' })}\n\n`);
    return;
  }

  const missed = await db.query<StoredEvent>(
    'SELECT id::text AS id, type, payload, audience FROM live_events WHERE id > $1 ORDER BY id',
    [since],
  );
  for (const event of missed) await deliver(stream, event);
  write(res, `event: hello\ndata: ${JSON.stringify({ replay: 'complete' })}\n\n`);
}

export function closeAllStreams(): number {
  const count = streams.size;
  for (const stream of streams) {
    clearInterval(stream.heartbeat);
    stream.res.end();
  }
  streams.clear();
  return count;
}

export async function trimReplayBuffer(): Promise<void> {
  await trim();
}
