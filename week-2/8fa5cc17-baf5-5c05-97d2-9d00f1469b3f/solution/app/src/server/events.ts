// The live sync channel: numbered workspace events stored in PostgreSQL, streamed as SSE.
import type { ServerResponse } from 'node:http';
import { db, type Tx } from './db.ts';
import type { Json } from './errors.ts';

const KEEP_ALIVE_MS = 15_000;
const KEEP_EVENTS_MS = 60 * 60_000; // kept for replay for at least 10 minutes
const SESSION_END_CLOSE_MS = 1000;

export type WorkspaceEvent =
  | 'block.saved' | 'block.removed' | 'backlinks.changed' | 'object.saved' | 'object.removed' | 'board.saved'
  | 'settings.saved' | 'share_link.changed' | 'sessions.changed';

interface Channel { sessionId: string; res: ServerResponse; onClose: () => void }

const channels = new Set<Channel>();
let broadcastThrough = 0;
let pumping: Promise<void> = Promise.resolve();
const listeners = new Set<(event: string, data: Json) => void>();

/** Records a numbered event inside the transaction; it is streamed only after COMMIT. */
export async function emit(tx: Tx, event: WorkspaceEvent, data: Json): Promise<void> {
  const [{ last_id: id }] = await tx.query<{ last_id: number }>('UPDATE sync_sequence SET last_id = last_id + 1 WHERE id = 1 RETURNING last_id');
  await tx.query('INSERT INTO sync_events (id, event, data, created_at) VALUES ($1, $2, $3, now())', [id, event, JSON.stringify(data)]);
  tx.afterCommit(pump);
}

/** Server-side subscribers (share cache invalidation) see every committed event in order. */
export function onEvent(fn: (event: string, data: Json) => void): void {
  listeners.add(fn);
}

function frame(event: string, data: Json, id?: number): string {
  return `${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Streams every committed event above the last broadcast id, in id order, one pump at a time. */
export function pump(): Promise<void> {
  pumping = pumping.then(async () => {
    const rows = await db.query<{ id: number; event: string; data: Json }>(
      'SELECT id, event, data FROM sync_events WHERE id > $1 ORDER BY id', [broadcastThrough]);
    for (const row of rows) {
      broadcastThrough = row.id;
      const text = frame(row.event, row.data, row.id);
      for (const ch of channels) ch.res.write(text);
      for (const fn of listeners) fn(row.event, row.data);
    }
  }).catch(() => undefined);
  return pumping;
}

/** Events without ids (presence) go straight to every channel. */
export function broadcastUnnumbered(event: string, data: Json): void {
  const text = frame(event, data);
  for (const ch of channels) ch.res.write(text);
}

export async function initEvents(): Promise<void> {
  const [row] = await db.query<{ last_id: number }>('SELECT last_id FROM sync_sequence WHERE id = 1');
  broadcastThrough = row.last_id;
  setInterval(() => {
    db.query("DELETE FROM sync_events WHERE created_at < now() - make_interval(secs => $1)", [KEEP_EVENTS_MS / 1000]).catch(() => undefined);
  }, 60_000).unref();
}

export async function openChannel(res: ServerResponse, sessionId: string, lastEventId: string | undefined, onClose: () => void): Promise<void> {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 2000\n\n');
  const channel: Channel = { sessionId, res, onClose };
  // Replay runs inside the pump chain so no live event slips between the replay and joining the channel.
  pumping = pumping.then(async () => {
    if (lastEventId !== undefined) {
      const n = /^\d+$/.test(lastEventId.trim()) ? Number(lastEventId.trim()) : NaN;
      const [bounds] = await db.query<{ oldest: number | null }>('SELECT min(id) AS oldest FROM sync_events');
      const latest = broadcastThrough;
      const reachable = Number.isSafeInteger(n) && n <= latest && (n === latest || (bounds.oldest !== null && n >= bounds.oldest - 1));
      if (!reachable) {
        res.write(frame('sync.reset', {}, latest));
      } else {
        const missed = await db.query<{ id: number; event: string; data: Json }>(
          'SELECT id, event, data FROM sync_events WHERE id > $1 AND id <= $2 ORDER BY id', [n, latest]);
        for (const row of missed) res.write(frame(row.event, row.data, row.id));
      }
    }
    channels.add(channel);
  }).catch(() => undefined);
  await pumping;
  const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), KEEP_ALIVE_MS);
  res.on('close', () => {
    clearInterval(keepAlive);
    channels.delete(channel);
    channel.onClose();
  });
}

/** A rotated session keeps its open channels under its new id. */
export function rotateChannels(oldId: string, newId: string): void {
  for (const ch of channels) if (ch.sessionId === oldId) ch.sessionId = newId;
}

/** Sends `session.ended` to a session's channels and closes them. */
export function endSessionChannels(sessionId: string): void {
  for (const ch of channels) {
    if (ch.sessionId !== sessionId) continue;
    ch.res.write(frame('session.ended', {}));
    setTimeout(() => ch.res.end(), SESSION_END_CLOSE_MS).unref();
  }
}
