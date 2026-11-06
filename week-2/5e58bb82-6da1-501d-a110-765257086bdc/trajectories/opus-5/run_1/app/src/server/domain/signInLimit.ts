export interface AttemptRecord {
  fail_count: number;
  window_started_at: Date | null;
  locked_until: Date | null;
}

export interface AttemptDecision {
  /** True when this attempt must answer the 429 without checking the password. */
  locked: boolean;
  retryAt: Date | null;
  next: AttemptRecord;
}

export const MAX_FAILURES = 5;

/** Emails are compared after trimming spaces and lower-casing. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The one sign-in attempt-limit decision. It reads the stored record for an
 * address and returns both the answer for this attempt and the record to store,
 * so the caller can apply it atomically under a row lock.
 */
export function evaluateAttempt(
  record: AttemptRecord | null,
  now: Date,
  windowSeconds: number,
): AttemptDecision {
  const current: AttemptRecord = record ?? {
    fail_count: 0,
    window_started_at: null,
    locked_until: null,
  };

  if (current.locked_until && current.locked_until.getTime() > now.getTime()) {
    return { locked: true, retryAt: current.locked_until, next: current };
  }

  // A lock that has run out starts the count again from zero.
  if (current.locked_until && current.locked_until.getTime() <= now.getTime()) {
    return {
      locked: false,
      retryAt: null,
      next: { fail_count: 0, window_started_at: null, locked_until: null },
    };
  }

  const windowOpen =
    current.window_started_at !== null &&
    now.getTime() - current.window_started_at.getTime() < windowSeconds * 1000;
  if (!windowOpen) {
    return {
      locked: false,
      retryAt: null,
      next: { fail_count: 0, window_started_at: null, locked_until: null },
    };
  }
  return { locked: false, retryAt: null, next: current };
}

/** The record after a failure, locking the address on the fifth one in a window. */
export function recordFailure(
  record: AttemptRecord,
  now: Date,
  windowSeconds: number,
): AttemptRecord {
  const windowStart = record.window_started_at ?? now;
  const failCount = record.fail_count + 1;
  if (failCount >= MAX_FAILURES) {
    return {
      fail_count: failCount,
      window_started_at: windowStart,
      locked_until: new Date(now.getTime() + windowSeconds * 1000),
    };
  }
  return { fail_count: failCount, window_started_at: windowStart, locked_until: null };
}

/** `Retry-After` is the whole seconds until the unlock time, rounded up, at least 1. */
export function retryAfterSeconds(retryAt: Date, now: Date): number {
  return Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 1000));
}

export function tooManyAttemptsMessage(retryAt: Date): string {
  const hours = String(retryAt.getUTCHours()).padStart(2, '0');
  const minutes = String(retryAt.getUTCMinutes()).padStart(2, '0');
  return `Too many sign-in attempts. Try again after ${hours}:${minutes} UTC.`;
}

/** `retry_at` is ISO 8601 UTC with whole seconds. */
export function wholeSecondsIso(value: Date): string {
  return `${new Date(Math.floor(value.getTime() / 1000) * 1000).toISOString().slice(0, 19)}Z`;
}
