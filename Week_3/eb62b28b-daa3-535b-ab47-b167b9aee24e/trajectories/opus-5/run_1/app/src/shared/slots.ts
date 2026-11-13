import { DateOnly, isoWeekday, pad2 } from './time';

const FIRST_SLOT_MINUTES = 6 * 60;
const SLOT_COUNT = 12;
const SLOT_MINUTES = 20;

/** The 12 published slot times, 06:00 to 09:40 member local time. */
export const SLOT_TIMES: string[] = Array.from({ length: SLOT_COUNT }, (_, index) => {
  const minutes = FIRST_SLOT_MINUTES + index * SLOT_MINUTES;
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
});

export function isSlotTime(time: string): boolean {
  return SLOT_TIMES.includes(time);
}

/** Slot days are Monday to Saturday in the member's local dates. */
export function isSlotDay(date: DateOnly): boolean {
  return isoWeekday(date) !== 7;
}
