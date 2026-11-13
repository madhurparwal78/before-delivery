import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { type DrawingState, type LiveClient, type PresenceEntry, broadcast, loadDrawing, messagesSince } from './drawings.js';
import { roleForFolder } from './access.js';
import { usernameForToken } from './sessions.js';
import { cookies, isCrossOrigin } from './http.js';
import { config } from './config.js';
import { now, onClockAdvance } from './clock.js';
import { newId } from './ids.js';
import { one } from './db.js';

const sockets = new WebSocketServer({ noServer: true });

interface LinkClient {
  socket: WebSocket;
  versionId: string;
  linkId: string;
}

const linkClients = new Set<LinkClient>();

function presenceList(state: DrawingState): Record<string, unknown>[] {
  return [...state.presence.values()]
    .filter((entry) => entry.connections.size > 0 || (entry.leaveAt !== null && entry.leaveAt > now()))
    .map((entry) => ({
      username: entry.username,
      colour: entry.colour,
      x: entry.x,
      y: entry.y,
      zoom: entry.zoom,
      pan_x: entry.pan_x,
      pan_y: entry.pan_y,
    }));
}

function freeColour(state: DrawingState): number {
  const used = new Set([...state.presence.values()].map((entry) => entry.colour));
  for (let index = 1; index <= 8; index += 1) {
    if (!used.has(index)) return index;
  }
  return 8;
}

async function sendPresence(state: DrawingState): Promise<void> {
  await broadcast(state, 'presence', { people: presenceList(state) }, undefined, { keep: false });
}

function sweepPresence(): void {
  for (const state of drawingStates()) {
    let changed = false;
    for (const [username, entry] of state.presence) {
      if (entry.connections.size > 0 || entry.leaveAt === null) continue;
      if (entry.leaveAt <= now()) {
        state.presence.delete(username);
        changed = true;
      }
    }
    if (changed) void sendPresence(state);
  }
}

const watchedStates = new Set<DrawingState>();

function drawingStates(): DrawingState[] {
  return [...watchedStates];
}

setInterval(sweepPresence, 250);
onClockAdvance(sweepPresence);

export async function handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (isCrossOrigin(request)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  const drawingMatch = /^\/api\/drawings\/([^/]+)\/live$/.exec(url.pathname);
  const linkMatch = /^\/api\/links\/([^/]+)\/live$/.exec(url.pathname);
  if (drawingMatch) {
    const token = cookies(request).plot_session;
    const username = token ? await usernameForToken(token) : null;
    const state = await loadDrawing(decodeURIComponent(drawingMatch[1]));
    const role = state && username ? await roleForFolder(username, state.folder_id) : null;
    if (!state || !username || !role) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      attachDrawingSocket(ws, state, username);
    });
    return;
  }
  if (linkMatch) {
    const row = await one<{ id: string; version_id: string }>('select id, version_id from links where token = $1', [
      decodeURIComponent(linkMatch[1]),
    ]);
    if (!row) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      const client: LinkClient = { socket: ws, versionId: row.version_id, linkId: row.id };
      linkClients.add(client);
      ws.on('close', () => linkClients.delete(client));
    });
    return;
  }
  socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
  socket.destroy();
}

export function broadcastLink(linkId: string, data: Record<string, unknown>): void {
  let seq = 0;
  for (const client of linkClients) {
    if (client.linkId !== linkId) continue;
    seq += 1;
    client.socket.send(JSON.stringify({ seq, type: 'link', data }));
  }
}

function attachDrawingSocket(ws: WebSocket, state: DrawingState, username: string): void {
  watchedStates.add(state);
  const connectionId = newId('con');
  const client: LiveClient = {
    username,
    connectionId,
    send: (message) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
    },
    close: () => ws.close(),
  };
  state.clients.add(client);

  const entry: PresenceEntry =
    state.presence.get(username) ??
    ({
      username,
      colour: freeColour(state),
      x: 0,
      y: 0,
      zoom: 1,
      pan_x: 0,
      pan_y: 0,
      connections: new Set<string>(),
      leaveAt: null,
    } satisfies PresenceEntry);
  entry.connections.add(connectionId);
  entry.leaveAt = null;
  state.presence.set(username, entry);

  const keepAlive = setInterval(() => {
    if (ws.readyState === ws.OPEN) ws.ping();
  }, 20000);

  ws.on('message', (raw) => {
    void handleClientMessage(state, client, raw.toString());
  });
  ws.on('close', () => {
    clearInterval(keepAlive);
    state.clients.delete(client);
    const presence = state.presence.get(username);
    if (presence) {
      presence.connections.delete(connectionId);
      if (presence.connections.size === 0) presence.leaveAt = now() + config.presenceTimeoutMs;
    }
  });
  void sendPresence(state);
}

interface ClientMessage {
  type: string;
  since?: number;
  x?: number;
  y?: number;
  zoom?: number;
  pan_x?: number;
  pan_y?: number;
}

async function handleClientMessage(state: DrawingState, client: LiveClient, raw: string): Promise<void> {
  let message: ClientMessage;
  try {
    message = JSON.parse(raw) as ClientMessage;
  } catch {
    return;
  }
  if (message.type === 'hello') {
    const since = typeof message.since === 'number' ? message.since : 0;
    for (const missed of messagesSince(state, since, client.username)) client.send(missed);
    client.send({ seq: state.liveSeq, type: 'presence', data: { people: presenceList(state) } });
    return;
  }
  if (message.type === 'pointer') {
    const entry = state.presence.get(client.username);
    if (!entry) return;
    entry.x = typeof message.x === 'number' ? message.x : entry.x;
    entry.y = typeof message.y === 'number' ? message.y : entry.y;
    entry.zoom = typeof message.zoom === 'number' ? message.zoom : entry.zoom;
    entry.pan_x = typeof message.pan_x === 'number' ? message.pan_x : entry.pan_x;
    entry.pan_y = typeof message.pan_y === 'number' ? message.pan_y : entry.pan_y;
    await sendPresence(state);
  }
}
