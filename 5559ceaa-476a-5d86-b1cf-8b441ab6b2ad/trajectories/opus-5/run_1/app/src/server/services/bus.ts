import pg from 'pg';
import type { ServerFrame } from '../../shared/api.js';
import { config } from '../config.js';
import { pool } from '../db.js';

const CHANNEL = 'relay_bench';

export interface Envelope {
  project_id: string;
  /** When set, only this participant's sockets receive the frame. */
  user_id?: string;
  frame: ServerFrame;
}

export async function publish(envelope: Envelope): Promise<void> {
  await pool.query('select pg_notify($1, $2)', [CHANNEL, JSON.stringify(envelope)]);
}

export function startBus(onEnvelope: (envelope: Envelope) => void): void {
  const listen = (): void => {
    const client = new pg.Client({ connectionString: config.databaseUrl });
    client.on('notification', (message) => {
      if (message.payload === undefined) return;
      onEnvelope(JSON.parse(message.payload) as Envelope);
    });
    client.on('error', () => {
      client.end().catch(() => undefined);
      setTimeout(listen, 1000);
    });
    client.connect().then(
      () => client.query(`listen ${CHANNEL}`),
      () => setTimeout(listen, 1000),
    );
  };
  listen();
}
