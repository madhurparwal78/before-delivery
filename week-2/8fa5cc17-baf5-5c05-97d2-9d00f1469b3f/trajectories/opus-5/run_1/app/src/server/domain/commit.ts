import { Tx, withTransaction, queryOne, query } from '../db/pool';
import { LiveEvent, publish, recordEvents } from '../events';
import { ThemeName, isThemeName } from '../../shared/tokens';
import { todayInZone } from '../../shared/homeclock';

export type WorkspaceSettings = { homeTimeZone: string; theme: ThemeName };

export async function loadSettings(): Promise<WorkspaceSettings> {
  const row = await queryOne<{ home_time_zone: string; theme: string }>(
    'select home_time_zone, theme from workspace_settings where id = 1',
  );
  if (row === null) return { homeTimeZone: 'Europe/London', theme: 'paper' };
  return { homeTimeZone: row.home_time_zone, theme: isThemeName(row.theme) ? row.theme : 'paper' };
}

export async function saveSettings(partial: Partial<WorkspaceSettings>): Promise<WorkspaceSettings> {
  const current = await loadSettings();
  const next: WorkspaceSettings = {
    homeTimeZone: partial.homeTimeZone ?? current.homeTimeZone,
    theme: partial.theme ?? current.theme,
  };
  await query('update workspace_settings set home_time_zone = $1, theme = $2 where id = 1', [
    next.homeTimeZone,
    next.theme,
  ]);
  return next;
}

/** Today's date on the workspace home clock. */
export async function todayOnHomeClock(): Promise<{ date: string; zone: string }> {
  const settings = await loadSettings();
  return { date: todayInZone(settings.homeTimeZone), zone: settings.homeTimeZone };
}

/** Run a change in one transaction, record its events there, then publish them. */
export async function commitWithEvents<T>(
  run: (tx: Tx) => Promise<{ result: T; events: LiveEvent[] }>,
): Promise<T> {
  const outcome = await withTransaction(async (tx) => {
    const { result, events } = await run(tx);
    const stored = await recordEvents(tx, events);
    return { result, stored };
  });
  publish(outcome.stored);
  return outcome.result;
}
