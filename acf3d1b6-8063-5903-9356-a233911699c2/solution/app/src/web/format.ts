// Dates and amounts as the studio writes them. Every time is shown in UTC.

import { formatNumber } from '../shared/catalog.js';

const DAY = 86_400_000;

/** "22 October 2026", in UTC like every time the studio shows. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function formatDateTime(iso: string): string {
  const time = new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return `${formatDate(iso)}, ${time} UTC`;
}

/** "Today", "Yesterday" or the date, by UTC day. */
export function dayHeading(iso: string, now = Date.now()): string {
  const day = Math.floor(new Date(iso).getTime() / DAY);
  const today = Math.floor(now / DAY);
  if (day === today) return 'Today';
  if (day === today - 1) return 'Yesterday';
  return formatDate(iso);
}

export function signed(amount: number): string {
  return `${amount > 0 ? '+' : '-'}${formatNumber(Math.abs(amount))}`;
}
