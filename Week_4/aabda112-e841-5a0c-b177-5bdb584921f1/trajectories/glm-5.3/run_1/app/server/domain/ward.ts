import { q, one } from '../db.js';
import { settings } from '../settings.js';
import { clockNow } from '../clock.js';
import { t } from '../errors.js';
import { clinicToUtc } from '../tz.js';

// The one place that decides a dose's state from the server clock.
export function doseState(scheduledAt: Date, now: Date = clockNow()): 'upcoming' | 'due' | 'overdue' {
  const sched = scheduledAt.getTime();
  const cur = now.getTime();
  if (cur < sched) return 'upcoming';
  if (cur < sched + settings.treatmentGraceMinutes * 60000) return 'due';
  return 'overdue';
}

// Dose k is scheduled at first dose + k * interval in elapsed hours.
export function scheduleDose(firstAt: Date, intervalHours: number, idx: number): Date {
  return new Date(firstAt.getTime() + idx * intervalHours * 3600_000);
}

// Parse the clinic-time "YYYY-MM-DD HH:MM" first-dose text into an instant.
// A time that does not exist (clocks forward) is null; a time that occurs twice
// means its first occurrence.
export function parseFirstDose(text: unknown): Date | null {
  if (typeof text !== 'string') return null;
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (!m) return null;
  const inst = clinicToUtc(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), true);
  return inst ?? null;
}

export const KENNELS = Array.from({ length: 12 }, (_, i) => `K${i + 1}`);

export function kennelValid(kennel: unknown): kennel is string {
  return typeof kennel === 'string' && KENNELS.includes(kennel);
}

// Beacons: waiting is set by the queue; the ward supplies the other two.
export function wardBeacons(doses: { scheduledAt: Date; status: string }[], now: Date = clockNow()) {
  let overdue = 0;
  let dueWithinHour = 0;
  for (const d of doses) {
    if (d.status === 'given' || d.status === 'skipped') continue;
    const state = doseState(d.scheduledAt, now);
    if (state === 'overdue') overdue += 1;
    else if (d.scheduledAt.getTime() <= now.getTime() + 3600_000) dueWithinHour += 1;
  }
  return { overdue, dueWithinHour };
}
