import type { HubId, ModelId } from "../shared/catalogue.js";
import { HOUR_MS, addDays, istDate, istInstant, istParts, slotKey, weekdayOf } from "../shared/clock.js";
import type { LockState, Quote } from "../shared/types.js";

/**
 * Every domain rule of the product is decided here once: closed days, price steps, the on-road make-up,
 * lock expiry, units left, test-ride slots and cut-offs, delivery days and the actions a row offers.
 */

// --- hub calendar

const TUESDAY = 2;
const EXTRA_CLOSED_DAYS: Readonly<Record<string, readonly HubId[]>> = {
  "2026-11-08": ["pune", "bengaluru", "gurugram", "kochi"],
  "2026-11-01": ["bengaluru", "kochi"],
  "2026-11-09": ["gurugram"],
};

const isClosedDay = (hub: HubId, date: string): boolean =>
  weekdayOf(date) === TUESDAY || (EXTRA_CLOSED_DAYS[date]?.includes(hub) ?? false);

// --- the on-road make-up (all money is integer paise; rates are tenths of a percent)

const MODEL_PRICES: Readonly<
  Record<ModelId, { gstPercent: number; insurancePaise: number; steps: readonly { from: string; exFactoryPaise: number }[] }>
> = {
  "megh-349": {
    gstPercent: 18,
    insurancePaise: 980_000,
    steps: [
      { from: "2026-10-01", exFactoryPaise: 19_000_000 },
      { from: "2026-11-01", exFactoryPaise: 19_500_000 },
    ],
  },
  "desh-648": {
    gstPercent: 40,
    insurancePaise: 1_460_000,
    steps: [
      { from: "2026-10-01", exFactoryPaise: 26_000_000 },
      { from: "2026-11-01", exFactoryPaise: 26_500_000 },
    ],
  },
};

const ROAD_TAX_STEPS: Readonly<Record<HubId, readonly { from: string; tenths: number }[]>> = {
  pune: [{ from: "2026-10-01", tenths: 110 }],
  bengaluru: [{ from: "2026-10-01", tenths: 180 }],
  gurugram: [{ from: "2026-10-01", tenths: 80 }],
  kochi: [
    { from: "2026-10-01", tenths: 120 },
    { from: "2026-11-02", tenths: 125 },
  ],
};

const inForce = <T extends { from: string }>(steps: readonly T[], date: string): T =>
  [...steps].reverse().find((s) => s.from <= date) ?? (steps[0] as T);

export function quoteFor(hub: HubId, model: ModelId, nowMs: number): Quote {
  const today = istDate(nowMs);
  const price = MODEL_PRICES[model];
  const modelStep = inForce(price.steps, today);
  const taxStep = inForce(ROAD_TAX_STEPS[hub], today);
  const gstPaise = Math.floor((modelStep.exFactoryPaise * price.gstPercent) / 100);
  const exShowroomPaise = modelStep.exFactoryPaise + gstPaise;
  const roadTaxPaise = Math.floor((exShowroomPaise * taxStep.tenths + 500) / 1000);
  return {
    stepEffectiveFrom: modelStep.from > taxStep.from ? modelStep.from : taxStep.from,
    exFactoryPaise: modelStep.exFactoryPaise,
    gstPercent: price.gstPercent,
    gstPaise,
    exShowroomPaise,
    roadTaxPercent: taxStep.tenths / 10,
    roadTaxPaise,
    insurancePaise: price.insurancePaise,
    onRoadPaise: exShowroomPaise + roadTaxPaise + price.insurancePaise,
  };
}

// --- price locks

const EXPIRY_TIME = "18:00";
const LOCK_DAYS = 2;

/** A lock ends at 18:00 IST on the second day after issue; issued from 18:00 it counts from the next date, and a
 * closed day at the hub moves the end to the next open day. */
export function lockExpiry(hub: HubId, issuedMs: number): number {
  const issued = istParts(issuedMs);
  let date = addDays(issued.date, LOCK_DAYS + (issued.hour >= 18 ? 1 : 0));
  while (isClosedDay(hub, date)) date = addDays(date, 1);
  return istInstant(date, EXPIRY_TIME);
}

/** A lock whose expiry the clock has passed reads as expired even before the next sweep of the clock records it. */
export const effectiveState = (row: { state: LockState; expires_ms: number | null }, nowMs: number): LockState =>
  (row.state === "requested" || row.state === "locked") && row.expires_ms !== null && row.expires_ms <= nowMs ? "expired" : row.state;

export const hoursLeft = (expiresMs: number, nowMs: number): number =>
  expiresMs > nowMs ? Math.ceil((expiresMs - nowMs) / HOUR_MS) : 0;

/** The ledger score of a hold: its expiry on the app clock, or infinity (null) once a delivery day is set. */
export const holdScore = (state: string, expiresMs: number | null): number | null => (state === "delivery_set" ? null : expiresMs);

export const unitsLeft = (onHand: number, holds: number): number => Math.max(0, onHand - holds);

/** The ledger gate for one unit: the units-left rule above, run atomically with the ZADD inside the ledger. */
export const CLAIM_UNIT = `
if redis.call('EXISTS', KEYS[1]) == 0 and ARGV[3] ~= '1' then return 'missing' end
local oh = redis.call('GET', KEYS[1])
local n = 0
if oh then
  n = tonumber(oh)
  if (not n) or n ~= math.floor(n) then return 'damaged' end
end
local held = redis.call('ZCARD', KEYS[2])
if held >= n then return 'none' end
redis.call('ZADD', KEYS[2], ARGV[2], ARGV[1])
return 'ok'`;

/** A claim that takes the last unit waits for the hub host to confirm it on the floor. */
export const takesLastUnit = (left: number): boolean => left === 1;

/** The ledger key minute of a slot, `2026-10-30T11:30` on IST. */
export const slotMinute = (startMs: number): string => `${istDate(startMs)}T${slotKey(startMs)}`;


// --- test-ride slots

const FIRST_SLOT_MINUTE = 10 * 60;
const SLOT_GAP = 45;
const SLOT_COUNT = 12;
const CUT_OFF_MS = 2 * HOUR_MS;
const RIDE_WINDOW_DAYS = 14;

/** The day sheet offers every IST date from a week back to a month ahead. */
export const SHEET_DAYS_BACK = 7;
export const SHEET_DAYS_AHEAD = 30;

export const slotsOf = (date: string): number[] =>
  Array.from({ length: SLOT_COUNT }, (_, i) => {
    const minute = FIRST_SLOT_MINUTE + i * SLOT_GAP;
    return istInstant(date, `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, "0")}`);
  });

export const cutOffOf = (startMs: number): number => startMs - CUT_OFF_MS;
export const isPastCutOff = (startMs: number, nowMs: number): boolean => nowMs >= cutOffOf(startMs);

export const rideDays = (hub: HubId, nowMs: number): string[] => {
  const today = istDate(nowMs);
  return Array.from({ length: RIDE_WINDOW_DAYS + 1 }, (_, i) => addDays(today, i)).filter((d) => !isClosedDay(hub, d));
};

/** A date inside the booking window and open at the hub. */
export const isRideDay = (hub: HubId, date: string, nowMs: number): boolean => rideDays(hub, nowMs).includes(date);

/** A start is in the bookable pattern only at a published time on an open day within the window. */
export function isBookableStart(hub: HubId, startMs: number, nowMs: number): boolean {
  const date = istDate(startMs);
  return slotsOf(date).includes(startMs) && isRideDay(hub, date, nowMs);
}

export const mayMark = (startMs: number, nowMs: number): boolean => nowMs >= startMs;

// --- delivery days

const DELIVERY_FROM_DAYS = 3;
const DELIVERY_TO_DAYS = 30;
const DELIVERY_CLOSING = "16:00";
const NORMAL_CAPACITY = 4;
const DHANTERAS = "2026-11-06";
const DHANTERAS_CAPACITY = 12;

export const deliveryCapacity = (date: string): number => (date === DHANTERAS ? DHANTERAS_CAPACITY : NORMAL_CAPACITY);

/** Places still open on a day, given how many are taken. */
export const placesLeft = (date: string, taken: number): number => Math.max(0, deliveryCapacity(date) - taken);

export const deliveryWindow = (issuedMs: number): string[] => {
  const issued = istDate(issuedMs);
  return Array.from({ length: DELIVERY_TO_DAYS - DELIVERY_FROM_DAYS + 1 }, (_, i) => addDays(issued, DELIVERY_FROM_DAYS + i));
};

/** A day closes for choosing at 16:00 IST on the previous calendar day. */
export const deliveryClosesAt = (date: string): number => istInstant(addDays(date, -1), DELIVERY_CLOSING);

export const isDeliveryClosed = (hub: HubId, date: string, nowMs: number, issuedMs: number): boolean =>
  !deliveryWindow(issuedMs).includes(date) || isClosedDay(hub, date) || nowMs >= deliveryClosesAt(date);

/** `deliveryDate` handed to the hub host is due from 00:00:00 IST on the day itself. */
export const mayDeliver = (deliveryDate: string, nowMs: number): boolean => nowMs >= istInstant(deliveryDate, "00:00");

// --- rows the browser may act on

export const rideActions = (startMs: number, nowMs: number): ("ridden" | "no_show")[] =>
  mayMark(startMs, nowMs) ? ["ridden", "no_show"] : [];
export const handoverActions = (deliveryDate: string, nowMs: number): "delivered"[] =>
  mayDeliver(deliveryDate, nowMs) ? ["delivered"] : [];
export const heldActions = (state: "requested" | "locked" | "delivery_set"): ("confirm" | "refuse" | "withdraw")[] =>
  state === "requested" ? ["confirm", "refuse"] : ["withdraw"];

