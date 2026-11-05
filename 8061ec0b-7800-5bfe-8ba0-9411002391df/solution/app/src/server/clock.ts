// The one server clock. With BELLROLL_CLOCK_START it reads that instant when the process starts and advances in
// real time; otherwise it is the system clock. Nothing else in the server reads the current moment.

import { config } from "./config.js";
import { storeDateOf } from "../shared/storeTime.js";

const offsetMs = config.clockStart === null ? 0 : config.clockStart.getTime() - Date.now();

/** The current moment, to the millisecond. */
export function now(): Date {
  return new Date(Date.now() + offsetMs);
}

/**
 * The machine's own time, for S3 request signing, which the storage service checks against its own clock.
 * Never used by a time rule: those read `now()`.
 */
export function protocolTime(): Date {
  return new Date(Date.now());
}

/** The current moment truncated to the second: every stored timestamp uses this. */
export function nowSecond(): Date {
  const moment = now();
  moment.setUTCMilliseconds(0);
  return moment;
}

/** The store's today (America/Chicago). */
export function storeToday(): string {
  return storeDateOf(now());
}

/** `server_now`: ISO 8601 UTC with milliseconds. */
export function serverNowStamp(): string {
  return now().toISOString();
}
