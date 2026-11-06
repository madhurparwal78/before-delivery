import type { Quota, TravelClass } from './berths';
import type { Paise } from './money';
import { RUPEE } from './money';

const RATE_PER_KM: Readonly<Record<TravelClass, Paise>> = { SL: 45, '3A': 120 };
const RESERVATION_CHARGE: Readonly<Record<TravelClass, Paise>> = { SL: 20 * RUPEE, '3A': 40 * RUPEE };
const TATKAL_CHARGE: Readonly<Record<TravelClass, Paise>> = { SL: 150 * RUPEE, '3A': 400 * RUPEE };
const FARE_STEP: Paise = 5 * RUPEE;
export const GST_NUMERATOR = 5;
export const GST_DENOMINATOR = 100;

/** Children under five travel NOSB: no berth, no fare, and not counted in any availability. */
export const CHILD_MAX_AGE = 4;

export function isChild(age: number): boolean {
  return age <= CHILD_MAX_AGE;
}

export function chargesGst(travelClass: TravelClass): boolean {
  return travelClass === '3A';
}

export interface PassengerFare {
  readonly beforeGst: Paise;
  readonly gst: Paise;
  readonly total: Paise;
}

export const NO_FARE: PassengerFare = { beforeGst: 0, gst: 0, total: 0 };

/** One passenger aged 5 or over: base fare, reservation charge, any Tatkal charge, then GST on AC. */
export function passengerFare(
  kilometres: number,
  travelClass: TravelClass,
  quota: Quota,
): PassengerFare {
  const raw = kilometres * RATE_PER_KM[travelClass];
  const base = Math.ceil(raw / FARE_STEP) * FARE_STEP;
  const beforeGst = base
    + RESERVATION_CHARGE[travelClass]
    + (quota === 'TQ' ? TATKAL_CHARGE[travelClass] : 0);
  const gst = chargesGst(travelClass) ? (beforeGst * GST_NUMERATOR) / GST_DENOMINATOR : 0;
  return { beforeGst, gst, total: beforeGst + gst };
}

export interface FareLine {
  readonly label: string;
  readonly amount_paise: Paise;
}

export interface FareQuote {
  readonly lines: readonly FareLine[];
  readonly total_paise: Paise;
  readonly perPassenger: readonly PassengerFare[];
}

/** The fare quote for a whole party, in PNR order. */
export function quoteFare(
  ages: readonly number[],
  kilometres: number,
  travelClass: TravelClass,
  quota: Quota,
): FareQuote {
  const perPassenger = ages.map((age) =>
    (isChild(age) ? NO_FARE : passengerFare(kilometres, travelClass, quota)));
  const lines: FareLine[] = perPassenger.map((fare, index) =>
    (isChild(ages[index])
      ? { label: `Passenger ${index + 1} — under five, no berth`, amount_paise: 0 }
      : { label: `Passenger ${index + 1} fare`, amount_paise: fare.beforeGst }));
  const gstTotal = perPassenger.reduce((sum, fare) => sum + fare.gst, 0);
  if (chargesGst(travelClass)) lines.push({ label: 'GST 5%', amount_paise: gstTotal });
  const total = perPassenger.reduce((sum, fare) => sum + fare.total, 0);
  return { lines, total_paise: total, perPassenger };
}
