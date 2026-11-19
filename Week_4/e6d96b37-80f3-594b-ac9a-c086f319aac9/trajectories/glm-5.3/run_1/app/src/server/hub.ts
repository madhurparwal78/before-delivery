import type { Response } from "express";
import type { Actor, DeskEvent, EventType } from "../shared/types.js";
import { pool } from "./db.js";
import { now as clockNow } from "./clock.js";

interface DeskStream {
  ns: string;
  role: "dealer" | "counterpart";
  subject: string;
  send: (event: string) => void;
  close: () => void;
  lastSeen: number;
}

const streams = new Map<number, DeskStream>();
let streamCounter = 0;

export interface AppendEventInput {
  ns: string;
  commandId: string;
  actor: Actor;
  type: EventType;
}

export async function appendEvent(
  tx: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  input: AppendEventInput,
): Promise<DeskEvent> {
  const at = await clockNow(input.ns);
  const res = (await tx.query(
    "INSERT INTO events (ns, command_id, actor, type, at, payload) VALUES ($1, $2, $3, $4, $5, $6) RETURNING sequence",
    [input.ns, input.commandId, input.actor, input.type, at, JSON.stringify({})],
  )) as { rows: { sequence: string }[] };
  const sequence = Number(res.rows[0].sequence);
  return {
    command_id: input.commandId,
    actor: input.actor,
    type: input.type,
    sequence,
    at: at.toISOString(),
  };
}

export async function eventsAfter(ns: string, after: number): Promise<DeskEvent[]> {
  const res = await pool.query<{ command_id: string; actor: string; type: string; sequence: string; at: Date }>(
    "SELECT command_id, actor, type, sequence, at FROM events WHERE ns = $1 AND sequence > $2 ORDER BY sequence",
    [ns, after],
  );
  return res.rows.map((row) => ({
    command_id: row.command_id,
    actor: row.actor as Actor,
    type: row.type as EventType,
    sequence: Number(row.sequence),
    at: new Date(row.at).toISOString(),
  }));
}

export function registerStream(stream: Omit<DeskStream, "lastSeen">): number {
  const id = ++streamCounter;
  streams.set(id, { ...stream, lastSeen: Date.now() });
  return id;
}

export function touchStream(id: number): void {
  const s = streams.get(id);
  if (s) s.lastSeen = Date.now();
}

export function dropStream(id: number): void {
  streams.delete(id);
}

export function activeStreamsFor(ns: string, role: "dealer" | "counterpart", subject: string): number {
  let count = 0;
  for (const s of streams.values()) {
    if (s.ns === ns && s.role === role && s.subject === subject) count++;
  }
  return count;
}

export function broadcast(ns: string, event: DeskEvent): void {
  const payload = `id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const s of streams.values()) {
    if (s.ns === ns) {
      s.send(payload);
      s.lastSeen = Date.now();
    }
  }
}

export function sseInit(res: Response): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(":\n\n");
}

export function sseComment(res: Response): void {
  res.write(": keep-alive\n\n");
}

export async function recordEvent(ns: string, commandId: string, actor: Actor, type: EventType): Promise<DeskEvent> {
  const at = await clockNow(ns);
  const res = await pool.query<{ sequence: string }>(
    "INSERT INTO events (ns, command_id, actor, type, at, payload) VALUES ($1, $2, $3, $4, $5, $6) RETURNING sequence",
    [ns, commandId, actor, type, at, JSON.stringify({})],
  );
  const sequence = Number(res.rows[0].sequence);
  const event: DeskEvent = { command_id: commandId, actor, type, sequence, at: at.toISOString() };
  broadcast(ns, event);
  return event;
}
