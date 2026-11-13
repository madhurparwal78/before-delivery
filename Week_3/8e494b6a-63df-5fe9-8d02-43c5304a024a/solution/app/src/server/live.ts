// Live messages: a per-space sequence number kept in Postgres, a short in-memory replay buffer, and fan-out to open streams.
import { pool, type Queryable } from "./db";

export type MessageType = "clock" | "alert" | "inbox" | "case" | "upload" | "lifecycle";

interface LiveMessage {
  seq: number;
  type: MessageType;
  data: Record<string, unknown>;
}

export interface Outgoing {
  type: MessageType;
  data: Record<string, unknown>;
}

const REPLAY_LIMIT = 500;
const buffers = new Map<number, LiveMessage[]>();
const listeners = new Map<number, Set<(message: LiveMessage) => void>>();
const chains = new Map<number, Promise<unknown>>();

/** Allocates sequence numbers and fans messages out in order; returns the space's sequence number after them. */
export function emit(spaceId: number, messages: Outgoing[]): Promise<number> {
  const previous = chains.get(spaceId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    let seq = await currentSeq(spaceId);
    for (const message of messages) {
      const { rows } = await pool.query<{ seq: number }>("UPDATE spaces SET seq = seq + 1 WHERE id = $1 RETURNING seq", [spaceId]);
      seq = rows[0]?.seq ?? seq + 1;
      deliver(spaceId, { seq, type: message.type, data: { ...message.data, seq } });
    }
    return seq;
  });
  chains.set(spaceId, next);
  return next;
}

function deliver(spaceId: number, message: LiveMessage): void {
  const buffer = buffers.get(spaceId) ?? [];
  buffer.push(message);
  if (buffer.length > REPLAY_LIMIT) buffer.shift();
  buffers.set(spaceId, buffer);
  for (const listener of listeners.get(spaceId) ?? []) listener(message);
}

/** A clock message for every space, sequenced by one statement that has already advanced each space's counter. */
export function deliverClock(rows: Array<{ id: number; seq: number }>, nowMs: number): void {
  for (const { id, seq } of rows) deliver(id, { seq, type: "clock", data: { now: new Date(nowMs).toISOString(), now_ms: nowMs, seq } });
}

export async function currentSeq(spaceId: number, db: Queryable = pool): Promise<number> {
  const { rows } = await db.query<{ seq: number }>("SELECT seq FROM spaces WHERE id = $1", [spaceId]);
  return rows[0]?.seq ?? 0;
}

export function replaySince(spaceId: number, since: number): LiveMessage[] {
  return (buffers.get(spaceId) ?? []).filter((message) => message.seq > since);
}

export function subscribe(spaceId: number, listener: (message: LiveMessage) => void): () => void {
  const set = listeners.get(spaceId) ?? new Set();
  set.add(listener);
  listeners.set(spaceId, set);
  return () => {
    set.delete(listener);
  };
}
