/**
 * The server's kitchen clock. Every time-dependent thing on screen reads from
 * here, so a wrong device clock or time zone never changes what is shown. Only
 * elapsed time is taken from the device, never the wall clock.
 */

let syncedServerMs = 0;
let syncedElapsed = 0;
export function syncServerNow(iso: string): void {
  syncedServerMs = Date.parse(iso);
  syncedElapsed = performance.now();
}

/** The server's instant now, advanced by the time elapsed since the last response. */
export function serverNow(): number {
  return syncedServerMs + (performance.now() - syncedElapsed);
}
