import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { Letter, Conversation } from '../shared/types.js';
import { accountForSession } from './accounts.js';

// Live updates over the WebSocket served by the same server. DP-12, DP-15.
export type ServerFrame =
  | { type: 'letter'; letter: Letter }
  | { type: 'conversation'; conversation: Conversation }
  | { type: 'keys'; account_id: string }
  | { type: 'signed_out' };

interface SocketEntry {
  socket: WebSocket;
  accountId: string;
}

export class Hub {
  private sockets = new Set<SocketEntry>();
  private wss: WebSocketServer | null = null;

  attach(server: import('node:http').Server): void {
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on('connection', (socket, request) => this.onConnection(socket, request));
    server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (request.url !== '/ws') {
        socket.destroy();
        return;
      }
      const cookieHeader = request.headers.cookie ?? '';
      const token = readSessionCookie(cookieHeader);
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      void accountForSession(token).then((account) => {
        if (!account) {
          socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
        this.wss!.handleUpgrade(request, socket, head, (ws) => this.wss!.emit('connection', ws, request));
      });
    });
  }

  private onConnection(socket: WebSocket, request: IncomingMessage): void {
    const cookieHeader = request.headers.cookie ?? '';
    const token = readSessionCookie(cookieHeader);
    void accountForSession(token ?? '').then((account) => {
      if (!account) {
        socket.close(1008, 'unauthenticated');
        return;
      }
      const entry: SocketEntry = { socket, accountId: account.id };
      this.sockets.add(entry);
      socket.on('close', () => this.sockets.delete(entry));
      socket.on('error', () => this.sockets.delete(entry));
    });
  }

  send(accountId: string, frame: ServerFrame): void {
    const text = JSON.stringify(frame);
    for (const entry of this.sockets) {
      if (entry.accountId === accountId && entry.socket.readyState === WebSocket.OPEN) {
        entry.socket.send(text);
      }
    }
  }

  sendToMany(accountIds: Iterable<string>, frame: (accountId: string) => ServerFrame): void {
    for (const id of accountIds) this.send(id, frame(id));
  }

  hasSocketsFor(accountId: string): boolean {
    for (const entry of this.sockets) if (entry.accountId === accountId) return true;
    return false;
  }

  accountIds(): Set<string> {
    return new Set([...this.sockets].map((e) => e.accountId));
  }

  close(): void {
    for (const entry of this.sockets) entry.socket.close();
    this.sockets.clear();
    this.wss?.close();
  }
}

export function readSessionCookie(header: string): string | null {
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'airfold_session') return rest.join('=');
  }
  return null;
}
