import { ValidationError } from './errors.ts';
import { districtDate } from './time.ts';

/** District-date periods: pack previews, pack submissions, totals and the Review page. */

export interface Period {
  from: string;
  to: string;
}

const DAY_MS = 86_400_000;
const MAX_DAYS = 92;

const COPY = {
  from: 'Enter a from date as YYYY-MM-DD.',
  to: 'Enter a to date as YYYY-MM-DD.',
  order: 'The to date cannot be before the from date.',
  length: 'A period cannot be longer than 92 days.',
} as const;

function parseDate(text: string | null): number | null {
  if (text === null || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const value = Date.parse(`${text}T00:00:00Z`);
  if (Number.isNaN(value)) return null;
  return new Date(value).toISOString().slice(0, 10) === text ? value : null;
}

/** A required period, with each failure reported on one field. */
export function requirePeriod(from: string | null, to: string | null): Period {
  const fromValue = parseDate(from);
  if (fromValue === null) throw ValidationError.field('from', COPY.from);
  const toValue = parseDate(to);
  if (toValue === null) throw ValidationError.field('to', COPY.to);
  if (toValue < fromValue) throw ValidationError.field('to', COPY.order);
  if (toValue - fromValue > (MAX_DAYS - 1) * DAY_MS) throw ValidationError.field('to', COPY.length);
  return { from: from as string, to: to as string };
}

/** The totals period is optional, but only as a pair. */
export function optionalPeriod(from: string | null, to: string | null): Period | null {
  if (from === null && to === null) return null;
  if (from === null) throw ValidationError.field('from', COPY.from);
  if (to === null) throw ValidationError.field('to', COPY.to);
  return requirePeriod(from, to);
}

/** A period covers exactly the windows whose opening falls on one of its district dates. */
export function periodCoversOpening(period: Period, opensAt: Date): boolean {
  const date = districtDate(opensAt);
  return date >= period.from && date <= period.to;
}
