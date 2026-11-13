import { addDays, listDays } from '../shared/dates.js';
import type { SeriesDay } from '../shared/types.js';
import { pool, transaction, type Queryable, type Tx } from './db.js';
import type { User } from './access.js';

const CTL_DAYS = 42;
const ATL_DAYS = 7;

/** Serialises every change that feeds one athlete's series. */
export async function lockAthlete(tx: Tx, athleteId: string): Promise<void> {
  await tx.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [athleteId]);
}

/**
 * Recomputes the stored daily series from a day through today. CTL and ATL are exponentially weighted
 * from daily stress; form on a day is the previous day's CTL minus ATL.
 */
export async function recomputeSeries(tx: Tx, athlete: User, from: string, today: string): Promise<void> {
  if (athlete.series_start === null) return;
  let first = from < athlete.series_start ? athlete.series_start : from;
  let ctl = athlete.start_ctl;
  let atl = athlete.start_atl;
  if (first > athlete.series_start) {
    const previous = await tx.query<{ ctl: number; atl: number }>('SELECT ctl, atl FROM series_days WHERE athlete_id = $1 AND date = $2', [
      athlete.id,
      addDays(first, -1)
    ]);
    const row = previous.rows[0];
    if (row) {
      ctl = row.ctl;
      atl = row.atl;
    } else {
      first = athlete.series_start;
    }
  }
  await tx.query('DELETE FROM series_days WHERE athlete_id = $1 AND date >= $2', [athlete.id, first]);
  if (first > today) return;
  const stress = await tx.query<{ date: string; tss: number }>(
    "SELECT date, SUM(tss) AS tss FROM workouts WHERE athlete_id = $1 AND kind = 'completed' AND date BETWEEN $2 AND $3 GROUP BY date",
    [athlete.id, first, today]
  );
  const byDate = new Map(stress.rows.map((row) => [row.date, row.tss]));
  const days = listDays(first, today);
  const rows = days.map((date) => {
    const tss = byDate.get(date) ?? 0;
    const tsb = ctl - atl;
    ctl += (tss - ctl) / CTL_DAYS;
    atl += (tss - atl) / ATL_DAYS;
    return { date, tss, ctl, atl, tsb };
  });
  await tx.query(
    `INSERT INTO series_days (athlete_id, date, tss, ctl, atl, tsb)
     SELECT $1, * FROM unnest($2::date[], $3::float8[], $4::float8[], $5::float8[], $6::float8[])`,
    [athlete.id, days, rows.map((r) => r.tss), rows.map((r) => r.ctl), rows.map((r) => r.atl), rows.map((r) => r.tsb)]
  );
}

/** Brings the stored series up to the server's today when the date has moved since it was written. */
export async function ensureSeriesCurrent(athlete: User, today: string): Promise<void> {
  if (athlete.series_start === null) return;
  const { rows } = await pool.query<{ last: string | null }>('SELECT max(date) AS last FROM series_days WHERE athlete_id = $1', [athlete.id]);
  const last = rows[0]?.last ?? null;
  if (last === today) return;
  await transaction(async (tx) => {
    await lockAthlete(tx, athlete.id);
    await recomputeSeries(tx, athlete, last !== null && last < today ? addDays(last, 1) : athlete.series_start ?? today, today);
  });
}

export async function readSeries(q: Queryable, athleteId: string, from: string, to: string): Promise<SeriesDay[]> {
  const { rows } = await q.query<SeriesDay>('SELECT date, tss, ctl, atl, tsb FROM series_days WHERE athlete_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date', [
    athleteId,
    from,
    to
  ]);
  return rows;
}
