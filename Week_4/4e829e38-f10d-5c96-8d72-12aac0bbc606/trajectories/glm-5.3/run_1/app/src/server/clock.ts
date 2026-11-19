import { query, withTx } from './db';
import type { PoolClient } from 'pg';

/**
 * The one clock source. When the grading hook has fixed it, the stored time is
 * returned; otherwise real time. No other code reads the system time on its own.
 */
export async function now(): Promise<Date> {
  const r = await query<{ fixed_at: string | null }>(`SELECT fixed_at FROM app_clock WHERE id = 1`);
  const fixed = r.rows[0]?.fixed_at;
  if (fixed) return new Date(fixed);
  return new Date();
}

export async function setClock(at: Date): Promise<Date> {
  await query(`UPDATE app_clock SET fixed_at = $1 WHERE id = 1`, [at.toISOString()]);
  return at;
}

export async function nowISO(): Promise<string> { return (await now()).toISOString(); }
export async function realNow(): Promise<Date> { return new Date(); }

export function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export async function todayYMD(): Promise<string> { return ymd(await now()); }

export async function txNow(client: PoolClient): Promise<Date> {
  const r = await client.query<{ fixed_at: string | null }>(`SELECT fixed_at FROM app_clock WHERE id = 1`);
  const fixed = r.rows[0]?.fixed_at;
  if (fixed) return new Date(fixed);
  return new Date();
}

export async function txToday(client: PoolClient): Promise<string> { return ymd(await txNow(client)); }

/** UTC minute key of the server clock, for the rule run limit. */
export async function txMinuteKey(client: PoolClient): Promise<string> {
  const d = await txNow(client);
  return `${ymd(d)}T${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export { withTx };
