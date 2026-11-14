import type { WebSocket } from "ws";
import type { Position } from "./domain/grammar.ts";
import type { Payload } from "../shared/wire.ts";

/** One open WebSocket on a session. Pushes to a held seat queue up and are released in order. */
export interface Connection {
  socket: WebSocket;
  sessionId: string;
  userId: string;
  queue: { position: Position; message: string }[];
}

const connections = new Map<string, Set<Connection>>();
const held = new Set<string>();

const holdKey = (sessionId: string, position: Position): string => `${sessionId}:${position}`;

export function register(connection: Connection): void {
  const set = connections.get(connection.sessionId) ?? new Set<Connection>();
  set.add(connection);
  connections.set(connection.sessionId, set);
}

export function unregister(connection: Connection): void {
  const set = connections.get(connection.sessionId);
  set?.delete(connection);
  if (set?.size === 0) connections.delete(connection.sessionId);
}

export const hasOtherConnection = (sessionId: string, userId: string): boolean =>
  [...(connections.get(sessionId) ?? [])].some((c) => c.userId === userId);

const positionOf = (payload: Payload, userId: string): Position | null =>
  payload.seats.GND?.id === userId ? "GND" : payload.seats.TWR?.id === userId ? "TWR" : null;

function deliver(connection: Connection, message: string, position: Position | null): void {
  if (position !== null && held.has(holdKey(connection.sessionId, position))) connection.queue.push({ position, message });
  else if (connection.socket.readyState === connection.socket.OPEN) connection.socket.send(message);
}

/** Sends each payload, in order, to every client of the session. */
export function push(sessionId: string, payloads: Payload[]): void {
  for (const payload of payloads) {
    const message = JSON.stringify({ type: "state", payload });
    for (const connection of connections.get(sessionId) ?? []) deliver(connection, message, positionOf(payload, connection.userId));
  }
}

export function sendTo(connection: Connection, payload: Payload): void {
  connection.socket.send(JSON.stringify({ type: "state", payload }));
}

export function setHold(sessionId: string, position: Position, hold: boolean): void {
  const key = holdKey(sessionId, position);
  if (hold) {
    held.add(key);
    return;
  }
  held.delete(key);
  for (const connection of connections.get(sessionId) ?? []) {
    const released = connection.queue.filter((push) => push.position === position);
    connection.queue = connection.queue.filter((push) => push.position !== position);
    if (connection.socket.readyState !== connection.socket.OPEN) continue;
    for (const push of released) connection.socket.send(push.message);
  }
}
