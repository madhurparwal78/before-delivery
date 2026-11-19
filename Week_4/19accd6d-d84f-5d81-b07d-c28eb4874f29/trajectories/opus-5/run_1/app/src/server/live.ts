import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { isCrossOrigin, readCookie } from './http.js';
import { sessionUser } from './store.js';

export type LiveMessage =
  | {
      type: 'version_saved';
      recipeId: string;
      version: number;
      name: string;
      authorId: string;
      authorName: string;
      teamId: string | null;
    }
  | { type: 'membership_changed'; teamId: string };

const server = new WebSocketServer({ noServer: true });
const socketsByUser = new Map<string, Set<WebSocket>>();
let down = false;

export function setLiveOutage(value: boolean): void {
  down = value;
  if (!down) return;
  for (const sockets of socketsByUser.values()) {
    for (const socket of sockets) socket.close(1012, 'live outage');
  }
  socketsByUser.clear();
}

export function isLiveDown(): boolean {
  return down;
}

function refuse(socket: Duplex, status: number, code: string, message: string): void {
  const body = JSON.stringify({ error: { code, message } });
  socket.write(
    `HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : 'Service Unavailable'}\r\n` +
      'content-type: application/json; charset=utf-8\r\n' +
      `content-length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
  socket.destroy();
}

export async function handleLiveUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
  if (isCrossOrigin(request)) {
    refuse(socket, 403, 'forbidden', 'Only same-origin requests are allowed.');
    return;
  }
  if (down) {
    refuse(socket, 503, 'live_unavailable', 'Live updates are unavailable.');
    return;
  }
  const token = readCookie(request, 'wb_session');
  const user = token === null ? null : await sessionUser(token);
  if (user === null) {
    refuse(socket, 401, 'unauthenticated', 'Sign in first.');
    return;
  }
  server.handleUpgrade(request, socket, head, (connection) => {
    const sockets = socketsByUser.get(user.id) ?? new Set<WebSocket>();
    sockets.add(connection);
    socketsByUser.set(user.id, sockets);
    connection.on('close', () => {
      sockets.delete(connection);
      if (sockets.size === 0) socketsByUser.delete(user.id);
    });
  });
}

export function publish(userIds: readonly string[], message: LiveMessage): void {
  if (down) return;
  const text = JSON.stringify(message);
  for (const userId of new Set(userIds)) {
    for (const socket of socketsByUser.get(userId) ?? []) {
      if (socket.readyState === socket.OPEN) socket.send(text);
    }
  }
}
