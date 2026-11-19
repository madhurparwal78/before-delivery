import { config } from './config.js';

const started = Date.now();
const offsetFromReal = config.clockStart === null ? 0 : Date.parse(config.clockStart) - started;

if (config.clockStart !== null && Number.isNaN(offsetFromReal)) {
  throw new Error('Bad configuration: LOCKSET_CLOCK_START');
}

/** The server clock. Every time-dependent decision in Lockset reads this. */
export function now(): Date {
  return new Date(Date.now() + offsetFromReal);
}
