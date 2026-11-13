import type { PoolClient } from 'pg';

export interface LiveEvent {
  seq: number;
  at: Date;
  type: string;
  data: unknown;
}

/** Persists an event for one person, then broadcasts it. */
export async function emitFor(
  client: PoolClient,
  personId: string,
  type: string,
  data: unknown,
): Promise<LiveEvent> {
  const r = await client.query<{ seq: string; at: Date }>(
    'INSERT INTO live_events (person_id, type, data) VALUES ($1,$2,$3) RETURNING seq, at',
    [personId, type, JSON.stringify(data)],
  );
  const row = r.rows[0]!;
  const event: LiveEvent = { seq: Number(row.seq), at: row.at, type, data };
  broadcast(personId, event);
  return event;
}

/** Persists an event for several people, each with its own sequence. */
export async function emitForAll(
  client: PoolClient,
  personIds: string[],
  type: string,
  data: unknown,
): Promise<void> {
  for (const id of personIds) {
    await emitFor(client, id, type, data);
  }
}

/** Everyone who can see the whole register. */
export async function adminIds(client: PoolClient): Promise<string[]> {
  const r = await client.query<{ id: string }>(
    "SELECT id FROM people WHERE role = 'founder_admin' AND access = 'active'",
  );
  return r.rows.map((x) => x.id);
}

type Listener = (event: LiveEvent) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribe(personId: string, fn: Listener): () => void {
  let set = listeners.get(personId);
  if (!set) {
    set = new Set();
    listeners.set(personId, set);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(personId);
  };
}

export function broadcast(personId: string, event: LiveEvent): void {
  const set = listeners.get(personId);
  if (!set) return;
  for (const fn of set) fn(event);
}

/** Events after `since` for one person, from the most recent 1,000. */
export async function eventsSince(personId: string, since: number): Promise<LiveEvent[]> {
  const { pool } = await import('./db.js');
  const r = await pool.query<{ seq: string; at: Date; type: string; data: unknown }>(
    'SELECT seq::text, at, type, data FROM live_events WHERE person_id = $1 AND seq > $2 ORDER BY seq ASC LIMIT 1000',
    [personId, since],
  );
  return r.rows.map((row) => ({ seq: Number(row.seq), at: new Date(row.at), type: row.type, data: row.data }));
}

export async function latestSeq(personId: string): Promise<number> {
  const { pool } = await import('./db.js');
  const r = await pool.query<{ max: string | null }>(
    'SELECT max(seq)::text AS max FROM live_events WHERE person_id = $1',
    [personId],
  );
  return Number(r.rows[0]?.max ?? 0);
}
