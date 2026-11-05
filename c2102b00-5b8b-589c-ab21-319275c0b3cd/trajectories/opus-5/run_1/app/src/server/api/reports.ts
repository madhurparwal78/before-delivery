import { db } from '../db.ts';
import { notFound } from '../http/errors.ts';
import { param, requireRole, type ApiResult, type RequestContext } from '../http/context.ts';
import { clubDate } from '../domain/clubTime.ts';
import { getCycleRow, timeZone } from '../store.ts';
import type { DailyRow } from '../../shared/types.ts';

export function dailyPledges(ctx: RequestContext): ApiResult {
  requireRole(ctx, ['coordinator']);
  const cycle = getCycleRow(param(ctx, 'cycleId'));
  if (!cycle) throw notFound();
  const zone = timeZone();
  const events = db
    .prepare('SELECT delta, at FROM pledge_events WHERE cycle_id = ? ORDER BY id')
    .all(cycle.id) as { delta: number; at: string }[];
  const byDate = new Map<string, DailyRow>();
  for (const event of events) {
    const date = clubDate(Date.parse(event.at), zone);
    const row = byDate.get(date) ?? { date, units_pledged: 0, units_withdrawn: 0 };
    if (event.delta >= 0) row.units_pledged += event.delta;
    else row.units_withdrawn += -event.delta;
    byDate.set(date, row);
  }
  const days = [...byDate.values()].sort((left, right) => (left.date < right.date ? -1 : 1));
  return { status: 200, body: { time_zone: zone, days } };
}

export function listReceipts(ctx: RequestContext): ApiResult {
  requireRole(ctx, ['coordinator']);
  const cycle = getCycleRow(param(ctx, 'cycleId'));
  if (!cycle) throw notFound();
  const rows = db
    .prepare(
      `SELECT household_code, to_email AS email, status, failed_attempts
       FROM mail_messages WHERE cycle_id = ? AND kind = 'receipt' ORDER BY id`,
    )
    .all(cycle.id);
  return { status: 200, body: { receipts: rows } };
}
