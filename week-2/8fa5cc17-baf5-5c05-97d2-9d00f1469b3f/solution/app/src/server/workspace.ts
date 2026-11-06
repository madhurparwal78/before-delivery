// Workspace settings (home clock and theme) and today's date on the home clock.
import { one, type Db } from './db.ts';
import { homeDate } from '../shared/time.ts';
import type { ThemeName } from '../shared/tokens.ts';

export interface Settings { home_time_zone: string; theme: ThemeName }

export async function loadSettings(q: Db): Promise<Settings> {
  const row = await one<{ home_time_zone: string; theme: ThemeName }>(q, 'SELECT home_time_zone, theme FROM workspace_settings WHERE id = 1');
  if (!row) throw new Error('workspace settings missing');
  return { home_time_zone: row.home_time_zone, theme: row.theme };
}

/** Today on the home clock, from the server's current time. */
export async function homeToday(q: Db): Promise<{ date: string; zone: string }> {
  const { home_time_zone: zone } = await loadSettings(q);
  return { date: homeDate(Date.now(), zone), zone };
}

/** An object's `updated_at` as a home-clock date. */
export const homeDateOf = (instant: Date, zone: string): string => homeDate(instant.getTime(), zone);
