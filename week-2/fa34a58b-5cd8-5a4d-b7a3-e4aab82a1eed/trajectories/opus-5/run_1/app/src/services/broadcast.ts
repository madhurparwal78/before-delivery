import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { buildStatus } from '../status';
import type { SocketMessage } from '../shared/types';
import { isSameOrigin } from '../http/origin';

const STATUS_HEARTBEAT_MS = 5000;

const sockets = new Set<WebSocket>();
let wss: WebSocketServer | null = null;

export function broadcast(message: SocketMessage): void {
  const text = JSON.stringify(message);
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) socket.send(text);
  }
}

export async function publishStatus(): Promise<void> {
  if (sockets.size === 0) return;
  broadcast({ type: 'status', ...(await buildStatus()) });
}

export function attachSocket(server: Server): void {
  wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (socket: WebSocket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));
    void buildStatus().then((status) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'status', ...status }));
      }
    });
  });

  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/api/socket' || !isSameOrigin(request)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss?.handleUpgrade(request, socket, head, (client) => {
      wss?.emit('connection', client, request);
    });
  });

  setInterval(() => {
    void publishStatus();
  }, STATUS_HEARTBEAT_MS).unref();
}
