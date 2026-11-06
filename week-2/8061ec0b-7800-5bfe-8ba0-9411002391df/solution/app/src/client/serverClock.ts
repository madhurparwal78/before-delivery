// The one browser estimate of the server clock: the latest `server_now` plus the time elapsed since that answer
// arrived, measured with the elapsed-time counter, which a wrong or frozen device date does not affect.

let serverAtArrival = Number.NaN;
let arrivedAt = 0;

/** Records the server's time from an answer that has just arrived. */
export function observeServerNow(stamp: string): void {
  serverAtArrival = Date.parse(stamp);
  arrivedAt = performance.now();
}

function serverNow(): number {
  return serverAtArrival + (performance.now() - arrivedAt);
}

/** True once `instant` has passed on the server's clock (with a small margin so a surface never changes early). */
export function hasPassed(instant: string): boolean {
  return serverNow() >= Date.parse(instant) + 150;
}

/** Pages that judge time from the server ask it again at least this often while open. */
export const SERVER_CLOCK_REFRESH_MS = 60_000;
