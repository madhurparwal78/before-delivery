import { EventEmitter } from 'events';
import { db } from './db';
import type { PoolClient } from 'pg';

/**
 * In-process live channel. Events are published from the same transaction that
 * saves a change and forwarded to every SSE subscriber of the same team.
 * Postgres LISTEN/NOTIFY carries them across app instances.
 */
export interface LiveEvent {
  teamIds: string[];
  kind: string;
  data?: unknown;
  at: string;
}

export interface Outbound {
  kind: string;
  data?: unknown;
  at: string;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(2000);

const CHANNEL = 'everyweek_events';
let listening = false;

async function ensureListening(): Promise<void> {
  if (listening) return;
  listening = true;
  try {
    const client: PoolClient = await db().connect();
    await client.query(`LISTEN ${CHANNEL}`);
    client.on('notification', msg => {
      try {
        const ev = JSON.parse(String(msg.payload)) as LiveEvent;
        emitter.emit('event', ev);
      } catch { /* malformed payload */ }
    });
    client.on('error', () => { listening = false; });
    // keep this client out of the pool's rotation for queries
  } catch {
    listening = false;
  }
}

export function publish(ev: LiveEvent): void {
  emitter.emit('event', ev);
  const payload = JSON.stringify(ev);
  if (payload.length < 7500) {
    void db().query(`SELECT pg_notify($1, $2)`, [CHANNEL, payload]).catch(() => undefined);
  } else {
    // Oversized events travel as a marker; the receiver refetches the data.
    const marker = JSON.stringify({ teamIds: ev.teamIds, kind: ev.kind, at: ev.at, data: { refetch: true, projectId: (ev.data as { projectId?: string })?.projectId ?? null } });
    void db().query(`SELECT pg_notify($1, $2)`, [CHANNEL, marker]).catch(() => undefined);
  }
  void ensureListening();
}

export function subscribe(teamIds: string[], fn: (ev: Outbound) => void): () => void {
  void ensureListening();
  const handler = (ev: LiveEvent): void => {
    if (ev.teamIds.some(t => teamIds.includes(t))) {
      fn({ kind: ev.kind, data: ev.data, at: ev.at });
    }
  };
  emitter.on('event', handler);
  return () => emitter.off('event', handler);
}
