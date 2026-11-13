import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';

export interface SseClient {
  id: string;
  res: ServerResponse;
  topics: Set<string>;
  playerId: string | null;
  sessionId: string | null;
}

const clients = new Set<SseClient>();
const presenceListeners = new Set<(playerId: string) => void>();

export function addClient(res: ServerResponse, topics: string[], playerId: string | null, sessionId: string | null): SseClient {
  const client: SseClient = { id: randomUUID(), res, topics: new Set(topics), playerId, sessionId };
  clients.add(client);
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
  res.write(`event: ready\ndata: {"ok":true}\n\n`);
  if (playerId) notifyPresence(playerId);
  return client;
}

export function removeClient(client: SseClient): void {
  clients.delete(client);
  if (client.playerId) notifyPresence(client.playerId);
}

export function onPresenceChange(listener: (playerId: string) => void): void {
  presenceListeners.add(listener);
}

function notifyPresence(playerId: string): void {
  for (const listener of presenceListeners) listener(playerId);
}

export function isOnline(playerId: string): boolean {
  for (const client of clients) {
    if (client.playerId === playerId) return true;
  }
  return false;
}

export function tableViewers(tableId: string): SseClient[] {
  const topic = `table:${tableId}`;
  return [...clients].filter((client) => client.topics.has(topic));
}

export type Payload = unknown | ((client: SseClient) => unknown);

export function publish(topic: string, type: string, payload: Payload): void {
  for (const client of clients) {
    if (!client.topics.has(topic)) continue;
    const data = typeof payload === 'function' ? (payload as (client: SseClient) => unknown)(client) : payload;
    if (data === undefined) continue;
    send(client, type, data);
  }
}

export function send(client: SseClient, type: string, data: unknown): void {
  try {
    client.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    clients.delete(client);
  }
}

export function heartbeat(): void {
  for (const client of clients) {
    try {
      client.res.write(`: ping\n\n`);
    } catch {
      clients.delete(client);
    }
  }
}
