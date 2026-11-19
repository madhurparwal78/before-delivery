import { limits } from '../config.ts';
import type { Sql } from '../providers/db.ts';

/**
 * A grading namespace's clock starts at FLAN_GRADE_CLOCK_ISO and advances only
 * through the clock route. The default namespace's clock is real server time.
 * A browser's page clock never moves this.
 */

export type ClockMode = 'real' | 'grading';

interface ClockRow {
  clock_mode: string;
  clock_base: Date;
  advanced_s: string | number;
}

export async function ensureNamespace(
  sql: Sql,
  ns: string,
  mode: ClockMode,
): Promise<void> {
  const base = mode === 'grading' ? new Date(limits.gradeClockIso) : new Date();
  await sql.query(
    `INSERT INTO namespaces (ns, clock_mode, clock_base, advanced_s)
     VALUES ($1, $2, $3, 0)
     ON CONFLICT (ns) DO NOTHING`,
    [ns, mode, base],
  );
}

export async function namespaceNow(sql: Sql, ns: string): Promise<Date> {
  const found = await sql.query<ClockRow>(
    'SELECT clock_mode, clock_base, advanced_s FROM namespaces WHERE ns = $1',
    [ns],
  );
  const row = found.rows[0];
  if (!row) return new Date();
  if (row.clock_mode === 'real') return new Date();
  const advanced = Number(row.advanced_s);
  return new Date(row.clock_base.getTime() + advanced * 1000);
}

export async function advanceClock(
  sql: Sql,
  ns: string,
  seconds: number,
): Promise<Date> {
  await sql.query(
    'UPDATE namespaces SET advanced_s = advanced_s + $2 WHERE ns = $1',
    [ns, seconds],
  );
  return namespaceNow(sql, ns);
}

/** "Today" is the namespace-clock UTC date. */
export function utcDateOf(at: Date): string {
  return at.toISOString().slice(0, 10);
}
