import { query, tx } from '../db/pool.js';
import type { PoolClient } from 'pg';

export type StreamName = 'server' | 'world' | 'table';

export interface EventDraft {
  readonly serverId: string;
  readonly stream: StreamName;
  /** The world or table the event belongs to; the server itself for `server`. */
  readonly scopeId: string;
  readonly kind: string;
  readonly payload: unknown;
  /** User ids the event is meant for, or null for every member. */
  readonly audience?: readonly string[] | null;
}

export interface StoredEvent {
  readonly seq: number;
  readonly kind: string;
  readonly payload: unknown;
  readonly audience: readonly string[] | null;
}

/**
 * Appends an event, taking the next id from the one strictly increasing
 * sequence the server keeps.
 */
export async function appendEvent(draft: EventDraft, client?: PoolClient): Promise<number> {
  const run = async (c: PoolClient): Promise<number> => {
    const next = await c.query<{ event_seq: string }>(
      'UPDATE servers SET event_seq = event_seq + 1 WHERE id = $1 RETURNING event_seq',
      [draft.serverId],
    );
    const row = next.rows[0];
    if (row === undefined) return 0;
    const seq = Number(row.event_seq);
    await c.query(
      `INSERT INTO server_events (server_id, seq, stream, scope_id, kind, payload, audience)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        draft.serverId,
        seq,
        draft.stream,
        draft.scopeId,
        draft.kind,
        JSON.stringify(draft.payload),
        draft.audience === undefined || draft.audience === null
          ? null
          : JSON.stringify(draft.audience),
      ],
    );
    return seq;
  };
  const seq = client === undefined ? await tx(run) : await run(client);
  wake(draft.serverId);
  return seq;
}

export async function latestSeq(serverId: string): Promise<number> {
  const rows = await query<{ event_seq: string }>('SELECT event_seq FROM servers WHERE id = $1', [
    serverId,
  ]);
  const row = rows[0];
  return row === undefined ? 0 : Number(row.event_seq);
}

export async function eventsAfter(
  serverId: string,
  stream: StreamName,
  scopeId: string,
  afterSeq: number,
): Promise<StoredEvent[]> {
  const rows = await query<{
    seq: string;
    kind: string;
    payload: unknown;
    audience: string[] | null;
  }>(
    `SELECT seq, kind, payload, audience
       FROM server_events
      WHERE server_id = $1 AND stream = $2 AND scope_id = $3 AND seq > $4
      ORDER BY seq`,
    [serverId, stream, scopeId, afterSeq],
  );
  return rows.map((row) => ({
    seq: Number(row.seq),
    kind: row.kind,
    payload: row.payload,
    audience: row.audience,
  }));
}

/** History is kept for 30 minutes; a resume from further back gets a snapshot. */
export const HISTORY_SECONDS = 1800;

export async function oldestKeptSeq(serverId: string): Promise<number> {
  const rows = await query<{ seq: string }>(
    `SELECT min(seq) AS seq FROM server_events
      WHERE server_id = $1 AND created_at > now() - interval '${HISTORY_SECONDS} seconds'`,
    [serverId],
  );
  const row = rows[0];
  return row === undefined || row.seq === null ? 0 : Number(row.seq);
}

export async function pruneEvents(): Promise<void> {
  await query(
    `DELETE FROM server_events WHERE created_at < now() - interval '${HISTORY_SECONDS} seconds'`,
  );
}

/* A nudge so that a change on this instance reaches its own subscribers at once,
   while subscribers still poll so that changes on other instances arrive too. */

const waiters = new Map<string, Set<() => void>>();

function wake(serverId: string): void {
  const set = waiters.get(serverId);
  if (set === undefined) return;
  for (const resolve of [...set]) resolve();
}

export function waitForEvent(serverId: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let set = waiters.get(serverId);
    if (set === undefined) {
      set = new Set();
      waiters.set(serverId, set);
    }
    const done = (): void => {
      clearTimeout(timer);
      set?.delete(done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    set.add(done);
  });
}
