import { ServerResponse } from 'node:http';
import { Db, db, nextCounter } from '../db/pool';

export type LiveEventType =
  | 'stock'
  | 'price'
  | 'collection'
  | 'order'
  | 'return'
  | 'trial'
  | 'warranty'
  | 'cart'
  | 'wishlist'
  | 'notification'
  | 'queue';

export type LiveEvent = {
  seq: number;
  type: LiveEventType;
  data: unknown;
  audience_user_id: string | null;
  staff_only: boolean;
};

export type Audience = { userId?: string | null; staffOnly?: boolean };

export async function publish(
  client: Db,
  type: LiveEventType,
  data: unknown,
  audience: Audience = {}
): Promise<number> {
  const seq = await nextCounter(client, 'live_event_seq', 1);
  await client.query(
    'INSERT INTO live_events (seq, type, data, audience_user_id, staff_only) VALUES ($1, $2, $3::jsonb, $4, $5)',
    [seq, type, JSON.stringify(data), audience.userId ?? null, audience.staffOnly ?? false]
  );
  return seq;
}

type Client = {
  response: ServerResponse;
  userId: string | null;
  isStaff: boolean;
  lastSeq: number;
};

const clients = new Set<Client>();
let cursor = 0;
let started = false;

function visible(event: LiveEvent, client: Client): boolean {
  if (event.staff_only) return client.isStaff;
  if (event.audience_user_id !== null) {
    return client.isStaff || client.userId === event.audience_user_id;
  }
  return true;
}

function send(client: Client, event: LiveEvent): void {
  client.lastSeq = event.seq;
  client.response.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
}

async function loadAfter(seq: number): Promise<LiveEvent[]> {
  const rows = await db.query<{
    seq: string;
    type: string;
    data: unknown;
    audience_user_id: string | null;
    staff_only: boolean;
  }>(
    `SELECT seq, type, data, audience_user_id, staff_only FROM live_events
     WHERE seq > $1 ORDER BY seq ASC LIMIT 500`,
    [seq]
  );
  return rows.map((row) => ({
    seq: Number(row.seq),
    type: row.type as LiveEventType,
    data: row.data,
    audience_user_id: row.audience_user_id,
    staff_only: row.staff_only
  }));
}

async function pump(): Promise<void> {
  if (clients.size === 0) return;
  const minSeq = Math.min(...[...clients].map((client) => client.lastSeq));
  if (minSeq < cursor) cursor = minSeq;
  const events = await loadAfter(cursor);
  if (events.length === 0) return;
  for (const event of events) {
    for (const client of clients) {
      if (event.seq > client.lastSeq && visible(event, client)) send(client, event);
      else if (event.seq > client.lastSeq) client.lastSeq = event.seq;
    }
  }
  cursor = events[events.length - 1].seq;
}

export function startLivePump(): void {
  if (started) return;
  started = true;
  setInterval(() => {
    void pump().catch(() => undefined);
  }, 400);
}

export async function currentSeq(): Promise<number> {
  const row = await db.one<{ value: string }>("SELECT value FROM counters WHERE name = 'live_event_seq'");
  return row === null ? 0 : Number(row.value);
}

export async function attach(
  response: ServerResponse,
  options: { userId: string | null; isStaff: boolean; after: number | null }
): Promise<void> {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const latest = await currentSeq();
  let start = options.after === null ? latest : options.after;
  let needsReset = false;
  if (options.after !== null) {
    const row = await db.one<{ at: string }>('SELECT at FROM live_events WHERE seq = $1', [options.after]);
    if (row !== null && Date.now() - new Date(row.at).getTime() > 24 * 60 * 60 * 1000) needsReset = true;
    if (row === null && options.after > 0 && options.after < latest) needsReset = true;
  }
  if (needsReset) {
    response.write(`event: reset\ndata: {}\n\n`);
    start = latest;
  }

  const client: Client = { response, userId: options.userId, isStaff: options.isStaff, lastSeq: start };
  response.write(`event: ready\ndata: ${JSON.stringify({ seq: start })}\n\n`);

  if (start < latest) {
    const backlog = await loadAfter(start);
    for (const event of backlog) {
      if (visible(event, client)) send(client, event);
      else client.lastSeq = event.seq;
    }
  }

  clients.add(client);
  const heartbeat = setInterval(() => {
    response.write(': keep-alive\n\n');
  }, 15000);

  const close = (): void => {
    clearInterval(heartbeat);
    clients.delete(client);
  };
  response.on('close', close);
  response.on('error', close);
}
