import { EventEmitter } from 'node:events';
import { Client } from 'pg';
import { config } from '../config.js';
import { pool } from '../db.js';

export type BusMessage =
  | { kind: 'event'; stream: string; seq: number }
  | { kind: 'party'; party_id: string }
  | { kind: 'session'; session_id: string };

const CHANNEL = 'lw_bus';
const emitter = new EventEmitter();
emitter.setMaxListeners(0);

/** Every copy of the app listens, so shared-database copies see the same traffic. */
export async function startBus(): Promise<void> {
  const client = new Client({ connectionString: config.databaseUrl });
  client.on('notification', (message) => {
    if (message.payload === undefined) return;
    emitter.emit('bus', JSON.parse(message.payload) as BusMessage);
  });
  client.on('error', () => {
    void reconnectBus();
  });
  await client.connect();
  await client.query(`LISTEN ${CHANNEL}`);
}

async function reconnectBus(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  try {
    await startBus();
  } catch {
    void reconnectBus();
  }
}

export async function publish(message: BusMessage): Promise<void> {
  await pool.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify(message)]);
}

export function onBus(listener: (message: BusMessage) => void): void {
  emitter.on('bus', listener);
}
