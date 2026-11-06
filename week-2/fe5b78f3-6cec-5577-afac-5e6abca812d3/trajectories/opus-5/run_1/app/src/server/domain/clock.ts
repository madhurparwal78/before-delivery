import { istMidnight } from './ist';

/**
 * The business clock. It reads the real time unless RAIL_CLOCK_START is set, in which case it
 * starts there and advances `rate` business seconds per real second.
 */
export class BusinessClock {
  private readonly originReal: number;
  private readonly originBusiness: number;

  constructor(start: string | null, readonly rate: number) {
    this.originReal = Date.now();
    this.originBusiness = start === null ? this.originReal : parseIstTimestamp(start);
  }

  now(): number {
    if (this.rate === 1 && this.originBusiness === this.originReal) return Date.now();
    return this.originBusiness + (Date.now() - this.originReal) * this.rate;
  }
}

/** Parses an IST timestamp such as `2026-12-01T11:00:00+05:30` or `2026-12-01 11:00`. */
export function parseIstTimestamp(value: string): number {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value.trim());
  if (match === null) throw new Error(`RAIL_CLOCK_START is not an IST timestamp: ${value}`);
  const [, date, hour, minute, second] = match;
  return istMidnight(date)
    + Number.parseInt(hour, 10) * 3_600_000
    + Number.parseInt(minute, 10) * 60_000
    + (second === undefined ? 0 : Number.parseInt(second, 10)) * 1_000;
}
