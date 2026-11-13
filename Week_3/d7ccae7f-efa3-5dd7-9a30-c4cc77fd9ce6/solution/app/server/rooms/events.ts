import { roomEventSchema, type RoomEvent, type StoredEvent } from "../../shared/schemas.js";
import { pool, transaction, type Tx } from "../db.js";
import { publishEvents, readReplayBuffer } from "../live/valkey.js";

const waiters = new Map<string, Set<() => void>>();

// Appends one event inside the caller's transaction; the room row is locked by the id increment.
export async function appendEvent(tx: Tx, roomId: string, event: RoomEvent): Promise<StoredEvent> {
  const next = await tx.query<{ last_event_id: string }>("UPDATE rooms SET last_event_id = last_event_id + 1 WHERE id = $1 RETURNING last_event_id", [roomId]);
  const id = Number((next.rows[0] as { last_event_id: string }).last_event_id);
  await tx.query("INSERT INTO room_events (room_id, id, type, data) VALUES ($1, $2, $3, $4)", [roomId, id, event.type, JSON.stringify(event.data)]);
  return { ...event, id };
}

// An event that belongs to no transition (presence); an ended room takes none, so `ended` stays the last event.
export async function appendStandalone(roomId: string, event: RoomEvent): Promise<void> {
  const stored = await transaction(async (tx) => {
    const room = await tx.query<{ state: string }>("SELECT state FROM rooms WHERE id = $1 FOR UPDATE", [roomId]);
    return room.rows[0] && room.rows[0].state !== "ended" ? appendEvent(tx, roomId, event) : null;
  });
  if (stored) await announce(roomId, [stored]);
}

// After commit: wake this process's pollers, then copy the events into Valkey (replay buffer and fan-out).
export async function announce(roomId: string, events: StoredEvent[]): Promise<void> {
  for (const wake of waiters.get(roomId) ?? []) wake();
  await publishEvents(roomId, events);
}

type EventRow = { id: string; type: string; data: unknown };

function storedEvents(rows: EventRow[]): StoredEvent[] {
  return rows.map((row) => ({ ...roomEventSchema.parse({ type: row.type, data: row.data }), id: Number(row.id) }));
}

export async function eventsAfter(roomId: string, afterId: number, upToId?: number): Promise<StoredEvent[]> {
  const result = await pool.query<EventRow>(
    "SELECT id, type, data FROM room_events WHERE room_id = $1 AND id > $2 AND id <= $3 ORDER BY id",
    [roomId, afterId, upToId ?? Number.MAX_SAFE_INTEGER],
  );
  return storedEvents(result.rows);
}

// Events newer than afterId in order: from the Valkey buffer when it reaches back far enough, else from Postgres.
export async function replayAfter(roomId: string, afterId: number): Promise<StoredEvent[]> {
  const buffer = await readReplayBuffer(roomId);
  const ordered = buffer?.sort((a, b) => a.id - b.id) ?? [];
  const oldest = ordered[0];
  const covered = oldest !== undefined && oldest.id <= afterId + 1 && ordered.every((event, i) => i === 0 || event.id === (ordered[i - 1]?.id ?? 0) + 1);
  return covered ? ordered.filter((event) => event.id > afterId) : eventsAfter(roomId, afterId);
}

// Resolves when this process announces events for the room, after `ms`, or when the signal aborts.
export function waitForEvents(roomId: string, ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const set = waiters.get(roomId) ?? new Set<() => void>();
    waiters.set(roomId, set);
    const done = (): void => {
      clearTimeout(timer);
      set.delete(done);
      if (set.size === 0) waiters.delete(roomId);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    set.add(done);
    signal.addEventListener("abort", done);
  });
}
