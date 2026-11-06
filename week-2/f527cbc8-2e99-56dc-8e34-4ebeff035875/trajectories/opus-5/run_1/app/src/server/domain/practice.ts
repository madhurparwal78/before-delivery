import { queryOne, type Db } from '../db.js';
import { now } from '../clock.js';
import { businessDateAt } from './time.js';

export interface Practice {
  name: string;
  timeZone: string;
}

let cached: Practice | null = null;

/** The practice row is seed data and never changes, so it is read once per process. */
export async function practice(db: Db): Promise<Practice> {
  if (cached !== null) return cached;
  const row = await queryOne<{ name: string; time_zone: string }>(
    db,
    'SELECT name, time_zone FROM practice WHERE id = 1',
  );
  if (row === null) throw new Error('practice row is missing');
  cached = { name: row.name, timeZone: row.time_zone };
  return cached;
}

export function forgetPractice(): void {
  cached = null;
}

/** Today's business date in the practice zone. */
export async function practiceToday(db: Db): Promise<string> {
  const { timeZone } = await practice(db);
  return businessDateAt(now(), timeZone);
}

export async function practiceZone(db: Db): Promise<string> {
  return (await practice(db)).timeZone;
}
