import type { WebSocket } from 'ws';
import type { Page, Role } from '../shared/document.js';
import { config } from './env.js';

export interface PresencePerson {
  userId: string;
  name: string;
  role: Role;
}

export interface OpBroadcast {
  t: 'op';
  seq: number;
  actor: { id: string; name: string };
  kind: string;
  pages: Page[];
  removedPages: string[];
  order: { id: string; order: number }[];
  rerouted: string[];
  versionName?: string;
}

export type ServerMessage =
  | OpBroadcast
  | { t: 'ack'; opId: string; seq: number; ids: Record<string, string>; rerouted: string[] }
  | {
      t: 'opError';
      opId: string;
      code: string;
      message: string;
      fields?: Record<string, string>;
      by?: string;
    }
  | { t: 'undoSkipped'; opId: string; by: string; shape: string | null }
  | { t: 'replaced'; by: string; shape: string | null }
  | { t: 'presence'; list: PresencePerson[]; joined?: PresencePerson }
  | { t: 'cursor'; userId: string; name: string; page: string; x: number; y: number }
  | { t: 'cursorGone'; userId: string }
  | { t: 'role'; role: Role }
  | { t: 'comments' }
  | { t: 'versions' }
  | { t: 'members' }
  | { t: 'exports' };

export interface Client {
  socket: WebSocket;
  diagramId: string;
  sessionId: string;
  userId: string;
  name: string;
  role: Role;
  alive: boolean;
}

const clients = new Map<string, Set<Client>>();

function roomOf(diagramId: string): Set<Client> {
  const existing = clients.get(diagramId);
  if (existing) return existing;
  const room = new Set<Client>();
  clients.set(diagramId, room);
  return room;
}

export function presenceList(diagramId: string): PresencePerson[] {
  const people = new Map<string, PresencePerson>();
  for (const client of roomOf(diagramId)) {
    people.set(client.userId, { userId: client.userId, name: client.name, role: client.role });
  }
  return [...people.values()];
}

export function send(client: Client, message: ServerMessage): void {
  if (client.socket.readyState === client.socket.OPEN) {
    client.socket.send(JSON.stringify(message));
  }
}

export function broadcast(diagramId: string, message: ServerMessage, exceptUser?: string): void {
  for (const client of roomOf(diagramId)) {
    if (exceptUser !== undefined && client.userId === exceptUser) continue;
    send(client, message);
  }
}

export function sendToUser(diagramId: string, userId: string, message: ServerMessage): void {
  for (const client of roomOf(diagramId)) {
    if (client.userId === userId) send(client, message);
  }
}

/** True when this is the person's first socket on the diagram, so others hear them join once. */
export function addClient(client: Client): boolean {
  const room = roomOf(client.diagramId);
  const first = ![...room].some((c) => c.userId === client.userId);
  room.add(client);
  return first;
}

/** True when that was the person's last socket on the diagram. */
export function removeClient(client: Client): boolean {
  const room = roomOf(client.diagramId);
  room.delete(client);
  return ![...room].some((c) => c.userId === client.userId);
}

export function clientsOfSession(sessionId: string): Client[] {
  const matches: Client[] = [];
  for (const room of clients.values()) {
    for (const client of room) {
      if (client.sessionId === sessionId) matches.push(client);
    }
  }
  return matches;
}

export function clientsOfDiagram(diagramId: string): Client[] {
  return [...roomOf(diagramId)];
}

export function clientsOfUser(diagramId: string, userId: string): Client[] {
  return [...roomOf(diagramId)].filter((c) => c.userId === userId);
}

/** A role change shows on the person's open screen and in everyone's presence avatars. */
export function applyRoleChange(diagramId: string, userId: string, role: Role): void {
  for (const client of roomOf(diagramId)) {
    if (client.userId === userId) {
      client.role = role;
      send(client, { t: 'role', role });
    }
  }
  broadcast(diagramId, { t: 'presence', list: presenceList(diagramId) });
  broadcast(diagramId, { t: 'members' });
}

export function closeClients(targets: readonly Client[], code: number): void {
  for (const client of targets) client.socket.close(code);
}

/**
 * Liveness is checked with WebSocket-level pings, never with page timers. A socket that
 * has not answered within the presence timeout is dropped.
 */
export function startPresencePings(): NodeJS.Timeout {
  const interval = Math.max(500, Math.floor(config.presenceTimeoutMs / 2));
  const timer = setInterval(() => {
    for (const room of clients.values()) {
      for (const client of [...room]) {
        if (!client.alive) {
          client.socket.terminate();
          continue;
        }
        client.alive = false;
        client.socket.ping();
      }
    }
  }, interval);
  timer.unref();
  return timer;
}
