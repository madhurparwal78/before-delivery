import type { WebSocket } from 'ws';
import type { ServerFrame } from '../shared/types.js';

interface Client {
  socket: WebSocket;
  sessionHash: Buffer;
}

const clients = new Map<string, Set<Client>>();

export function attach(accountId: string, socket: WebSocket, sessionHash: Buffer): void {
  const client: Client = { socket, sessionHash };
  const set = clients.get(accountId) ?? new Set<Client>();
  set.add(client);
  clients.set(accountId, set);
  socket.on('close', () => {
    set.delete(client);
    if (set.size === 0) clients.delete(accountId);
  });
}

export function push(accountId: string, frame: ServerFrame): void {
  const payload = JSON.stringify(frame);
  for (const client of clients.get(accountId) ?? []) {
    if (client.socket.readyState === client.socket.OPEN) client.socket.send(payload);
  }
}

/** Tells every browser of the account except the one holding `keep` that it is signed out, then closes it. */
export function signOutOthers(accountId: string, keep: Buffer): void {
  const payload = JSON.stringify({ type: 'signed_out' } satisfies ServerFrame);
  for (const client of [...(clients.get(accountId) ?? [])]) {
    if (client.sessionHash.equals(keep)) continue;
    if (client.socket.readyState === client.socket.OPEN) client.socket.send(payload);
    client.socket.close();
  }
}

export function pingAll(): void {
  for (const set of clients.values()) {
    for (const client of set) {
      if ((client.socket as WebSocket & { alive?: boolean }).alive === false) client.socket.terminate();
      (client.socket as WebSocket & { alive?: boolean }).alive = false;
      client.socket.ping();
    }
  }
}
