import { DrawRow, MembershipRow } from '../data';
import { query } from '../db';
import { SLOT_TIMES, isSlotDay, isSlotTime } from '../shared/slots';
import {
  DateOnly,
  TimeZoneId,
  addDays,
  formatDateOnly,
  instantOfLocal,
  localDate,
  parseDateOnly,
  parseTimeOfDay,
} from '../shared/time';

export const MEMBER_WINDOW_DAYS = 28;
export const STAFF_WINDOW_DAYS = 400;

export function startsAtOf(zone: TimeZoneId, date: DateOnly, time: string): Date {
  const parsed = parseTimeOfDay(time);
  if (!parsed) throw new Error(`Bad slot time ${time}`);
  return instantOfLocal(zone, date.year, date.month, date.day, parsed.hour, parsed.minute);
}

/** 18:00 member local time on the day before the draw's local date. */
export function changesCloseAt(zone: TimeZoneId, drawLocalDate: string): Date {
  const parsed = parseDateOnly(drawLocalDate);
  if (!parsed) throw new Error(`Bad draw date ${drawLocalDate}`);
  const before = addDays(parsed, -1);
  return instantOfLocal(zone, before.year, before.month, before.day, 18, 0);
}

export function localToday(zone: TimeZoneId, now: Date): DateOnly {
  const parsed = parseDateOnly(localDate(now, zone));
  if (!parsed) throw new Error('Bad local date');
  return parsed;
}

/** Plus must be active, or cancelled with the paid period covering the draw's date. */
export function plusCoversDate(membership: MembershipRow | null, date: string): boolean {
  if (!membership) return false;
  if (membership.state === 'active') return true;
  if (membership.state === 'cancelled') {
    return membership.plus_until !== null && membership.plus_until >= date;
  }
  return false;
}

export async function slotTaken(
  phlebotomistId: string,
  startsAt: Date,
  exceptDrawId: string | null,
): Promise<DrawRow | null> {
  const rows = await query<DrawRow>(
    `select * from draws
     where phlebotomist_id = $1 and starts_at = $2 and state <> 'cancelled'
       and ($3::text is null or id <> $3)
     limit 1`,
    [phlebotomistId, startsAt, exceptDrawId],
  );
  return rows[0] ?? null;
}

/** The phlebotomist's first free slot after the taken one, on the member's local grid. */
export async function nextFreeSlot(
  phlebotomistId: string,
  zone: TimeZoneId,
  takenDate: string,
  takenTime: string,
): Promise<{ date: string; time: string }> {
  const start = parseDateOnly(takenDate);
  if (!start) throw new Error(`Bad date ${takenDate}`);
  let day = start;
  let slotIndex = SLOT_TIMES.indexOf(takenTime) + 1;
  for (let step = 0; step < 120; step += 1) {
    if (slotIndex >= SLOT_TIMES.length) {
      day = addDays(day, 1);
      slotIndex = 0;
    }
    if (!isSlotDay(day)) {
      day = addDays(day, 1);
      slotIndex = 0;
      continue;
    }
    const time = SLOT_TIMES[slotIndex] as string;
    const startsAt = startsAtOf(zone, day, time);
    const taken = await slotTaken(phlebotomistId, startsAt, null);
    if (!taken) return { date: formatDateOnly(day), time };
    slotIndex += 1;
  }
  throw new Error('No free slot found');
}

export function winnerName(draw: DrawRow): string {
  return draw.booked_by_kind === 'member' ? 'a member' : draw.booked_by_name;
}

export interface SlotGridOptions {
  /** Staff may book today at any of the 12 times, on any weekday. */
  staffSameDay: boolean;
}

export function slotTimesFor(date: DateOnly, today: DateOnly, options: SlotGridOptions): string[] {
  const isToday =
    date.year === today.year && date.month === today.month && date.day === today.day;
  if (options.staffSameDay && isToday) return [...SLOT_TIMES];
  return isSlotDay(date) ? [...SLOT_TIMES] : [];
}

export function timeIsOnGrid(
  date: DateOnly,
  today: DateOnly,
  time: string,
  options: SlotGridOptions,
): boolean {
  if (!isSlotTime(time)) return false;
  return slotTimesFor(date, today, options).includes(time);
}
