// Formatting for visible copy, from the shared rules so the browser and the
// server never disagree.

import { clockFromMinutes, minutesFromClock, durationText, hoursText } from '../shared/rules';

export { clockFromMinutes, minutesFromClock, durationText, hoursText };

/** "Wed 10 Feb 2027" for the board heading. */
export function longDate(date: string): string {
  const dt = new Date(Date.parse(date + 'T12:00:00Z'));
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${weekdays[dt.getUTCDay()]} ${dt.getUTCDate()} ${months[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

/** "10 Feb" for ticket slips. */
export function shortDate(date: string): string {
  const dt = new Date(Date.parse(date + 'T12:00:00Z'));
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${dt.getUTCDate()} ${months[dt.getUTCMonth()]}`;
}

export function addDays(date: string, days: number): string {
  const dt = new Date(Date.parse(date + 'T00:00:00Z'));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** Kitchen-local minutes-of-day from a server instant string. */
export function clockFromInstant(instant: string, timeZone: string): { date: string; minutes: number } {
  const epoch = Date.parse(instant);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const out: Record<string, number> = {};
  for (const p of dtf.formatToParts(new Date(epoch))) out[p.type] = Number(p.value);
  const hour = out['hour'] === 24 ? 0 : out['hour'] ?? 0;
  const month = out['month'] ?? 0;
  const day = out['day'] ?? 0;
  const year = out['year'] ?? 0;
  const minute = out['minute'] ?? 0;
  const date = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { date, minutes: hour * 60 + minute };
}

/** Countdown mm:ss between a server expiry instant and the server's now. */
export function countdownText(expiresAt: string, serverNowEpoch: number): string {
  const seconds = Math.max(0, Math.floor((Date.parse(expiresAt) - serverNowEpoch) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function money(amount: string): string {
  return '$' + amount;
}

export function documentKindLabel(kind: string): string {
  return kind === 'liability_insurance' ? 'Liability insurance' : 'Food handler card';
}

export function documentStatusLabel(status: string): string {
  switch (status) {
    case 'uploaded':
      return 'Waiting for review';
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Rejected';
    case 'expired':
      return 'Expired';
  }
  return status;
}
