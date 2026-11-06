import type { StatusReport } from '../shared/types.js';
import { pool, type Db } from './db.js';
import { probeMail } from './mail.js';
import { probeStorage } from './storage.js';

const PROBE_INTERVAL_MS = 5000;

async function record(name: 'storage' | 'mail', up: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO service_probes (name, state, checked_at) VALUES ($1,$2,now())
     ON CONFLICT (name) DO UPDATE SET state = $2, checked_at = now()`,
    [name, up ? 'up' : 'down'],
  );
}

/** Marks storage down as soon as an operation finds it unreachable. */
export async function reportStorageDown(): Promise<void> {
  await record('storage', false).catch(() => undefined);
}

export async function currentStatus(db: Db): Promise<StatusReport> {
  const result = await db.query<{ name: string; state: string }>(
    'SELECT name, state FROM service_probes',
  );
  const states = new Map(result.rows.map((row) => [row.name, row.state]));
  return {
    storage: states.get('storage') === 'down' ? 'down' : 'up',
    mail: states.get('mail') === 'down' ? 'down' : 'up',
  };
}

export async function storageIsDown(db: Db): Promise<boolean> {
  return (await currentStatus(db)).storage === 'down';
}

async function probeOnce(): Promise<void> {
  const [storage, mail] = await Promise.all([probeStorage(), probeMail()]);
  await record('storage', storage);
  await record('mail', mail);
}

export function startProbes(): void {
  void probeOnce().catch(() => undefined);
  setInterval(() => {
    void probeOnce().catch(() => undefined);
  }, PROBE_INTERVAL_MS).unref();
}
