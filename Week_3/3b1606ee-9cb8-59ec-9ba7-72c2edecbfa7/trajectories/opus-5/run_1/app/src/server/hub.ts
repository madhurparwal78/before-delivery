import type { WebSocket } from 'ws';
import type { SocketFrame } from '../shared/types.js';

interface Connection {
  accountId: string;
  token: string;
  socket: WebSocket;
}

const connections = new Set<Connection>();

export function addConnection(accountId: string, token: string, socket: WebSocket): void {
  const connection: Connection = { accountId, token, socket };
  connections.add(connection);
  socket.on('close', () => connections.delete(connection));
}

export function send(accountId: string, frame: SocketFrame): void {
  const payload = JSON.stringify(frame);
  for (const connection of connections) {
    if (connection.accountId === accountId && connection.socket.readyState === 1) {
      connection.socket.send(payload);
    }
  }
}

/** Tells every other browser of an account that it has been signed out. */
export function signOutOthers(accountId: string, keepToken: string): void {
  const payload = JSON.stringify({ type: 'signed_out' } satisfies SocketFrame);
  for (const connection of connections) {
    if (connection.accountId === accountId && connection.token !== keepToken) {
      if (connection.socket.readyState === 1) connection.socket.send(payload);
      connection.socket.close();
    }
  }
}
