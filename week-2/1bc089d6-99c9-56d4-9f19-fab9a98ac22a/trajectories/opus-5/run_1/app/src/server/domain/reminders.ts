import { clientQuery, query, transaction } from '../db.js';
import { now } from '../clock.js';
import { startsAtLocal } from '../../shared/plan.js';
import type { HourRecord } from './hours.js';
import { reminderLetter } from './mail.js';
import { enqueue, flushOutbox } from './outbox.js';
import { addDays, compareDates, dateKey, localDateOf, localStartOfNight, type LocalDate } from './zone.js';

const LATE_LIMIT_MILLIS = 60 * 60 * 1000;
const SEARCH_DAYS = 400;

interface NightDue {
  night: LocalDate;
  at: Date;
  localTime: string;
}

/** A night's hour start: the one place the due time and the night's date are decided. */
function dueForNight(hour: HourRecord, night: LocalDate): NightDue {
  const start = localStartOfNight(hour.time_zone, night, startsAtLocal(hour.bedtime));
  return { night, at: start.at, localTime: start.localTime };
}

function firstNight(hour: HourRecord): LocalDate {
  return localDateOf(hour.time_zone, hour.remindersStartAt);
}

function eligibleNights(hour: HourRecord, until: LocalDate): NightDue[] {
  const nights: NightDue[] = [];
  let night = firstNight(hour);
  while (compareDates(night, until) <= 0) {
    const due = dueForNight(hour, night);
    if (due.at.getTime() >= hour.remindersStartAt.getTime()) nights.push(due);
    night = addDays(night, 1);
  }
  return nights;
}

async function recordedNights(hourId: string): Promise<Set<string>> {
  const result = await query<{ night: Date }>('select night from reminder_records where hour_id = $1', [hourId]);
  return new Set(result.rows.map((row) => row.night.toISOString().slice(0, 10)));
}

/** The due time of the earliest eligible night that has no record, or null while paused. */
export async function nextReminderAt(hour: HourRecord, at: Date): Promise<Date | null> {
  if (hour.reminders === 'paused') return null;
  const recorded = await recordedNights(hour.id);
  const today = localDateOf(hour.time_zone, at);
  const last = addDays(compareDates(today, firstNight(hour)) > 0 ? today : firstNight(hour), SEARCH_DAYS);
  for (const due of eligibleNights(hour, last)) {
    if (!recorded.has(dateKey(due.night))) return due.at;
  }
  return null;
}

/**
 * Writes one record, and at most one email, for every eligible night of this hour that is
 * due and has none. A night more than 60 minutes late is recorded as skipped instead.
 */
export async function processHour(hour: HourRecord, at: Date): Promise<void> {
  if (hour.reminders === 'paused') return;
  const recorded = await recordedNights(hour.id);
  const due = eligibleNights(hour, localDateOf(hour.time_zone, at)).filter(
    (night) => night.at.getTime() <= at.getTime() && !recorded.has(dateKey(night.night)),
  );
  if (due.length === 0) return;
  let queued = false;
  await transaction(async (client) => {
    for (const night of due) {
      const onTime = at.getTime() - night.at.getTime() <= LATE_LIMIT_MILLIS;
      const inserted = await clientQuery(
        client,
        `insert into reminder_records (hour_id, night, status, due_at, created_at)
         values ($1, $2, $3, $4, $5)
         on conflict (hour_id, night) do nothing`,
        [hour.id, dateKey(night.night), onTime ? 'sent' : 'skipped', night.at, at],
      );
      if (inserted.rowCount === 1 && onTime) {
        await enqueue(
          client,
          reminderLetter({
            email: hour.email,
            bedtime: hour.bedtime,
            localTime: night.localTime,
            rituals: hour.rituals,
          }),
          at,
        );
        queued = true;
      }
    }
  });
  if (queued) await flushOutbox();
}

interface HourRow {
  id: string;
  email: string;
  bedtime: string;
  time_zone: string;
  rituals: HourRecord['rituals'];
  note: string;
  reminders: HourRecord['reminders'];
  version: number;
  confirmed_at: Date;
  reminders_start_at: Date;
}

export function toHourRecord(row: HourRow): HourRecord {
  return {
    id: row.id,
    email: row.email,
    bedtime: row.bedtime,
    time_zone: row.time_zone,
    rituals: row.rituals,
    note: row.note,
    reminders: row.reminders,
    version: row.version,
    confirmedAt: row.confirmed_at,
    remindersStartAt: row.reminders_start_at,
  };
}

/** Runs every hour's due nights. Called on a timer and inside every test-clock change. */
export async function runDueReminders(): Promise<void> {
  const at = await now();
  const result = await query<HourRow>("select * from hours where reminders = 'on'");
  for (const row of result.rows) {
    await processHour(toHourRecord(row), at);
  }
}
