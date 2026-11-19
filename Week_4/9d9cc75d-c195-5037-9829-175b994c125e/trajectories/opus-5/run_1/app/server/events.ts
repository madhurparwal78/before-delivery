import type { ServerResponse } from 'node:http';
import { config } from './config.js';
import { nowIso } from './clock.js';
import { q } from './db.js';

interface Client {
  userId: string;
  res: ServerResponse;
}

const clients = new Set<Client>();

function write(client: Client, event: string, data: unknown): void {
  client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function addClient(userId: string, res: ServerResponse): Client {
  const client: Client = { userId, res };
  clients.add(client);
  const beat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, config.sseHeartbeatMs);
  res.on('close', () => {
    clearInterval(beat);
    clients.delete(client);
  });
  return client;
}

export function sendTo(userId: string, event: string, data: unknown): void {
  for (const client of clients) {
    if (client.userId === userId) write(client, event, data);
  }
}

export function broadcastClock(): void {
  for (const client of clients) write(client, 'clock', { server_now: nowIso() });
}


export function sendEvent(client: Client, event: string, data: unknown): void {
  write(client, event, data);
}

export async function readersOfSource(sourceId: string): Promise<string[]> {
  const rows = await q<{ user_id: string }>(
    `SELECT m.user_id FROM sources s JOIN members m ON m.project_id = s.project_id WHERE s.id = $1`,
    [sourceId],
  );
  return rows.map((r) => r.user_id);
}

export async function broadcastExtract(sourceId: string, payload: Record<string, unknown>): Promise<void> {
  const readers = new Set(await readersOfSource(sourceId));
  for (const client of clients) {
    if (readers.has(client.userId)) write(client, 'extract', payload);
  }
}

export function broadcastExport(userId: string, payload: Record<string, unknown>): void {
  sendTo(userId, 'export', payload);
}

export function broadcastInbox(userId: string, unread: number): void {
  sendTo(userId, 'inbox', { unread });
}

