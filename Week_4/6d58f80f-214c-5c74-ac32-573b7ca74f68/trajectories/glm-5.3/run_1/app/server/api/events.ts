import type { WebSocket } from 'ws';
import type { Person } from '../domain/types.js';

export interface AppEvent {
  type: string;
  data: Record<string, unknown>;
}

interface ClientConn {
  ws: WebSocket;
  personId: string;
  personKind: 'staff' | 'partner';
}

const connections = new Set<ClientConn>();

export function registerConnection(ws: WebSocket, person: Person): ClientConn {
  const conn: ClientConn = { ws, personId: person.id, personKind: person.kind };
  connections.add(conn);
  return conn;
}

export function dropConnection(conn: ClientConn): void {
  connections.delete(conn);
}

export function broadcast(event: AppEvent): void {
  const payload = JSON.stringify(event);
  for (const conn of connections) {
    if (conn.ws.readyState === conn.ws.OPEN) {
      void conn.ws.send(payload);
    }
  }
}

export function pushEventToPerson(personId: string, event: AppEvent): void {
  const payload = JSON.stringify(event);
  for (const conn of connections) {
    if (conn.personId === personId && conn.ws.readyState === conn.ws.OPEN) {
      void conn.ws.send(payload);
    }
  }
}

export function pushNoticeToPerson(personId: string, kind: string, params: Record<string, string>): void {
  pushEventToPerson(personId, { type: 'notice', data: { kind, ...params } });
}
