import type { StringCount } from './api.js';

/** Whole minutes, a colon and two-digit seconds: `4:28`, `0:42`, `38:40`. */
export function formatRunningTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Five numbers joined by hyphens in section order: `10-8-6-5-4`. */
export function formatStringCount(count: StringCount): string {
  return [count.violin_1, count.violin_2, count.viola, count.cello, count.bass].join('-');
}

export const EN_DASH = '\u2013';
export const MINUS_SIGN = '\u2212';
export const MIDDLE_DOT = '\u00b7';

export function barSpanLabel(fromBar: number, toBar: number): string {
  return `${fromBar}${EN_DASH}${toBar}`;
}
