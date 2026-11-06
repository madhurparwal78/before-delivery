// Budget periods: midnight on the 1st to midnight on the next 1st, both computed in the org time zone.

import { MONTHS, instantOf, localAt } from "../../shared/tz";

export interface BudgetPeriod {
  label: string;
  startsAt: Date;
  endsAt: Date;
}

/** The first instant of local midnight on the 1st; a zone that skips midnight starts at the first minute after. */
function monthStart(year: number, month: number, zone: string): number {
  for (let minute = 0; ; minute++) {
    const at = instantOf({ year, month, day: 1, hour: Math.floor(minute / 60), minute: minute % 60, second: 0 }, zone);
    if (at !== null) return at;
  }
}

export function budgetPeriod(at: Date, zone: string): BudgetPeriod {
  const local = localAt(at.getTime(), zone);
  const nextYear = local.month === 12 ? local.year + 1 : local.year;
  const nextMonth = local.month === 12 ? 1 : local.month + 1;
  return {
    label: `${MONTHS[local.month - 1]} ${local.year}`,
    startsAt: new Date(monthStart(local.year, local.month, zone)),
    endsAt: new Date(monthStart(nextYear, nextMonth, zone)),
  };
}
