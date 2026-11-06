import { config } from './config.ts';

const bootRealMs = Date.now();
const startMs = config.clockStart === '' ? bootRealMs : Date.parse(config.clockStart);
const offsetMs = Number.isFinite(startMs) ? startMs - bootRealMs : 0;

/** The app clock: `APP_CLOCK_START` plus elapsed real time, or the system clock. */
export function now(): Date {
  return new Date(Date.now() + offsetMs);
}
