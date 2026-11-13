/**
 * The one place the dispatch promise is decided, at quote time, from bin stock, working
 * days and the dispatch cut-off.
 */

import { config } from '../config';
import { addWorkingDays, isBefore, isWorkingDay, londonDate, londonInstant, nextWorkingDay, type LondonDate } from './time';

export type QuoteSource = 'bin' | 'supplier';

export interface DispatchPromise {
  kind: 'same_day' | 'later';
  date: LondonDate;
}

export function dispatchPromise(
  quotedAt: Date,
  source: QuoteSource,
  bankHolidays: ReadonlySet<LondonDate>,
): DispatchPromise {
  const businessDay = londonDate(quotedAt);
  const cutoff = londonInstant(businessDay, config.dispatchCutoffLocal.hour, config.dispatchCutoffLocal.minute);

  if (source === 'bin' && isWorkingDay(businessDay, bankHolidays) && isBefore(quotedAt, cutoff)) {
    return { kind: 'same_day', date: businessDay };
  }

  const date =
    source === 'bin'
      ? nextWorkingDay(businessDay, bankHolidays)
      : addWorkingDays(businessDay, 3, bankHolidays);
  return { kind: 'later', date };
}
