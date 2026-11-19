// The display rule: the one place that decides how a value is written, in a mark, a tooltip, a twin cell, a PDF or a CSV.
import type { Cell, MeasurePill, TableCalcKind } from './model.ts';

const NULL_TEXT = '(null)';

/** Every computed value is an IEEE double, first rounded to 9 decimals, before any display rounding. */
export function round9(value: number): number {
  return Number(value.toFixed(9));
}

/** Rounds half away from zero to `decimals`, working on the decimal text so 1.005 and 2.675 behave as written. */
export function roundHalfAway(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value;
  const [whole = '0', fraction = ''] = Math.abs(round9(value)).toFixed(9).split('.');
  const kept = fraction.slice(0, decimals);
  let digits = BigInt(whole + kept);
  if (fraction.charCodeAt(decimals) >= 53) digits += 1n;
  const text = digits.toString().padStart(decimals + 1, '0');
  const rounded = Number(decimals === 0 ? text : `${text.slice(0, -decimals)}.${text.slice(-decimals)}`);
  return value < 0 && rounded !== 0 ? -rounded : rounded;
}

function trimmed(value: number, decimals: number): string {
  const text = value.toFixed(decimals);
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

function withThousands(text: string): string {
  const negative = text.startsWith('-');
  const [whole = '', fraction] = (negative ? text.slice(1) : text).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${fraction === undefined ? '' : `.${fraction}`}`;
}

/** Comma thousands (unless `thousands` is false), at most 2 decimals, no trailing zeros. */
export function formatNumber(value: number, thousands = true): string {
  const text = trimmed(roundHalfAway(value, 2), 2);
  return thousands ? withThousands(text) : text;
}

/** A share (a fraction) as a percent with at most 1 decimal and no trailing zero. */
export function formatShare(value: number): string {
  return `${trimmed(roundHalfAway(round9(value * 100), 1), 1)}%`;
}

/** `data-value`: rounded half away from zero to 4 decimals, no thousands separator, no trailing zeros, empty for null. */
export function dataValue(value: Cell): string {
  if (value === null) return '';
  if (typeof value === 'number') return trimmed(roundHalfAway(value, 4), 4);
  return String(value);
}

/** The text a cell shows. `share` marks a fraction that shows as a percent. */
export function formatCell(value: Cell | 'n/a', options: { share?: boolean; thousands?: boolean } = {}): string {
  if (value === null) return NULL_TEXT;
  if (typeof value === 'number') return options.share ? formatShare(value) : formatNumber(value, options.thousands ?? true);
  return String(value);
}

/** Integers in notices, like the mark limit: `2,001`. */
export function formatCount(value: number): string {
  return withThousands(String(value));
}

export const TABLE_CALC_WORDS: Record<TableCalcKind, string> = {
  run_total: 'Running total',
  prev_diff: 'Difference from previous',
  share: 'Percent of total',
  rank: 'Rank',
};

/** SUM shows the field name, any other aggregation `{AGG} {field}`; a table calculation is `{Calculation} of {caption}`. */
export function measureCaption(pill: MeasurePill): string {
  const base = pill.agg === 'SUM' ? pill.field : `${pill.agg} ${pill.field}`;
  return pill.table_calc ? `${TABLE_CALC_WORDS[pill.table_calc.kind]} of ${base}` : base;
}
