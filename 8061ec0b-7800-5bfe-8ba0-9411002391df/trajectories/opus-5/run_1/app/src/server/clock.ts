import { config } from './config';
import { storeDateOf } from '../shared/time';

const processStart = Date.now();
const startInstant = config.clockStart === undefined ? null : Date.parse(config.clockStart);

if (startInstant !== null && Number.isNaN(startInstant)) {
  throw new Error('BELLROLL_CLOCK_START must be an ISO 8601 UTC instant');
}

/** The one server clock every time rule reads. */
export function now(): Date {
  if (startInstant === null) return new Date();
  return new Date(startInstant + (Date.now() - processStart));
}

/** The store's today: the clock's date in the store's time zone. */
export function storeToday(): string {
  return storeDateOf(now());
}
