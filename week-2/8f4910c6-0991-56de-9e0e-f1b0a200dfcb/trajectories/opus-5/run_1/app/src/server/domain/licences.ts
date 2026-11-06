import type { LicenceStatus } from '../../shared/types.js';
import {
  addDays,
  addMonthsClamped,
  dayNumber,
  officeDate,
  startOfDayInstant,
  type CivilDate,
} from '../../shared/zone.js';

const EXPIRING_WINDOW_DAYS = 30;

/** Whole months from the first-use date, clamped to the end of a shorter month. */
export function licenceEndsOn(firstUseDate: CivilDate, totalMonths: number): CivilDate {
  return addMonthsClamped(firstUseDate, totalMonths);
}

/** The licence is over at the start of the day after its last day, in the client's zone. */
export function licenceEndsAt(endsOn: CivilDate, clientTimeZone: string): number {
  return startOfDayInstant(clientTimeZone, addDays(endsOn, 1));
}

export function licenceStatus(endsOn: CivilDate, clientTimeZone: string, nowMs: number): LicenceStatus {
  if (nowMs >= licenceEndsAt(endsOn, clientTimeZone)) return 'expired';
  const today = officeDate(clientTimeZone, nowMs);
  const daysLeft = dayNumber(endsOn) - dayNumber(today);
  return daysLeft <= EXPIRING_WINDOW_DAYS - 1 ? 'expiring' : 'active';
}
