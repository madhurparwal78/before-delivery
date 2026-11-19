import { one, pool } from './db.js';
import { env } from './env.js';

interface ClockRow {
  base_instant: Date;
  base_real: Date;
}

let base: { instant: number; real: number } | null = null;

export async function loadClock(): Promise<void> {
  const existing = await one<ClockRow>('select base_instant, base_real from business_clock where id = 1');
  if (existing) {
    base = { instant: existing.base_instant.getTime(), real: existing.base_real.getTime() };
    return;
  }
  const start = env.startAt ? new Date(env.startAt) : new Date();
  const real = new Date();
  await pool.query(
    `insert into business_clock (id, base_instant, base_real) values (1, $1, $2)
     on conflict (id) do nothing`,
    [start.toISOString(), real.toISOString()],
  );
  await loadClock();
}

export async function refreshClock(): Promise<void> {
  const row = await one<ClockRow>('select base_instant, base_real from business_clock where id = 1');
  if (row) base = { instant: row.base_instant.getTime(), real: row.base_real.getTime() };
}

/** The business now. Every stored time and deadline reads this. */
export function now(): Date {
  if (!base) throw new Error('business clock not loaded');
  return new Date(base.instant + (Date.now() - base.real));
}

export function clockBase(): Date {
  if (!base) throw new Error('business clock not loaded');
  return new Date(base.instant);
}

export async function setClock(instant: Date): Promise<Date> {
  const real = new Date();
  await pool.query(
    `insert into business_clock (id, base_instant, base_real) values (1, $1, $2)
     on conflict (id) do update set base_instant = excluded.base_instant, base_real = excluded.base_real`,
    [instant.toISOString(), real.toISOString()],
  );
  base = { instant: instant.getTime(), real: real.getTime() };
  return now();
}

export function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function isoRequired(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
