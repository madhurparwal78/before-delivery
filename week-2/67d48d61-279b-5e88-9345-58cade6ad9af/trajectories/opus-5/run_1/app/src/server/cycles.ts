import type { Pool, PoolClient } from 'pg';

export type Queryable = Pool | PoolClient;
import { CYCLE_KEYS, CYCLE_NAMES, type CycleKey } from '../shared/domain.js';
import { config } from './env.js';
import { addDays, localDate, mondayOf, startOfLocalDay } from './time.js';

export interface CycleRow {
  key: CycleKey;
  name: string;
  position: number;
  starts_at: Date;
  ends_at: Date | null;
}

const FIRST_MONDAY_KEY = 'first_monday';

/** Writes the five cycle spans and the recorded first Monday once, on an empty database. */
export async function ensureCycles(client: PoolClient, now: Date): Promise<void> {
  const existing = await client.query<{ count: string }>('select count(*) as count from cycles');
  if (Number(existing.rows[0]?.count ?? '0') > 0) return;

  const firstMonday = config.firstMonday ?? mondayOf(localDate(config.timeZone, now));
  await client.query(
    'insert into meta (key, value) values ($1, $2) on conflict (key) do nothing',
    [FIRST_MONDAY_KEY, firstMonday],
  );

  const starts: Date[] = CYCLE_KEYS.map((_, index) =>
    config.cycleSeconds === null
      ? startOfLocalDay(config.timeZone, addDays(firstMonday, 7 * index))
      : new Date(now.getTime() + index * config.cycleSeconds * 1000),
  );

  for (const [index, key] of CYCLE_KEYS.entries()) {
    const startsAt = starts[index] as Date;
    const endsAt = index === CYCLE_KEYS.length - 1 ? null : (starts[index + 1] as Date);
    await client.query(
      'insert into cycles (key, position, starts_at, ends_at) values ($1, $2, $3, $4)',
      [key, index, startsAt, endsAt],
    );
  }
}

export async function loadCycles(client: Queryable): Promise<CycleRow[]> {
  const result = await client.query<{
    key: CycleKey;
    position: number;
    starts_at: Date;
    ends_at: Date | null;
  }>('select key, position, starts_at, ends_at from cycles order by position');
  return result.rows.map((row) => ({ ...row, name: CYCLE_NAMES[row.key] }));
}

/** The one place the current cycle is decided. */
export function currentCycleKey(cycles: CycleRow[], now: Date): CycleKey {
  const first = cycles[0];
  if (!first) throw new Error('Cycles are not seeded');
  if (now.getTime() < first.starts_at.getTime()) return first.key;
  for (const cycle of cycles) {
    const ended = cycle.ends_at !== null && now.getTime() >= cycle.ends_at.getTime();
    if (!ended && now.getTime() >= cycle.starts_at.getTime()) return cycle.key;
  }
  return (cycles[cycles.length - 1] as CycleRow).key;
}

export function cyclePosition(cycles: CycleRow[], key: CycleKey): number {
  const found = cycles.find((cycle) => cycle.key === key);
  if (!found) throw new Error(`Unknown cycle ${key}`);
  return found.position;
}

export async function openingNight(client: Queryable): Promise<string> {
  if (config.openingNight !== null) return config.openingNight;
  const result = await client.query<{ value: string }>(
    'select value from meta where key = $1',
    [FIRST_MONDAY_KEY],
  );
  const firstMonday = result.rows[0]?.value;
  if (!firstMonday) throw new Error('The first Monday has not been recorded');
  return addDays(firstMonday, 38);
}
