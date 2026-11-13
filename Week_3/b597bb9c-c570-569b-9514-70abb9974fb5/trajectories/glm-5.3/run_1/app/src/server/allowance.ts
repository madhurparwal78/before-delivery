import type { AppCtx } from './ctx';
import { utcMonth } from './util';

/**
 * The month's export-minute counter rebuilt from Postgres: the seeded
 * opening usage when it was seeded this month, plus the minutes of this
 * month's exports that were not cancelled or failed. One place, used by the
 * allowance read and the export take.
 */
export async function rebuildOpeningMinutes(ctx: AppCtx): Promise<number> {
  const ws = await ctx.db.query<{ opening_minutes: number; opening_month: string }>(
    'SELECT opening_minutes, opening_month FROM workspace LIMIT 1',
  );
  const month = utcMonth();
  let minutes = ws.rows[0]!.opening_month === month ? ws.rows[0]!.opening_minutes : 0;
  const used = await ctx.db.query<{ total: string }>(
    `SELECT COALESCE(SUM(minutes),0) AS total FROM exports
     WHERE state NOT IN ('cancelled','failed') AND to_char(created_at, 'YYYY-MM') = $1`,
    [month],
  );
  minutes += Number(used.rows[0]!.total);
  return minutes;
}
