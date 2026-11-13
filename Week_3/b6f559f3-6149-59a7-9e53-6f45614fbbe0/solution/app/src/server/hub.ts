/** The WebSocket hub: live edits, presence, layer locks and new versions for open editors and embeds. */
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { type ClientMessage, type Person, type ServerMessage, WS_PATH } from '../shared/protocol';
import { findProject } from './access';
import { databaseReady, snapshot } from './db';
import { projectSeq } from './documents';
import { cookieToken, isOwnOrigin, personOfToken, type Person as SessionPerson } from './http';
import { activeLocks } from './locks';

interface Connection {
  socket: WebSocket;
  person: SessionPerson | null;
  /** Editors and viewers: the project they have open. */
  projectId: string | null;
  /** Embed pages: the project whose version announcements they follow. */
  embedId: string | null;
  alive: boolean;
}

const NOT_FOUND_CLOSE = 4404;

const connections = new Set<Connection>();

const send = (socket: WebSocket, message: ServerMessage): void => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
};

function peopleIn(projectId: string): Person[] {
  const seen = new Map<string, Person>();
  for (const c of connections) if (c.projectId === projectId && c.person) seen.set(c.person.id, { id: c.person.id, name: c.person.name });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Sends a message to everyone who has the project open (and to its embeds when it is a version announcement). */
export function broadcast(projectId: string, message: ServerMessage): void {
  for (const c of connections) {
    if (c.projectId === projectId) send(c.socket, message);
    else if (c.embedId === projectId && message.type === 'version') send(c.socket, message);
  }
}

/** Tells open embeds and editors that a new version is live. */
export function announceVersion(projectId: string, number: number): void {
  broadcast(projectId, { type: 'version', number });
}

/** Tells open editors to refetch the member list. */
export function announceMembers(projectId: string): void {
  broadcast(projectId, { type: 'members' });
}

/**
 * Closes sockets that may no longer see a project: one person's (they were removed) or, with no person, everyone's
 * and the embeds' (the project is gone).
 */
export function dropConnections(projectId: string, personId?: string): void {
  for (const c of connections) {
    const theirs = c.projectId === projectId && (personId === undefined || c.person?.id === personId);
    if (theirs || (personId === undefined && c.embedId === projectId)) c.socket.close(NOT_FOUND_CLOSE, 'not_found');
  }
}

/** Ends every socket, so a stopping server is not held open by them. */
export function closeConnections(): void {
  for (const c of connections) c.socket.terminate();
}

const announcePresence = (projectId: string): void => broadcast(projectId, { type: 'presence', people: peopleIn(projectId) });

function parseMessage(data: RawData): ClientMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(data.toString());
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { type, projectId } = value as Record<string, unknown>;
  const named = (type === 'subscribe' || type === 'embed') && typeof projectId === 'string' && !projectId.includes('\u0000');
  return named ? ({ type, projectId } as ClientMessage) : null;
}

async function subscribe(connection: Connection, projectId: string): Promise<void> {
  if (!connection.person || !(await findProject(connection.person.id, projectId))) return void connection.socket.close(NOT_FOUND_CLOSE, 'not_found');
  connection.projectId = projectId;
  const { seq, locks } = await snapshot(async (client) => ({ seq: await projectSeq(client, projectId), locks: await activeLocks(projectId, client) }));
  send(connection.socket, { type: 'hello', seq, people: peopleIn(projectId), locks });
  announcePresence(projectId);
}

export function attachHub(server: Server): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const origin = req.headers.origin;
    if (req.url?.split('?')[0] !== WS_PATH || !databaseReady() || (origin !== undefined && !isOwnOrigin(origin, req.headers.host))) {
      socket.destroy();
      return;
    }
    void personOfToken(cookieToken(req.headers.cookie)).then((person) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        const connection: Connection = { socket: ws, person, projectId: null, embedId: null, alive: true };
        connections.add(connection);
        ws.on('pong', () => {
          connection.alive = true;
        });
        ws.on('message', (data) => {
          const message = parseMessage(data);
          if (message?.type === 'subscribe' && connection.projectId === null) void subscribe(connection, message.projectId).catch(() => ws.close());
          else if (message?.type === 'embed') connection.embedId = message.projectId;
        });
        ws.on('close', () => {
          connections.delete(connection);
          if (connection.projectId) announcePresence(connection.projectId);
        });
        ws.on('error', () => ws.close());
      });
    }, () => socket.destroy());
  });

  setInterval(() => {
    for (const c of connections) {
      if (!c.alive) c.socket.terminate();
      else {
        c.alive = false;
        c.socket.ping();
      }
    }
  }, 20000).unref();
}
