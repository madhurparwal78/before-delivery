// The kitchen clock: "now" is the Postgres clock (a transaction's start), read in this process's zone.

import { addDays, CLOSES_MINUTE, clockText, isoInZone, localDate, OPENS_MINUTE } from "../shared/clock.js";
import type { Kitchen, SpanStatus } from "../shared/api.js";
import { config } from "./config.js";
import { col, only, type Queryable } from "./postgres.js";

const KITCHEN_NAME = "Halfsheet Commissary";
export const CLEANUP_MINUTES = 30;
export const MINIMUM_BOOKING_MINUTES = 120;
const HORIZON_DAYS = 60;
export const CHECK_IN_LEAD_MINUTES = 30;
export const zone = config.timeZone;

export interface KitchenTime {
  now: number;
  today: string;
}

export async function kitchenTime(q: Queryable): Promise<KitchenTime> {
  const now = col.time(only(await q.query("SELECT now() AS now")), "now").getTime();
  return { now, today: localDate(now, zone) };
}

export function iso(instant: Date | number): string {
  return isoInZone(typeof instant === "number" ? instant : instant.getTime(), zone);
}

export function kitchen(time: KitchenTime): Kitchen {
  return {
    name: KITCHEN_NAME,
    timeZone: zone,
    opensAt: clockText(OPENS_MINUTE),
    closesAt: clockText(CLOSES_MINUTE),
    cleanupMinutes: CLEANUP_MINUTES,
    minimumBookingMinutes: MINIMUM_BOOKING_MINUTES,
    holdSeconds: config.holdSeconds,
    today: time.today,
    now: iso(time.now),
  };
}

/** Span status: started when the span's start is at or before now, beyond the horizon past today plus 60 days, otherwise open. */
export function spanStatus(start: number, time: KitchenTime): SpanStatus {
  if (start <= time.now) return "started";
  return localDate(start, zone) > addDays(time.today, HORIZON_DAYS) ? "beyond_horizon" : "open";
}
