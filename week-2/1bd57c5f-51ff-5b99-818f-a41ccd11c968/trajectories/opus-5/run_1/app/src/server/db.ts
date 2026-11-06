import pg from 'pg';
import { config } from './env.js';

export type Row = Record<string, unknown>;

export interface Queryable {
  query<T extends Row = Row>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });

pool.on('error', () => {
  // A broken idle connection is dropped from the pool; the next query opens a new one.
});

export const db: Queryable = {
  async query(text, values) {
    const result = await pool.query(text, values);
    return { rows: result.rows as never, rowCount: result.rowCount ?? 0 };
  },
};

export async function withTransaction<T>(run: (tx: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const tx: Queryable = {
      async query(text, values) {
        const result = await client.query(text, values);
        return { rows: result.rows as never, rowCount: result.rowCount ?? 0 };
      },
    };
    const value = await run(tx);
    await client.query('commit');
    return value;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function waitForDatabase(): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await pool.query('select 1');
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

const CHANNEL = 'snaglight_events';

type Listener = (jobId: string) => void;
const listeners = new Set<Listener>();

export function onJobNotice(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function notifyJob(tx: Queryable, jobId: string): Promise<void> {
  await tx.query(`select pg_notify($1, $2)`, [CHANNEL, jobId]);
}

export function startNoticeListener(): void {
  let client: pg.Client | null = null;
  const connect = async (): Promise<void> => {
    client = new pg.Client({ connectionString: config.databaseUrl });
    client.on('notification', (message) => {
      if (message.channel !== CHANNEL || !message.payload) return;
      for (const listener of listeners) listener(message.payload);
    });
    client.on('error', () => {
      client?.end().catch(() => undefined);
      client = null;
      setTimeout(() => void connect().catch(() => undefined), 2000);
    });
    await client.connect();
    await client.query(`listen ${CHANNEL}`);
  };
  void connect().catch(() => {
    setTimeout(() => void connect().catch(() => undefined), 2000);
  });
}

export async function withAdvisoryLock<T>(key: number, run: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [key]);
    return await run();
  } finally {
    await client.query('select pg_advisory_unlock($1)', [key]).catch(() => undefined);
    client.release();
  }
}
