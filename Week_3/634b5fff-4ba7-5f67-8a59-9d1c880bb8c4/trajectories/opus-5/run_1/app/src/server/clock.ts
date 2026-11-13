import { config } from './config.js';
import { EDITION_CLOSES_AT } from './copenhagen.js';

const bootRealMs = Date.now();
const businessOffsetMs =
  config.clockStart === null ? 0 : new Date(config.clockStart).getTime() - bootRealMs;

/**
 * The business clock: real time, or the configured start running at normal
 * speed from boot. It decides rates, deadlines, months and recorded stamps.
 */
export function businessNow(): Date {
  return new Date(Date.now() + businessOffsetMs);
}

/** The real clock: hold, challenge and authorisation lengths, and staleness. */
export function realNow(): Date {
  return new Date();
}

export function editionClosed(): boolean {
  return businessNow().getTime() >= EDITION_CLOSES_AT.getTime();
}
