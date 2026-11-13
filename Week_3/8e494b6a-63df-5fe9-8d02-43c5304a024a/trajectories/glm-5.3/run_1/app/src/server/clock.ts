import { config } from "./config";

/**
 * The server clock. With grading it starts at 2026-03-01T00:00:00Z and stands still except
 * through the grading route; without grading it is the system clock.
 */
let offsetMs = 0;
let fixed = false;

const GRADING_START = Date.UTC(2026, 2, 1, 0, 0, 0, 0);

export function initClock(): void {
  if (config().grading) {
    fixed = true;
    offsetMs = GRADING_START - Date.now();
  }
}

export function nowMs(): number {
  if (fixed) return Date.now() + offsetMs;
  return Date.now();
}

export function nowIso(): string {
  return new Date(nowMs()).toISOString();
}

export function setClock(setMs?: number, advanceMs?: number): { now: string; now_ms: number } {
  if (setMs !== undefined) {
    offsetMs = setMs - Date.now();
  } else if (advanceMs !== undefined) {
    offsetMs += advanceMs;
  }
  const now = nowMs();
  return { now: new Date(now).toISOString(), now_ms: now };
}

/** The whole seconds left until the next server-clock minute, rounded up, at least 1. */
export function secondsToNextMinute(): number {
  const n = nowMs();
  const left = 60000 - (n % 60000);
  return Math.max(1, Math.ceil(left / 1000));
}

/** The fixed server-clock minute bucket for rate windows. */
export function minuteBucket(): number {
  return Math.floor(nowMs() / 60000);
}
