function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** The cycle date in a month, or the month's last day when the month is shorter. */
function cycleDate(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, Math.min(day, daysInMonth(year, monthIndex))));
}

export interface BillingCycle {
  /** The most recent cycle date, which the current cycle starts on. */
  readonly start: Date;
  /** The next cycle date, which the quota resets on. */
  readonly resetsOn: Date;
}

export function billingCycle(today: Date, cycleDay: number): BillingCycle {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const midnight = new Date(
    Date.UTC(year, month, today.getUTCDate()),
  );
  const thisMonth = cycleDate(year, month, cycleDay);
  if (thisMonth.getTime() <= midnight.getTime()) {
    return { start: thisMonth, resetsOn: cycleDate(year, month + 1, cycleDay) };
  }
  return { start: cycleDate(year, month - 1, cycleDay), resetsOn: thisMonth };
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
