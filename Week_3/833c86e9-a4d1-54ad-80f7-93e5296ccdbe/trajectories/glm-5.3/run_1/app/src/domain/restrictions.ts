export type ReasonCode = "release" | "no_arrival" | "no_departure" | "min_stay" | "max_stay" | "stop_sell" | "sold_out";

export type Reason = { code: ReasonCode; date?: string; n?: number };

export type NightInventory = {
  date: string;
  rate_minor: number;
  allotment: number;
  left: number;
  min_stay: number;
  max_stay: number;
  closed_to_arrival: boolean;
  closed_to_departure: boolean;
  stop_sell: boolean;
  release_days: number;
};

export type StayCheckInput = {
  in: string;
  out: string;
  /** rooms wanted of this room type */
  rooms: number;
  nights: string[];
  inv: Map<string, NightInventory>;
  /** property-local today */
  today: string;
  /** rooms of this booking already held on these nights (excluded from left) */
  ignoreHold?: number;
};

export const MAX_STAY_NIGHTS = 30;

/**
 * The published stay restriction checks, in order; the first failure wins.
 * Nights must be the in..out list; left values already exclude held rooms.
 */
export function checkStay(input: StayCheckInput): Reason | null {
  const { in: arrival, out: departure, rooms, nights, inv, today } = input;
  const arrInv = inv.get(arrival);
  if (!arrInv) return { code: "sold_out", date: arrival };
  // 1. Release days.
  if (arrInv.release_days > 0) {
    const diff = daysBetween(today, arrival);
    if (diff < arrInv.release_days) return { code: "release", n: arrInv.release_days };
  }
  // 2. Closed to arrival.
  if (arrInv.closed_to_arrival) return { code: "no_arrival", date: arrival };
  // 3. Closed to departure.
  const depInv = inv.get(departure);
  if (depInv && depInv.closed_to_departure) return { code: "no_departure", date: departure };
  // 4. Minimum stay.
  if (nights.length < arrInv.min_stay) return { code: "min_stay", date: arrival, n: arrInv.min_stay };
  // 5. Maximum stay.
  if (nights.length > arrInv.max_stay) return { code: "max_stay", date: arrival, n: arrInv.max_stay };
  // 6 & 7. Each night in date order.
  for (const date of nights) {
    const n = inv.get(date);
    if (!n) return { code: "sold_out", date };
    if (n.stop_sell) return { code: "stop_sell", date };
  }
  for (const date of nights) {
    const n = inv.get(date)!;
    if (n.left < rooms) return { code: "sold_out", date };
  }
  return null;
}

/** Arrival-only checks used by the date picker: release, closed to arrival, stop sell, one room left. */
export function arrivalCheck(inv: NightInventory, date: string, today: string): Reason | null {
  if (inv.release_days > 0) {
    const diff = daysBetween(today, date);
    if (diff < inv.release_days) return { code: "release", n: inv.release_days };
  }
  if (inv.closed_to_arrival) return { code: "no_arrival", date };
  if (inv.stop_sell) return { code: "stop_sell", date };
  if (inv.left < 1) return { code: "sold_out", date };
  return null;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}
