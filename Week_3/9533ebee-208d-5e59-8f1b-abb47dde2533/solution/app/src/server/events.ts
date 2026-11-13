import { randomUUID } from "node:crypto";
import { one, rows, unlocked, type Tx } from "./db.js";
import { deliverEvent } from "./svix.js";
import { toInstant } from "./time.js";

// Integrator events use the transactional outbox: each event is written in the same transaction as the change that
// causes it, and one sender at a time delivers them to Svix in the order they were written, so within a position
// event n+1 is never sent before Svix has accepted event n.

export type EventType = "settlement.committed" | "position.state_changed";

export interface EventPayload {
  event_id: string;
  type: EventType;
  position_id: string | null;
  sequence: number | null;
  occurred_at: string;
  data: Record<string, string | null>;
}

/**
 * Writes one event to the outbox. An event of a position takes the position's next sequence number (counting from 1,
 * across both types); a withdrawal's event has neither position nor sequence.
 */
export async function emit(
  tx: Tx,
  event: { id?: string; type: EventType; positionId: string | null; occurredAt: Date; data: Record<string, string | null> },
): Promise<string> {
  const eventId = event.id ?? randomUUID();
  const counted =
    event.positionId === null
      ? null
      : await one<{ event_seq: number }>(tx, "UPDATE positions SET event_seq = event_seq + 1 WHERE position_id = $1 RETURNING event_seq", [event.positionId]);
  const payload: EventPayload = {
    event_id: eventId,
    type: event.type,
    position_id: event.positionId,
    sequence: counted?.event_seq ?? null,
    occurred_at: toInstant(event.occurredAt),
    data: event.data,
  };
  await tx.query("INSERT INTO outbox (event_id, position_id, payload) VALUES ($1, $2, $3)", [eventId, event.positionId, JSON.stringify(payload)]);
  return eventId;
}

/** `delivered` only once Svix has accepted the event. */
export async function webhookStatusOf(tx: Tx, eventId: string): Promise<"queued" | "delivered"> {
  const [row] = await rows<{ delivered_at: Date | null }>(tx, "SELECT delivered_at FROM outbox WHERE event_id = $1", [eventId]);
  return row?.delivered_at ? "delivered" : "queued";
}

const OUTBOX_SENDER_LOCK = 4_173_002;

/**
 * Delivers queued events oldest first, one transaction each. Only one process sends at a time (a transaction-scoped
 * advisory lock), so order is kept across processes; while Svix is unreachable the round stops and the events stay
 * queued for the next one.
 */
export async function deliverQueuedEvents(): Promise<void> {
  for (let delivered = true; delivered; ) {
    delivered = await unlocked(async (tx) => {
      const lock = await one<{ locked: boolean }>(tx, "SELECT pg_try_advisory_xact_lock($1) AS locked", [OUTBOX_SENDER_LOCK]);
      if (!lock?.locked) return false;
      const event = await one<{ event_id: string; payload: EventPayload }>(
        tx,
        "SELECT event_id, payload FROM outbox WHERE delivered_at IS NULL ORDER BY seq LIMIT 1",
      );
      if (!event) return false;
      await deliverEvent(event.payload);
      await tx.query("UPDATE outbox SET delivered_at = now() WHERE event_id = $1", [event.event_id]);
      return true;
    });
  }
}
