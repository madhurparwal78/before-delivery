// Screen formats, exactly as published.
export {
  formatAmount, trimTrailingZeros, formatFiat, centsToAmountString, formatDateTime, formatShortDate,
  formatClock, formatMonthLabel, formatCountdown, maskAddress, initials, maskIdentity, formatDate,
} from '../shared/util.js';

import { formatDateTime as fmtDateTime, formatShortDate, formatCountdown as fmtCountdown, formatDate as fmtDate } from '../shared/util.js';

export function formatStamp(iso: string, timeZone: string, city: string): string {
  return fmtDateTime(new Date(iso), timeZone, city);
}

export function stampFormatter(timeZone: string, city: string): (iso: string | null) => string {
  return (iso: string | null) => (iso === null ? '' : formatStamp(iso, timeZone, city));
}

export function formatCountdownSeconds(remainingSeconds: number, prefix: string): string {
  return `${prefix} ${fmtCountdown(remainingSeconds)}`;
}

export function shortStamp(iso: string, timeZone: string): string {
  return formatShortDate(new Date(iso), timeZone);
}

export function dateStamp(iso: string, timeZone: string): string {
  return fmtDate(new Date(iso), timeZone);
}
