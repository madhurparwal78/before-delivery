import type { Quota, TravelClass } from './berths';
import { addDaysToDate, istAt } from './ist';

export type BookingWindowState = 'not_yet_open' | 'open' | 'chart_prepared';

export const ADVANCE_RESERVATION_DAYS = 60;

/** The instant booking opens for a run date, class and quota, on the IST business clock. */
export function opensAt(runDate: string, travelClass: TravelClass, quota: Quota): number {
  if (quota === 'TQ') {
    return istAt(addDaysToDate(runDate, -1), travelClass === '3A' ? '10:00' : '11:00');
  }
  return istAt(addDaysToDate(runDate, -ADVANCE_RESERVATION_DAYS), '00:00');
}

/** Every edge is inclusive at its opening instant, and every quota closes at the chart instant. */
export function windowState(now: number, chartInstant: number, opening: number): BookingWindowState {
  if (now >= chartInstant) return 'chart_prepared';
  return now >= opening ? 'open' : 'not_yet_open';
}
