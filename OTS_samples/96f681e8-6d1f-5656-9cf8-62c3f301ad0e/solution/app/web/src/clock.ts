/**
 * The screen never trusts the device clock for anything the server decides. This keeps the server's time as the
 * last instant it told us plus the time elapsed on the monotonic clock since.
 */
let serverMs: number | null = null;
let measuredAt = 0;

export function setServerNow(iso: string): void {
  const parsed = Date.parse(iso);
  if (!Number.isNaN(parsed)) {
    serverMs = parsed;
    measuredAt = performance.now();
  }
}

/** The HTTP Date header has whole-second resolution; it only seeds the clock before an exact `server_now` arrives. */
export function syncServerClock(dateHeader: string | null): void {
  if (dateHeader && serverMs === null) setServerNow(new Date(dateHeader).toISOString());
}

export function serverNow(): number {
  return serverMs === null ? Date.now() : serverMs + (performance.now() - measuredAt);
}

/** Remaining time that was true at `receivedAt` on the monotonic clock. */
export interface Countdown {
  remainingMs: number;
  holdMs: number;
  receivedAt: number;
}

export function countdownFrom(remainingMs: number, createdAt: string, expiresAt: string): Countdown {
  return { remainingMs, holdMs: Date.parse(expiresAt) - Date.parse(createdAt), receivedAt: performance.now() };
}

export function remainingNow(countdown: Countdown): number {
  return Math.max(0, countdown.remainingMs - (performance.now() - countdown.receivedAt));
}

/** mm:ss, rounded up to the next whole second. */
export function mmss(ms: number): string {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
