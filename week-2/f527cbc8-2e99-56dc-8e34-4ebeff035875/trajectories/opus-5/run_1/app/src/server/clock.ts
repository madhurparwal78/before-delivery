import { config } from './config.js';

/**
 * The current instant for every rule in the app: this instance's clock shifted by
 * CLOCK_OFFSET_SECONDS. Durations stamped here are stored and honoured verbatim by
 * every other instance, so SQL is always handed this instant rather than using now().
 */
export function now(): Date {
  return new Date(Date.now() + config.clockOffsetSeconds * 1000);
}

export function plusSeconds(instant: Date, seconds: number): Date {
  return new Date(instant.getTime() + seconds * 1000);
}

/** Hold and offer expiries are rounded up to the whole second. */
export function plusSecondsCeil(instant: Date, seconds: number): Date {
  return new Date(Math.ceil((instant.getTime() + seconds * 1000) / 1000) * 1000);
}
