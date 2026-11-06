/**
 * The withdrawal deadline: the only place it is computed.
 *
 * For a delivered posted kit the deadline is 23:59:00 Amsterdam time on the
 * 14th day after `deliveredOn`. If that day is a Saturday, a Sunday or a
 * holiday of the order's delivery country, it rolls forward to the same time
 * on the next day that is none of these, with the true Amsterdam offset on
 * that date.
 */

import { WITHDRAWAL_HOLIDAYS, WITHDRAWAL_PERIOD_DAYS } from '../../shared/seed.js';
import type { DeliveryCountry, OrderState } from '../../shared/types.js';
import { addDays, dayOfWeek, instantAtAmsterdamWallTime, parseIsoDate } from './clock.js';

const SATURDAY = 6;
const SUNDAY = 0;

function isClosedDay(date: string, country: DeliveryCountry): boolean {
  const weekday = dayOfWeek(date);
  if (weekday === SATURDAY || weekday === SUNDAY) return true;
  return WITHDRAWAL_HOLIDAYS[country].includes(date);
}

/** The rolled-forward deadline date for a delivery. */
export function withdrawalDeadlineDate(deliveredOn: string, country: DeliveryCountry): string {
  let date = addDays(deliveredOn, WITHDRAWAL_PERIOD_DAYS);
  while (isClosedDay(date, country)) date = addDays(date, 1);
  return date;
}

/** The deadline instant, or null when the order has no delivery date. */
export function withdrawalDeadline(
  deliveredOn: string | null,
  country: DeliveryCountry,
): Date | null {
  if (!deliveredOn) return null;
  const date = withdrawalDeadlineDate(deliveredOn, country);
  const { year, month, day } = parseIsoDate(date);
  const instant = instantAtAmsterdamWallTime(year, month, day, 23, 59, 0);
  if (!instant) throw new Error(`23:59 does not exist on ${date}`);
  return instant;
}

/** States a withdrawal can never be accepted from. */
const CLOSED_STATES: readonly OrderState[] = ['fitted', 'inspection passed', 'withdrawn'];

export function stateAllowsWithdrawal(state: OrderState): boolean {
  return !CLOSED_STATES.includes(state);
}

/**
 * Whether a withdrawal request would be accepted now by state and deadline.
 * A request at or before the deadline instant is accepted.
 */
export function isWithdrawalOpen(
  state: OrderState,
  deadline: Date | null,
  now: Date,
): boolean {
  if (!stateAllowsWithdrawal(state)) return false;
  if (!deadline) return true;
  return now.getTime() <= deadline.getTime();
}
