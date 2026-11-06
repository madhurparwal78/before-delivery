/** The per-server event log. One strictly increasing integer sequence per server.
 * Every event-stream notification flows through here. */

import type { Pool, Queryer } from "../db/pool.js";

export type EventKind =
  | "server"
  | "presence"
  | "friends"
  | "party"
  | "leaderboard"
  | "weather"
  | "invite"
  | "trade"
  | "achievement"
  | "world"
  | "chat"
  | "table"
  | "announcement";

export interface Audience {
  /** User handles allowed to see the event; empty or null means everyone on the server. */
  users?: string[];
  /** Character ids allowed to see the event (used by trade events for the two parties). */
  characters?: string[];
  /** The world slug scoping a world event. */
  world?: string;
  /** The table id scoping a table event. */
  table?: string;
}

export interface QueuedEvent {
  seq: string;
  kind: EventKind;
  payload: unknown;
  audience: Audience | null;
  created_at: Date;
}

export interface PublishInput {
  kind: EventKind;
  payload: unknown;
  audience?: Audience;
}

/** Publishes events inside the caller's transaction. The seq comes from an atomic per-server counter. */
export async function publishTx(tx: Queryer, serverId: string, events: PublishInput[]): Promise<void> {
  if (events.length === 0) return;
  for (const event of events) {
    await tx.query(
      `INSERT INTO events (server_id, seq, kind, payload, audience)
       VALUES ($1, next_event_seq($1), $2, $3, $4)`,
      [serverId, event.kind, JSON.stringify(event.payload), event.audience === undefined ? null : JSON.stringify(event.audience)]
    );
  }
}

/** Publishes events in its own transaction. */
export async function publish(pool: Pool, serverId: string, events: PublishInput[]): Promise<void> {
  if (events.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const event of events) {
      await client.query(
        `INSERT INTO events (server_id, seq, kind, payload, audience)
         VALUES ($1, next_event_seq($1), $2, $3, $4)`,
        [serverId, event.kind, JSON.stringify(event.payload), event.audience === undefined ? null : JSON.stringify(event.audience)]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface EventRow {
  seq: string;
  kind: EventKind;
  payload: unknown;
  audience: Audience | null;
  created_at: Date;
}

export async function latestSeq(pool: Pool, serverId: string): Promise<number> {
  const res = await pool.query<{ max: string | null }>("SELECT MAX(seq) AS max FROM events WHERE server_id = $1", [serverId]);
  return Number(res.rows[0]?.max ?? 0);
}

export async function eventsAfter(pool: Pool, serverId: string, afterSeq: number, limit: number): Promise<EventRow[]> {
  const res = await pool.query<EventRowDb>(
    "SELECT seq::text as seq, kind, payload, audience, created_at FROM events WHERE server_id = $1 AND seq > $2 ORDER BY seq ASC LIMIT $3",
    [serverId, afterSeq, limit]
  );
  return res.rows.map(rowFromDb);
}

interface EventRowDb {
  seq: string;
  kind: EventKind;
  payload: unknown;
  audience: Audience | null;
  created_at: Date;
}

function rowFromDb(row: EventRowDb): EventRow {
  return {
    seq: row.seq,
    kind: row.kind,
    payload: row.payload,
    audience: row.audience,
    created_at: row.created_at,
  };
}

export function visibleTo(event: EventRow, userId: string, userHandle: string, userCharacterIds: Set<string>, worldSlug: string | null, tableId: string | null): boolean {
  void userId;
  const audience = event.audience;
  if (audience === null) return true;
  void userId;
  if (audience.world !== undefined && worldSlug !== null && audience.world !== worldSlug) return false;
  if (audience.table !== undefined && tableId !== null && audience.table !== tableId) return false;
  if (audience.users !== undefined && !audience.users.includes(userHandle)) return false;
  if (audience.characters !== undefined) {
    const mine = [...userCharacterIds].some((id) => audience.characters!.includes(id));
    if (!mine) return false;
  }
  return true;
}

/** Prunes events older than 30 minutes. */
export async function pruneEvents(pool: Pool): Promise<void> {
  await pool.query("DELETE FROM events WHERE created_at < now() - interval '30 minutes'");
}
