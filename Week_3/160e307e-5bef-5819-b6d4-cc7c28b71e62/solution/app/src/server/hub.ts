import type { WebSocket } from "ws";
import type { Seat } from "../shared/types";

/** Open sockets, who they belong to, and what they have joined. Nothing here is persisted. */

export const PING_EVERY_MS = 2000;
const PONG_WITHIN_MS = 5000;

export interface Connection {
  socket: WebSocket;
  playerId: string;
  matchId: string | null;
  /** The tab's reconnect token from session storage; a reloaded tab sends the same one. */
  tabToken: string | null;
  lastHeard: number;
}

const connections = new Set<Connection>();

/** Adds a connection; an earlier socket of the same tab in the same match is stale (the tab reloaded) and is closed. */
export function addConnection(connection: Connection): void {
  connections.add(connection);
  if (!connection.tabToken || !connection.matchId) return;
  for (const c of connections) {
    if (c !== connection && c.playerId === connection.playerId && c.matchId === connection.matchId && c.tabToken === connection.tabToken) {
      c.socket.terminate();
    }
  }
}

export function removeConnection(connection: Connection): void {
  connections.delete(connection);
}

export function send(connection: Connection, message: Record<string, unknown>): void {
  if (connection.socket.readyState === connection.socket.OPEN) connection.socket.send(JSON.stringify(message));
}

export function toMatch(matchId: string, message: Record<string, unknown>, only?: (c: Connection) => boolean): void {
  for (const c of connections) if (c.matchId === matchId && (!only || only(c))) send(c, message);
}

export function toPlayer(playerId: string, message: Record<string, unknown>): void {
  for (const c of connections) if (c.playerId === playerId) send(c, message);
}

export function isPresent(matchId: string, playerId: string): boolean {
  for (const c of connections) if (c.matchId === matchId && c.playerId === playerId) return true;
  return false;
}

export function presentSeats(matchId: string, seatPlayers: readonly [string | null, string | null]): [boolean, boolean] {
  return [0, 1].map((seat) => {
    const id = seatPlayers[seat as Seat];
    return id !== null && isPresent(matchId, id);
  }) as [boolean, boolean];
}

/** Pings every open socket and drops the ones that stayed silent for five seconds. */
export function beat(onDropped: (connection: Connection) => void): void {
  const now = Date.now();
  for (const c of [...connections]) {
    if (now - c.lastHeard > PONG_WITHIN_MS) {
      connections.delete(c);
      c.socket.terminate();
      onDropped(c);
    } else {
      send(c, { type: "ping" });
    }
  }
}
