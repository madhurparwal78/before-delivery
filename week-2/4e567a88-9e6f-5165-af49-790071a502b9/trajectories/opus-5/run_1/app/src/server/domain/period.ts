import { localPartsOf, monthLabelOf, monthStartInstant } from './zone';

export interface BudgetPeriod {
  label: string;
  startsAt: Date;
  endsAt: Date;
}

/** The budget period containing an instant, bounded by midnight on the 1st in the org zone. */
export function budgetPeriod(instant: Date, timezone: string): BudgetPeriod {
  const parts = localPartsOf(instant, timezone);
  const startsAt = monthStartInstant(parts.year, parts.month, timezone);
  const nextYear = parts.month === 12 ? parts.year + 1 : parts.year;
  const nextMonth = parts.month === 12 ? 1 : parts.month + 1;
  const endsAt = monthStartInstant(nextYear, nextMonth, timezone);
  return { label: monthLabelOf(instant, timezone), startsAt, endsAt };
}
