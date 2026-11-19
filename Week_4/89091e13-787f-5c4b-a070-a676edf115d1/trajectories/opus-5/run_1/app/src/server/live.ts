import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { db } from './db.js';
import { readCookie } from './http.js';
import { LiveEvent } from '../shared/live.js';

export type { LiveEvent };

const sockets = new Map<WebSocket, string>();

export function broadcast(workspaceId: string, event: LiveEvent): void {
  const message = JSON.stringify(event);
  for (const [socket, id] of sockets) {
    if (id === workspaceId && socket.readyState === WebSocket.OPEN) socket.send(message);
  }
}

const queued: { workspaceId: string; event: LiveEvent }[] = [];

/** Queues an event raised inside a database transaction. */
export function emitEvent(workspaceId: string, event: LiveEvent): void {
  queued.push({ workspaceId, event });
}

/** Pushes queued events once their transaction has committed. */
export function flushEvents(): void {
  for (const item of queued) broadcast(item.workspaceId, item.event);
  queued.length = 0;
}

export function dropEvents(): void {
  queued.length = 0;
}

async function memberOf(request: IncomingMessage, workspaceId: string): Promise<boolean> {
  const token = readCookie(request.headers.cookie, 'fs_session');
  if (!token) return false;
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM sessions s
       JOIN members m ON m.person_id = s.person_id
     WHERE s.token = $1 AND m.workspace_id = $2`,
    [token, workspaceId],
  );
  return rows[0].count !== '0';
}

export function attachLiveChannel(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const match = /^\/api\/w\/([^/]+)\/live$/.exec(new URL(request.url ?? '/', 'http://localhost').pathname);
    if (!match) {
      socket.destroy();
      return;
    }
    const workspaceId = decodeURIComponent(match[1]);
    void memberOf(request, workspaceId).then((allowed) => {
      if (!allowed) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        sockets.set(ws, workspaceId);
        ws.on('close', () => sockets.delete(ws));
        ws.on('error', () => sockets.delete(ws));
      });
    });
  });
}
