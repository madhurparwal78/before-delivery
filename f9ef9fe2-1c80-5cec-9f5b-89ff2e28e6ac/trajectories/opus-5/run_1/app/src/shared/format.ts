import { LOOM_START_MINUTE } from './types.js';

/** Dollars and cents with thousands commas, without a currency symbol. */
export function formatAmount(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.trunc(abs / 100);
  const remainder = abs % 100;
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${String(remainder).padStart(2, '0')}`;
}

export function formatMoney(cents: number): string {
  return `$${formatAmount(cents)}`;
}

/** Hours with two decimals, from a whole number of quarter hours. */
export function formatHours(quarters: number): string {
  return (quarters / 4).toFixed(2);
}

export function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function hhmmToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 24 || m > 59) return null;
  return h * 60 + m;
}

export function columnToMinute(column: number): number {
  return LOOM_START_MINUTE + column * 15;
}

export function minuteToColumn(minute: number): number {
  return (minute - LOOM_START_MINUTE) / 15;
}

export function isQuarterHour(minutes: number): boolean {
  return minutes % 15 === 0;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function monthName(month: string): string {
  const index = Number(month.slice(5, 7)) - 1;
  return MONTH_NAMES[index] ?? month;
}

/** A booking or document state name, with underscores replaced by spaces. */
export function stateWords(state: string): string {
  return state.replace(/_/g, ' ');
}
