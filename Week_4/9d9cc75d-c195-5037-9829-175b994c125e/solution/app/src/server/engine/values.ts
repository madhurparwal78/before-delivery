// How the engine compares, keys and writes cells. Dates are UTC epoch milliseconds; every date rule works in UTC and
// weeks start on Monday.
import { round9 } from '../../shared/display.ts';
import type { Cell, DateLevel, ValueType } from '../../shared/model.ts';

const DAY_MS = 86400000;

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

/** `YYYY-MM-DD` of the UTC day the moment falls in. */
export function dayText(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`;
}

/** The start of the UTC day. */
export function dayStart(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/** Monday 1 to Sunday 7. */
export function weekday(ms: number): number {
  return ((new Date(ms).getUTCDay() + 6) % 7) + 1;
}

function mondayOf(ms: number): number {
  return dayStart(ms) - (weekday(ms) - 1) * DAY_MS;
}

/** The ISO 8601 week number: week 1 holds the year's first Thursday. */
export function isoWeek(ms: number): number {
  const thursday = mondayOf(ms) + 3 * DAY_MS;
  const yearStart = Date.UTC(new Date(thursday).getUTCFullYear(), 0, 1);
  return Math.floor((thursday - yearStart) / (7 * DAY_MS)) + 1;
}

export function truncateDate(ms: number, level: 'year' | 'month' | 'week' | 'day'): number {
  const d = new Date(ms);
  switch (level) {
    case 'year':
      return Date.UTC(d.getUTCFullYear(), 0, 1);
    case 'month':
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    case 'week':
      return mondayOf(ms);
    case 'day':
      return dayStart(ms);
  }
}

/** A date at a pill level: `YYYY`, `YYYY-MM`, or the `YYYY-MM-DD` of its Monday or day. */
export function dateAtLevel(ms: number, level: DateLevel): string {
  const text = dayText(truncateDate(ms, level));
  if (level === 'year') return text.slice(0, 4);
  if (level === 'month') return text.slice(0, 7);
  return text;
}

/** A date value as written in results and members: its day, or the full instant when it has a time of day. */
function dateText(ms: number): string {
  return ms === dayStart(ms) ? dayText(ms) : new Date(ms).toISOString();
}

/** The text a cell matches by: filter values, set members, group members and security values are compared this way. */
export function cellKey(cell: Cell, type: ValueType | null): string {
  if (cell === null) return '\u0000';
  if (typeof cell === 'number') return type === 'date' ? dateText(cell) : String(round9(cell));
  return String(cell);
}

/** A cell as it travels in a query answer: dates as text, numbers rounded to 9 decimals. */
export function outputCell(cell: Cell, type: ValueType | null): Cell {
  if (typeof cell !== 'number') return cell;
  return type === 'date' ? dateText(cell) : round9(cell);
}

/** Text by Unicode code point. */
function compareText(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const x = a.codePointAt(i) ?? 0;
    const y = b.codePointAt(i) ?? 0;
    if (x !== y) return x < y ? -1 : 1;
    if (x > 0xffff) i++;
  }
  return a.length - b.length;
}

const RANK: Record<string, number> = { boolean: 0, number: 1, string: 2 };

/** Ascending order of two non-null cells: false before true, numbers (and dates) by value, text by code point. */
export function compareValues(a: Exclude<Cell, null>, b: Exclude<Cell, null>): number {
  if (typeof a !== typeof b) return (RANK[typeof a] ?? 0) - (RANK[typeof b] ?? 0);
  if (typeof a === 'string') return compareText(a, b as string);
  return Number(a) - Number(b);
}

/** Ascending with nulls last; `descending` reverses the values but nulls stay last. */
export function compareCells(a: Cell, b: Cell, descending = false): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  const order = compareValues(a, b);
  return descending ? -order : order;
}
