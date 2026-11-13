import pg from 'pg';
import { env } from '../env.js';
import { pool, type Queryable } from '../db/pool.js';

/**
 * The live event bus. Events travel through Postgres, so several app instances
 * sharing one database all reach every connected browser.
 */

const CHANNEL = 'spindrift_events';

export type AppEvent =
  | { type: 'commission.updated'; commissionId: string; state: string; audience: string[] }
  | {
      type: 'payment.confirmed';
      commissionId: string;
      payerName: string;
      amountCents: number;
      label: string;
      audience: string[];
    }
  | {
      type: 'render.updated';
      renderId: string;
      commissionId: string;
      state: string;
      progress: number;
      audience: string[];
    }
  | { type: 'job.updated'; jobId: string; status: string; audience: string[] }
  | { type: 'hold.updated'; commissionId: string; status: string; audience: string[] };

type Listener = (event: AppEvent) => void;

const listeners = new Set<Listener>();

/** Publish an event, in the same transaction as the change that caused it. */
export async function publish(tx: Queryable, event: AppEvent): Promise<void> {
  await tx.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify(event)]);
}

export async function publishNow(event: AppEvent): Promise<void> {
  await publish(pool, event);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function handleNotification(payload: string | undefined): void {
  if (!payload) return;
  let event: AppEvent;
  try {
    event = JSON.parse(payload) as AppEvent;
  } catch {
    return;
  }
  for (const listener of listeners) listener(event);
}

/** Keep one listening connection open, reconnecting on its own if it drops. */
export function startEventListener(): void {
  const connect = async (): Promise<void> => {
    const client = new pg.Client({ connectionString: env.databaseUrl });
    client.on('error', () => {
      client.end().catch(() => undefined);
      setTimeout(() => void connect(), 2_000);
    });
    client.on('notification', (message) => handleNotification(message.payload));
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
    } catch {
      setTimeout(() => void connect(), 2_000);
    }
  };
  void connect();
}

