import type { Pool } from "pg";
import { token } from "./idempotency.js";

/** Live event types published after each change commits. */
export type EventType =
  | "hold.created" | "hold.released" | "hold.expired"
  | "booking.created" | "booking.cancelled" | "booking.seated" | "booking.completed" | "booking.no_show"
  | "walkin.seated"
  | "offer.created" | "offer.claimed" | "offer.lapsed";

export interface LiveEvent {
  type: EventType;
  date: string;
  time: string;
  table_ids: string[];
  party_size: number | null;
  reference?: string;
  name?: string;
  expires_at?: string;
}

/**
 * Publish one event to the date's stream. The id increases in commit order across
 * every app instance (Valkey stream ids are ordered). When Valkey is unreachable
 * the event is recorded as pending so it can be re-published on recovery.
 */
export async function publishEvent(
  pool: Pool, valkey: { publish: (date: string, key: string, payload: Record<string, unknown>) => Promise<string>; trim: (date: string) => Promise<void> },
  event: LiveEvent,
): Promise<void> {
  try {
    await valkey.publish(event.date, event.type, { ...event });
    await valkey.trim(event.date);
  } catch {
    // Valkey is unreachable: remember for later replay.
    await pool.query(
      `INSERT INTO pending_events (id, event) VALUES ($1, $2)`,
      [token(16), JSON.stringify(event)],
    ).catch(() => undefined);
    throw new Error("valkey_unavailable");
  }
}

/** Re-publish events that were committed while Valkey was unreachable. */
export async function flushPendingEvents(
  pool: Pool, valkey: { publish: (date: string, key: string, payload: Record<string, unknown>) => Promise<string>; trim: (date: string) => Promise<void> },
): Promise<void> {
  const rows = await pool.query<{ id: string; event: string }>(
    `SELECT id, event FROM pending_events ORDER BY created_at, id`,
  );
  for (const row of rows.rows) {
    const event = JSON.parse(row.event) as LiveEvent;
    await valkey.publish(event.date, event.type, { ...event });
    await valkey.trim(event.date);
    await pool.query(`DELETE FROM pending_events WHERE id = $1`, [row.id]);
  }
}
