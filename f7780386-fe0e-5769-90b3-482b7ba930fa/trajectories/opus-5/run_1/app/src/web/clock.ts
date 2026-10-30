/**
 * The browser reads time from the server's `now`, kept as an offset measured
 * at each fetch. It never uses the browser clock or zone for a decision.
 */

let serverNowMs = Date.now();
let measuredAtMs = Date.now();
let kitchenMinutesAtFetch = 0;

function kitchenMinutesFromIso(iso: string): number {
  const match = /T(\d{2}):(\d{2})/.exec(iso);
  if (match === null) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function syncServerNow(iso: string): void {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return;
  serverNowMs = parsed;
  measuredAtMs = Date.now();
  kitchenMinutesAtFetch = kitchenMinutesFromIso(iso);
}

function elapsedMs(): number {
  return Date.now() - measuredAtMs;
}

export function serverNow(): number {
  return serverNowMs + elapsedMs();
}

/** Minutes since kitchen midnight, carried forward from the last fetch. */
export function kitchenNowMinutes(): number {
  return kitchenMinutesAtFetch + elapsedMs() / 60000;
}

/** Whole seconds left before an instant, never below zero. */
export function secondsUntil(iso: string): number {
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return 0;
  return Math.max(0, Math.ceil((target - serverNow()) / 1000));
}

export function hasPassed(iso: string): boolean {
  const target = Date.parse(iso);
  return !Number.isNaN(target) && serverNow() >= target;
}

export function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
