/** The one app clock. Nothing else reads the system clock to make a domain decision. */

import { config } from './config';

const startedAtMonotonic = process.hrtime.bigint();
const startedAtEpochMs = config.appClockStart ? Date.parse(config.appClockStart) : null;

if (config.appClockStart !== null && (startedAtEpochMs === null || Number.isNaN(startedAtEpochMs))) {
  throw new Error('APP_CLOCK_START must be an ISO 8601 instant');
}

export function nowMs(): number {
  if (startedAtEpochMs === null) return Date.now();
  const elapsedMs = Number(process.hrtime.bigint() - startedAtMonotonic) / 1e6;
  return startedAtEpochMs + elapsedMs;
}

export function now(): Date {
  return new Date(Math.floor(nowMs()));
}

export function plusSeconds(instant: Date, seconds: number): Date {
  return new Date(instant.getTime() + seconds * 1000);
}
