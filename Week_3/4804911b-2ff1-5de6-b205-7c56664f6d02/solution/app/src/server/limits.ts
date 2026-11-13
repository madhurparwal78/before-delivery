import { performance } from "node:perf_hooks";
import { waitMessage } from "../shared/copy.js";
import { ApiError } from "./errors.js";

// Limit windows run on real elapsed time, never on the test clock.
const WINDOW_MS = 60_000;

function rateLimited(retryAfter: number): ApiError {
  return new ApiError(429, "rate_limited", waitMessage(retryAfter), { retryAfter }, { "retry-after": String(retryAfter) });
}

const remaining = (start: number, now: number): number => Math.min(60, Math.max(1, Math.ceil((start + WINDOW_MS - now) / 1000)));

const lookups = new Map<string, { start: number; count: number }>();
const LOOKUP_LIMIT = 60;

/** Batch lookups and batch-shaped searches share one counter per client: the 61st in a window is refused. */
export function countLookup(ip: string): void {
  const now = performance.now();
  let entry = lookups.get(ip);
  if (!entry || now - entry.start >= WINDOW_MS) {
    entry = { start: now, count: 0 };
    lookups.set(ip, entry);
  }
  if (entry.count >= LOOKUP_LIMIT) throw rateLimited(remaining(entry.start, now));
  entry.count++;
}

const signins = new Map<string, { start: number; failed: number; inflight: number }>();
const SIGNIN_LIMIT = 5;

/** Reserves a place before the password is checked, so simultaneous wrong sign-ins cannot all slip through. */
export function beginSignIn(ip: string): (failed: boolean) => void {
  const now = performance.now();
  let entry = signins.get(ip);
  if (!entry || (now - entry.start >= WINDOW_MS && entry.inflight === 0)) {
    entry = { start: now, failed: 0, inflight: 0 };
    signins.set(ip, entry);
  }
  if (entry.failed + entry.inflight >= SIGNIN_LIMIT) throw rateLimited(remaining(entry.start, now));
  const held = entry;
  held.inflight++;
  return (failed) => {
    held.inflight--;
    if (failed) held.failed++;
  };
}
