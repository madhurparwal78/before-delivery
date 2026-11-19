import { config } from './config.js';
import { one, query } from './db.js';

interface ClockRow {
  base_business: Date;
  base_real: Date;
}

let base: ClockRow | null = null;

/** One stored clock drives every server-side time rule. */
export async function loadClock(): Promise<void> {
  const existing = await one<ClockRow>('SELECT base_business, base_real FROM clock WHERE id = 1');
  if (existing !== null) {
    base = existing;
    return;
  }
  const startAt = config.startAt === '' ? new Date() : new Date(config.startAt);
  const realNow = new Date();
  await query('INSERT INTO clock (id, base_business, base_real) VALUES (1, $1, $2) ON CONFLICT (id) DO NOTHING', [
    startAt,
    realNow,
  ]);
  base = await one<ClockRow>('SELECT base_business, base_real FROM clock WHERE id = 1');
}

export async function now(): Promise<Date> {
  if (base === null) await loadClock();
  const row = base as ClockRow;
  const drift = Date.now() - row.base_real.getTime();
  return new Date(row.base_business.getTime() + drift);
}

export function instant(at: Date): string {
  return at.toISOString().replace(/(\.\d{3})\d*Z$/, '$1Z');
}

async function rebase(to: Date): Promise<void> {
  const realNow = new Date();
  await query('UPDATE clock SET base_business = $1, base_real = $2 WHERE id = 1', [to, realNow]);
  base = { base_business: to, base_real: realNow };
}

export async function advanceSeconds(seconds: number): Promise<Date> {
  const current = await now();
  const next = new Date(current.getTime() + seconds * 1000);
  await rebase(next);
  return next;
}

export async function setClock(to: Date): Promise<Date> {
  await rebase(to);
  return to;
}
