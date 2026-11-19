// Dates and figures, shown the way the brief writes them. London time, whatever zone the device
// is in, and time left only from the server's seconds.

import { money, timeLeft } from '../shared/measures.js';

const DATE = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** `14 Nov 2026, 10:30`, in London. */
export function showDate(iso: string): string {
  const parts: Record<string, string> = {};
  for (const part of DATE.formatToParts(new Date(iso))) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return `${parts.day} ${parts.month} ${parts.year}, ${hour}:${parts.minute}`;
}

export { money, timeLeft };

/**
 * A countdown that starts from the server's seconds and falls only by elapsed page time; the
 * server's status is what decides anything.
 */
export class Countdown {
  private seconds = 0;
  private from = 0;

  reset(secondsRemaining: number): void {
    this.seconds = Math.max(0, Math.floor(secondsRemaining));
    this.from = performance.now();
  }

  left(): number {
    return Math.max(0, this.seconds - Math.floor((performance.now() - this.from) / 1000));
  }
}

/** The stylesheet's class for a paint band, which pairs the word with its colour and mark. */
export function bandClass(band: string): string {
  return `band-word band-${band.toLowerCase().replace(/\s+/g, '-')}`;
}
