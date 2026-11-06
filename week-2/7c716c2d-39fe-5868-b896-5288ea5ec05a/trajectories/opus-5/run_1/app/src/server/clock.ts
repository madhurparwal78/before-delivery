import { config } from './config.js';

const processStart = Date.now();
const shift = config.serverClockStart === undefined ? 0 : Date.parse(config.serverClockStart) - processStart;

if (config.serverClockStart !== undefined && Number.isNaN(shift)) {
  throw new Error('Invalid SERVER_CLOCK_START');
}

/** The server's now: the only source of dates, instants and expiries. */
export function now(): number {
  return Date.now() + shift;
}

export function nowDate(): Date {
  return new Date(now());
}
