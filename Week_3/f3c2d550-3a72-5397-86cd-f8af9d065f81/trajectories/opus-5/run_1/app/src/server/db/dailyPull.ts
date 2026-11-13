import type { DailyPullJson } from '../../shared/types.js';
import { nowIso, nowMs, toIso } from '../domain/clock.js';
import { effectiveZoneAt } from '../domain/homeZone.js';
import { PULL_HISTORY_SPAN, nextPullAt, pullDayFor } from '../domain/pullDay.js';
import { startOfLocalDay } from '../domain/zones.js';
import { pool } from './pool.js';
import { REFERENCE_COLUMNS, toReferenceJson, type ReferenceRow } from './references.js';
import { loadSettings } from './settings.js';

/**
 * One pick a pull day, decided by the shared database so that every request on every app
 * copy sees the same reference.
 */

async function choosePick(): Promise<string | null> {
  const unseen = await pool.query<{ id: string }>(
    `with recent as (
       select reference_id from daily_pull order by pull_day desc limit $1
     )
     select r.id from reference r
     where r.state = 'stored' and r.id not in (select reference_id from recent)
     order by r.captured_at, r.id
     limit 1`,
    [PULL_HISTORY_SPAN],
  );
  const unseenId = unseen.rows[0]?.id;
  if (unseenId) return unseenId;

  const oldestPick = await pool.query<{ id: string }>(
    `select r.id from reference r
     left join (
       select reference_id, max(pull_day) as last_day from daily_pull group by reference_id
     ) picks on picks.reference_id = r.id
     where r.state = 'stored'
     order by picks.last_day nulls first, r.captured_at, r.id
     limit 1`,
  );
  return oldestPick.rows[0]?.id ?? null;
}

export async function dailyPull(): Promise<DailyPullJson> {
  const settings = await loadSettings();
  const instant = nowMs();
  const zone = effectiveZoneAt(settings.history, instant);
  const pullDay = pullDayFor(zone, instant);

  let picked = await pool.query<{ reference_id: string }>(
    'select reference_id from daily_pull where pull_day = $1',
    [pullDay],
  );
  if (!picked.rows[0]) {
    const candidate = await choosePick();
    if (candidate) {
      await pool.query(
        `insert into daily_pull (pull_day, reference_id, zone, picked_at)
         values ($1, $2, $3, $4::timestamptz) on conflict (pull_day) do nothing`,
        [pullDay, candidate, zone, nowIso()],
      );
      picked = await pool.query<{ reference_id: string }>(
        'select reference_id from daily_pull where pull_day = $1',
        [pullDay],
      );
    }
  }

  const common = {
    pull_day: pullDay,
    zone,
    next_pull_at: toIso(nextPullAt(zone, instant)),
    today_starts_at: toIso(startOfLocalDay(zone, instant)),
    server_now: toIso(instant),
  };

  const referenceId = picked.rows[0]?.reference_id;
  if (!referenceId) return { ...common, state: 'empty', reference: null };

  const reference = await pool.query<ReferenceRow>(
    `select ${REFERENCE_COLUMNS} from reference where id = $1`,
    [referenceId],
  );
  const row = reference.rows[0];
  if (!row || row.state !== 'stored') return { ...common, state: 'removed', reference: null };
  return { ...common, state: 'picked', reference: toReferenceJson(row) };
}
