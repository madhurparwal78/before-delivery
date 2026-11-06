import { ServerResponse } from 'node:http';
import { query, queryOne, Tx } from './db/pool';

export type LiveEventType =
  | 'block.saved'
  | 'block.removed'
  | 'backlinks.changed'
  | 'object.saved'
  | 'object.removed'
  | 'board.saved'
  | 'settings.saved'
  | 'share_link.changed'
  | 'sessions.changed'
  | 'sync.reset';

export type LiveEvent = { type: LiveEventType; data: Record<string, unknown> };

export const EVENT_RETRY_MS = 2000;
export const KEEP_ALIVE_MS = 15_000;
export const EVENT_KEEP_MINUTES = 30;

type Connection = { sessionId: string; response: ServerResponse };

const connections = new Set<Connection>();

function writeEvent(response: ServerResponse, type: string, data: unknown, id: number | null): void {
  let frame = '';
  if (id !== null) frame += `id: ${id}\n`;
  frame += `event: ${type}\n`;
  frame += `data: ${JSON.stringify(data)}\n\n`;
  response.write(frame);
}

/** Record events in PostgreSQL inside the change's transaction, then publish them. */
export async function recordEvents(tx: Tx, events: LiveEvent[]): Promise<{ id: number; event: LiveEvent }[]> {
  const stored: { id: number; event: LiveEvent }[] = [];
  for (const event of events) {
    const rows = await tx.query<{ id: string }>(
      'insert into sync_event (type, data) values ($1, $2) returning id::text as id',
      [event.type, JSON.stringify(event.data)],
    );
    stored.push({ id: Number(rows[0].id), event });
  }
  return stored;
}

export function publish(stored: { id: number; event: LiveEvent }[]): void {
  for (const entry of stored) {
    for (const connection of connections) {
      writeEvent(connection.response, entry.event.type, entry.event.data, entry.id);
    }
  }
}

/** Presence events carry no id, are never kept and are never replayed. */
export function publishPresence(data: Record<string, unknown>): void {
  for (const connection of connections) {
    writeEvent(connection.response, 'presence.changed', data, null);
  }
}

export function publishSessionEnded(sessionIds: string[]): void {
  for (const connection of [...connections]) {
    if (!sessionIds.includes(connection.sessionId)) continue;
    writeEvent(connection.response, 'session.ended', {}, null);
    connection.response.end();
    connections.delete(connection);
  }
}

export async function openStream(
  response: ServerResponse,
  sessionId: string,
  lastEventId: string | undefined,
): Promise<void> {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.write(`retry: ${EVENT_RETRY_MS}\n\n`);
  const connection: Connection = { sessionId, response };
  connections.add(connection);

  if (lastEventId !== undefined) {
    const latest = await queryOne<{ max: string | null }>('select max(id)::text as max from sync_event');
    const oldest = await queryOne<{ min: string | null }>('select min(id)::text as min from sync_event');
    const latestId = latest?.max === null || latest?.max === undefined ? 0 : Number(latest.max);
    const oldestId = oldest?.min === null || oldest?.min === undefined ? 0 : Number(oldest.min);
    const parsed = /^\d+$/.test(lastEventId.trim()) ? Number(lastEventId.trim()) : null;
    const reachesBack = parsed !== null && (oldestId === 0 || parsed >= oldestId - 1);
    if (parsed === null || parsed > latestId || !reachesBack) {
      writeEvent(response, 'sync.reset', {}, latestId);
    } else {
      const rows = await query<{ id: string; type: string; data: Record<string, unknown> }>(
        'select id::text as id, type, data from sync_event where id > $1 order by id asc',
        [parsed],
      );
      for (const row of rows) writeEvent(response, row.type, row.data, Number(row.id));
    }
  }

  const keepAlive = setInterval(() => {
    response.write(': keep-alive\n\n');
  }, KEEP_ALIVE_MS);
  const close = () => {
    clearInterval(keepAlive);
    connections.delete(connection);
  };
  response.on('close', close);
  response.on('error', close);
}

export function startEventPruning(): NodeJS.Timeout {
  return setInterval(() => {
    void query(`delete from sync_event where created_at < now() - interval '${EVENT_KEEP_MINUTES} minutes'`).catch(
      () => undefined,
    );
  }, 60_000);
}
