import { Client } from 'pg';
import type { QueryResultRow } from './db';

export type NotifyTx = {
  query: (sql: string, params?: readonly unknown[]) => Promise<{ rows: QueryResultRow[] }>;
};

let listener: Client | null = null;
const handlers = new Set<(payload: string) => void>();

export async function startListener(onEvent: (payload: string) => void): Promise<void> {
  handlers.add(onEvent);
  if (listener) return;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  client.on('notification', (msg) => {
    if (msg.channel === 'rulehouse_events' && msg.payload) for (const fn of handlers) fn(msg.payload);
  });
  client.on('error', () => {
    listener = null;
  });
  await client.connect();
  await client.query('LISTEN rulehouse_events');
  listener = client;
}

export async function notify(tx: NotifyTx, payload: string): Promise<void> {
  await tx.query('SELECT pg_notify($1, $2)', ['rulehouse_events', payload]);
}

export async function stopListener(): Promise<void> {
  if (listener) {
    await listener.end().catch(() => {});
    listener = null;
  }
}
