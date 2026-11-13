import { Reason } from '../shared/types';
import { Inventory, nightOf, roomsLeft, stayDates } from './inventory';
import { diffDays } from './zone';

export interface StayRequest {
  inDate: string;
  outDate: string;
  todayLocal: string;
}

/**
 * The stay restrictions, checked in the published order; the first failure
 * wins. `rooms` is the number of rooms wanted of this room type.
 */
export function checkStay(
  inv: Inventory,
  roomTypeCode: string,
  rooms: number,
  req: StayRequest,
): Reason | null {
  const arrival = nightOf(inv, roomTypeCode, req.inDate);
  if (!arrival) return { code: 'stop_sell', date: req.inDate };
  const nights = diffDays(req.inDate, req.outDate);

  if (diffDays(req.todayLocal, req.inDate) < arrival.release_days) {
    return { code: 'release', n: arrival.release_days };
  }
  if (arrival.closed_to_arrival) return { code: 'no_arrival', date: req.inDate };
  const departure = nightOf(inv, roomTypeCode, req.outDate);
  if (departure && departure.closed_to_departure) return { code: 'no_departure', date: req.outDate };
  if (nights < arrival.min_stay) return { code: 'min_stay', date: req.inDate, n: arrival.min_stay };
  if (nights > arrival.max_stay) return { code: 'max_stay', date: req.inDate, n: arrival.max_stay };
  for (const date of stayDates(req.inDate, req.outDate)) {
    const night = nightOf(inv, roomTypeCode, date);
    if (!night || night.stop_sell) return { code: 'stop_sell', date };
  }
  for (const date of stayDates(req.inDate, req.outDate)) {
    if (roomsLeft(inv, roomTypeCode, date) < rooms) return { code: 'sold_out', date };
  }
  return null;
}

/** Checks a whole selection, taking the room types in code order. */
export function checkSelection(
  inv: Inventory,
  counts: Map<string, number>,
  req: StayRequest,
): Reason | null {
  const codes = [...counts.keys()].sort();
  for (const code of codes) {
    const wanted = counts.get(code) ?? 0;
    if (wanted <= 0) continue;
    const reason = checkStay(inv, code, wanted, req);
    if (reason) return reason;
  }
  return null;
}

/** The arrival-only checks of a single day, used by the date picker. */
export function checkArrivalDay(
  inv: Inventory,
  roomTypeCode: string,
  date: string,
  todayLocal: string,
): Reason | null {
  const night = nightOf(inv, roomTypeCode, date);
  if (!night) return { code: 'stop_sell', date };
  if (diffDays(todayLocal, date) < night.release_days) return { code: 'release', n: night.release_days };
  if (night.closed_to_arrival) return { code: 'no_arrival', date };
  if (night.stop_sell) return { code: 'stop_sell', date };
  if (roomsLeft(inv, roomTypeCode, date) < 1) return { code: 'sold_out', date };
  return null;
}

/** The checks that remain for a departure day once an arrival is chosen. */
export function checkDepartureDay(
  inv: Inventory,
  roomTypeCode: string,
  inDate: string,
  outDate: string,
): { reason: Reason | null; short: boolean } {
  const arrival = nightOf(inv, roomTypeCode, inDate);
  if (!arrival) return { reason: { code: 'stop_sell', date: inDate }, short: false };
  const nights = diffDays(inDate, outDate);
  const departure = nightOf(inv, roomTypeCode, outDate);
  if (departure && departure.closed_to_departure) return { reason: { code: 'no_departure', date: outDate }, short: false };
  if (nights < arrival.min_stay) return { reason: { code: 'min_stay', date: inDate, n: arrival.min_stay }, short: true };
  if (nights > arrival.max_stay) return { reason: { code: 'max_stay', date: inDate, n: arrival.max_stay }, short: false };
  for (const date of stayDates(inDate, outDate)) {
    const night = nightOf(inv, roomTypeCode, date);
    if (!night || night.stop_sell) return { reason: { code: 'stop_sell', date }, short: false };
  }
  for (const date of stayDates(inDate, outDate)) {
    if (roomsLeft(inv, roomTypeCode, date) < 1) return { reason: { code: 'sold_out', date }, short: false };
  }
  return { reason: null, short: false };
}
