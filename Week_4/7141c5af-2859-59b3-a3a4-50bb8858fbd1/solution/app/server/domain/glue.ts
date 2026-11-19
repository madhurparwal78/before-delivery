import { copy } from "./copy.ts";
import { TURIN_ZONE } from "./towns.ts";
import { addSeconds, datetimeCopy, instant, wallInstant } from "./time.ts";

const CURE_SECONDS = 48 * 3600;
const BENCH_DAY_START = "09:00";

/** Glue cures for 48 hours of real elapsed time, across any 23-hour or 25-hour day. */
function curesAt(laidAt: Date): Date {
  return addSeconds(laidAt, CURE_SECONDS);
}

export function glueBody(laidAt: Date | null) {
  if (!laidAt) return null;
  const cures = curesAt(laidAt);
  const cured = cures.getTime() <= Date.now();
  return {
    laidAt: instant(laidAt),
    curesAt: instant(cures),
    state: cured ? "cured" : "curing",
    label: cured ? "Cured" : `Curing until ${datetimeCopy(cures)}`,
  };
}

/** A cover job goes on a day only if the piece's glue has cured by that bench day's start. */
export function coverDayRefusal(laidAt: Date | null, day: string, title: string): string | null {
  if (!laidAt) return null;
  const cures = curesAt(laidAt);
  const start = wallInstant(day, BENCH_DAY_START, TURIN_ZONE) as Date;
  return cures.getTime() <= start.getTime() ? null : copy("F-67", { title, datetime: datetimeCopy(cures) });
}
