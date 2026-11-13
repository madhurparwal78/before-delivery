import { config } from '../config.js';
import { readState, writeState } from '../db/schema.js';

const TODAY_OVERRIDE_KEY = 'today_override';

/** The server owns "today": APP_TODAY, or the seed's override until the next reset. */
export async function serverToday(): Promise<string> {
  const override = await readState(TODAY_OVERRIDE_KEY);
  return override === null || override === '' ? config.appToday : override;
}

export async function setTodayOverride(date: string | null): Promise<void> {
  await writeState(TODAY_OVERRIDE_KEY, date ?? '');
}
