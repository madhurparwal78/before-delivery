import { pool } from './db.js';
import { appNow } from './app-clock.js';
import { drainOutbox, tryDeliverOne } from './outbox.js';
import { queueReminderEmail } from './emails.js';
import { startsAtLocal } from '../shared/plan.js';
import { dueInstant, dueLocalTime, nightOf, nextNight, NightId } from '../shared/time.js';
import { config } from './config.js';

interface ConfirmedHourRow {
  id: string;
  email: string;
  bedtime: string;
  time_zone: string;
  reminders_start: Date | null;
}

interface RitualRow {
  hour_id: string;
  id: string;
  minutes: number;
  position: number;
}

const LATE_MS = 60 * 60 * 1000;
const MAX_NIGHTS_SCAN = 400;

function origin(): string {
  return config.publicOrigin ?? `http://localhost:${config.port}`;
}

// The reminder rules: which nights are eligible, when they are due, and the
// one record per hour and night that makes duplicates impossible.
export async function runDueReminders(): Promise<void> {
  const now = await appNow();
  const hours = await pool.query<ConfirmedHourRow>(
    `SELECT id, email, bedtime, time_zone, reminders_start FROM hours
     WHERE status = 'confirmed' AND reminders = 'on'`,
  );
  if (hours.rowCount === 0) return;
  const rituals = await pool.query<RitualRow>('SELECT hour_id, id, minutes, position FROM rituals ORDER BY position');
  const byHour = new Map<string, { id: string; minutes: number }[]>();
  for (const r of rituals.rows) {
    const list = byHour.get(r.hour_id) ?? [];
    list.push({ id: r.id, minutes: r.minutes });
    byHour.set(r.hour_id, list);
  }
  const records = await pool.query<{ hour_id: string; night: string }>('SELECT hour_id, night FROM reminder_records');
  const recorded = new Set<string>();
  for (const r of records.rows) recorded.add(`${r.hour_id}|${r.night}`);

  for (const hour of hours.rows) {
    const zone = hour.time_zone;
    const startHHMM = startsAtLocal(hour.bedtime);
    const remindersStart = hour.reminders_start ? new Date(hour.reminders_start).getTime() : 0;
    let night = nightOf(zone, remindersStart);
    const tonight = nightOf(zone, now);
    let scanned = 0;
    while (night <= tonight && scanned < MAX_NIGHTS_SCAN) {
      const due = dueInstant(zone, night, startHHMM);
      const key = `${hour.id}|${night}`;
      if (due >= remindersStart && !recorded.has(key) && due <= now) {
        const late = now - due;
        if (late <= LATE_MS) {
          const localTime = dueLocalTime(zone, due);
          const id = await queueReminderEmail(
            hour.email,
            localTime,
            { bedtime: hour.bedtime, time_zone: zone, rituals: byHour.get(hour.id) ?? [] },
            origin(),
          );
          const sent = await tryDeliverOne(id);
          if (sent) {
            await drainOutbox().catch(() => undefined);
          }
          await pool.query(
            `INSERT INTO reminder_records (hour_id, night, status, due_at) VALUES ($1,$2,'sent',$3)
             ON CONFLICT (hour_id, night) DO NOTHING`,
            [hour.id, night, new Date(due)],
          );
        } else {
          await pool.query(
            `INSERT INTO reminder_records (hour_id, night, status, due_at) VALUES ($1,$2,'skipped',$3)
             ON CONFLICT (hour_id, night) DO NOTHING`,
            [hour.id, night, new Date(due)],
          );
        }
        recorded.add(key);
      }
      night = nextNight(night);
      scanned += 1;
    }
  }
}

// The next reminder for one hour: the due time of the earliest eligible night
// with no record. Read-only; the scheduler writes records for past nights.
export async function nextReminderFor(
  hourId: string,
  zone: string,
  bedtime: string,
  reminders: string,
  remindersStart: Date | null,
): Promise<number | null> {
  if (reminders !== 'on') return null;
  const now = await appNow();
  const start = remindersStart ? new Date(remindersStart).getTime() : now;
  const startHHMM = startsAtLocal(bedtime);
  const records = await pool.query<{ max: string | null }>(
    'SELECT max(night) AS max FROM reminder_records WHERE hour_id = $1',
    [hourId],
  );
  const latest = records.rows[0]?.max ?? null;
  let night = nightOf(zone, Math.max(start, now - 24 * 60 * 60 * 1000));
  if (latest !== null && latest >= night) night = nextNight(latest);
  for (let i = 0; i < 10; i++) {
    const due = dueInstant(zone, night, startHHMM);
    if (due >= start) return due;
    night = nextNight(night);
  }
  return null;
}
