import { Carry, Edition, Frequency } from '../../shared/types';
import {
  CivilDate,
  addDays,
  formatDate,
  isWeekend,
  lastDayOfMonth,
  longDate,
  parseDate,
} from '../../shared/dates';
import { dueMonth, periodStartDate } from './periods';
import { endOfDayInstant, zoneLabel } from './zones';

export interface DueDateInputs {
  period: string;
  frequency: Frequency;
  edition: Edition;
  holidays: readonly string[];
  zone: string;
  /** Extension days already granted on this return, or 0. */
  extensionDays: number;
}

export interface DueDateResult {
  unextendedNominalDate: string;
  /** The extended nominal date: the date before carrying. */
  nominalDueDate: string;
  dueDate: string;
  carriedFrom: string | null;
  dueAtMs: number;
}

/**
 * The edition with the latest effective date not after the period's first day
 * in the state's own zone. Editions arrive sorted by effective date.
 */
export function editionInEffect(editions: readonly Edition[], periodStart: CivilDate): Edition {
  const startDate = formatDate(periodStart);
  let chosen = editions[0];
  for (const edition of editions) {
    if (edition.effective_date <= startDate) chosen = edition;
  }
  return chosen;
}

export function editionForPeriod(
  editions: readonly Edition[],
  period: string,
  frequency: Frequency,
): Edition {
  return editionInEffect(editions, periodStartDate(period, frequency));
}

/** The due day of the month that follows the period, clamped to that month's end. */
export function unextendedNominalDate(
  period: string,
  frequency: Frequency,
  dueDay: number,
): CivilDate {
  const month = dueMonth(period, frequency);
  const day = Math.min(dueDay, lastDayOfMonth(month.y, month.m));
  return { y: month.y, m: month.m, d: day };
}

/**
 * `next_business` moves forward past Saturdays, Sundays and the state's
 * holidays. `fixed` never moves.
 */
export function carryForward(
  date: CivilDate,
  carry: Carry,
  holidays: readonly string[],
): CivilDate {
  if (carry === 'fixed') return date;
  const listed = new Set(holidays);
  let current = date;
  while (isWeekend(current) || listed.has(formatDate(current))) {
    current = addDays(current, 1);
  }
  return current;
}

export function computeDueDate(inputs: DueDateInputs): DueDateResult {
  const unextended = unextendedNominalDate(
    inputs.period,
    inputs.frequency,
    inputs.edition.due_day,
  );
  const nominal = inputs.extensionDays > 0 ? addDays(unextended, inputs.extensionDays) : unextended;
  const carried = carryForward(nominal, inputs.edition.carry, inputs.holidays);
  const nominalString = formatDate(nominal);
  const carriedString = formatDate(carried);
  return {
    unextendedNominalDate: formatDate(unextended),
    nominalDueDate: nominalString,
    dueDate: carriedString,
    carriedFrom: carriedString === nominalString ? null : nominalString,
    dueAtMs: endOfDayInstant(inputs.zone, carried),
  };
}

/** `Due Monday June 22, 11:59 pm Eastern` */
export function dueLine(dueDate: string, zone: string): string {
  return `Due ${longDate(parseDate(dueDate))}, 11:59 pm ${zoneLabel(zone)}`;
}

/** `Carried from Saturday June 20` */
export function carriedFromLine(nominalDate: string): string {
  return `Carried from ${longDate(parseDate(nominalDate))}`;
}
