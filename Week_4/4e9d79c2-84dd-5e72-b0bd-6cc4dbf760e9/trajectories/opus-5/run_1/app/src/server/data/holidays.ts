import { config } from '../config.js';
import { one, query } from '../db.js';
import { copy } from '../copy.js';
import { readBankHolidays } from '../providers/wiremock.js';

export type HolidayReading = { holidays: Set<string>; line: string | null };

/** Holidays are read per desk at most once per cache window; a failed read does not count. */
export async function holidaysFor(deskId: string, now: number): Promise<HolidayReading> {
  const row = await one<{ fetched_at: string | null; events: string[] | null; ever_good: boolean }>(
    'select fetched_at, events, ever_good from holiday_cache where desk_id = $1',
    [deskId],
  );
  const fresh = row?.fetched_at !== null && row?.fetched_at !== undefined
    ? now - Number(row.fetched_at) < config.holidayCacheSeconds * 1000
    : false;
  if (fresh && row?.events) {
    return { holidays: new Set(row.events), line: null };
  }
  try {
    const dates = await readBankHolidays();
    await query(
      `insert into holiday_cache (desk_id, fetched_at, events, ever_good) values ($1,$2,$3,true)
       on conflict (desk_id) do update set fetched_at = excluded.fetched_at, events = excluded.events,
         ever_good = true`,
      [deskId, now, JSON.stringify(dates)],
    );
    return { holidays: new Set(dates), line: null };
  } catch {
    if (row?.events && row.ever_good) {
      return { holidays: new Set(row.events), line: null };
    }
    await query(
      `insert into holiday_cache (desk_id, fetched_at, events, ever_good) values ($1,null,null,false)
       on conflict (desk_id) do nothing`,
      [deskId],
    );
    return { holidays: new Set<string>(), line: copy.holidaysUnavailable };
  }
}
