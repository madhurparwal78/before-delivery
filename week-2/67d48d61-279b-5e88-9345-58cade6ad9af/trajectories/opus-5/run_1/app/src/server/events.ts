import type { ServerResponse } from 'node:http';
import { Client } from 'pg';
import type { ChangeEvent, ServiceStatus } from '../shared/types.js';
import { config } from './env.js';
import { pool } from './db/pool.js';
import { onServiceStatus, serviceStatus } from './services/monitor.js';

const clients = new Set<ServerResponse>();

export function addEventClient(response: ServerResponse): void {
  clients.add(response);
  response.on('close', () => clients.delete(response));
  write(response, 'status', serviceStatus(), null);
}

function write(
  response: ServerResponse,
  event: string,
  data: unknown,
  id: number | null,
): void {
  if (id !== null) response.write(`id: ${id}\n`);
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event: string, data: unknown, id: number | null): void {
  for (const response of clients) write(response, event, data, id);
}

export function broadcastChange(change: ChangeEvent): void {
  broadcast('change', change, change.change);
}

function broadcastStatus(status: ServiceStatus): void {
  broadcast('status', status, null);
}

/** Change events reach the tabs of every server process sharing the database. */
export function startEventStream(): void {
  onServiceStatus(broadcastStatus);
  setInterval(() => {
    for (const response of clients) response.write(': keep-alive\n\n');
  }, 10_000).unref();
  void listen();
}

async function listen(): Promise<void> {
  for (;;) {
    const listener = new Client({ connectionString: config.databaseUrl });
    try {
      await listener.connect();
      listener.on('notification', (message) => {
        const seq = Number(message.payload);
        if (Number.isFinite(seq)) void sendChange(seq);
      });
      await listener.query('listen promptside_change');
      await new Promise<void>((resolve) => {
        listener.on('error', () => resolve());
        listener.on('end', () => resolve());
      });
    } catch {
      // fall through to the wait below and try again
    }
    await listener.end().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function sendChange(seq: number): Promise<void> {
  const result = await pool.query<{ result: ChangeEvent | null }>(
    'select result from changes where seq = $1',
    [seq],
  );
  const change = result.rows[0]?.result;
  if (change) broadcastChange(change);
}
