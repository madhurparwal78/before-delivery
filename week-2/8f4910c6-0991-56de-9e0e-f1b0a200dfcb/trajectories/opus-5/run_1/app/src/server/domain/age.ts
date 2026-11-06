import { compareDates, daysInMonth, type CivilDate } from '../../shared/zone.js';

/** A 29 February birthday counts as 1 March in non-leap years. */
function eighteenthBirthday(dateOfBirth: CivilDate): CivilDate {
  const year = dateOfBirth.year + 18;
  if (dateOfBirth.month === 2 && dateOfBirth.day === 29 && daysInMonth(year, 2) === 28) {
    return { year, month: 3, day: 1 };
  }
  return { year, month: dateOfBirth.month, day: dateOfBirth.day };
}

/** A minor is someone whose 18th birthday falls after today's office date. */
export function isMinorOn(dateOfBirth: CivilDate, officeToday: CivilDate): boolean {
  return compareDates(eighteenthBirthday(dateOfBirth), officeToday) > 0;
}
