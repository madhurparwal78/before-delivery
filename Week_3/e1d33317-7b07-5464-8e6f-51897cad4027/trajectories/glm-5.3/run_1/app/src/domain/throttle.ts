import { THROTTLE_MAX, THROTTLE_WINDOW_MS } from './values.js';

export interface ThrottleState {
  count: number;
  windowStart: number;
}

/**
 * The one place that decides the per-collaborator operation throttle.
 * Windows start every 10 seconds on the server clock; at most 120
 * operations may be accepted in a window. Refused batches do not count.
 */
export class OpThrottle {
  private states = new Map<string, ThrottleState>();

  /**
   * Returns the remaining allowance after accepting `size` operations, or
   * null when the batch would take the count over the limit.
   */
  check(site: string, size: number, now: number): { allowed: false; retryAfterSeconds: number } | { allowed: true } {
    const state = this.stateFor(site, now);
    if (state.count + size > THROTTLE_MAX) {
      return { allowed: false, retryAfterSeconds: secondsUntilWindowEnd(now) };
    }
    return { allowed: true };
  }

  /** Records that a batch was accepted. */
  accept(site: string, size: number, now: number): void {
    const state = this.stateFor(site, now);
    state.count += size;
  }

  private stateFor(site: string, now: number): ThrottleState {
    const existing = this.states.get(site);
    const window = windowStartOf(now);
    if (!existing || existing.windowStart !== window) {
      const fresh: ThrottleState = { count: 0, windowStart: window };
      this.states.set(site, fresh);
      return fresh;
    }
    return existing;
  }
}

function windowStartOf(now: number): number {
  return Math.floor(now / THROTTLE_WINDOW_MS) * THROTTLE_WINDOW_MS;
}

function secondsUntilWindowEnd(now: number): number {
  const elapsed = now - windowStartOf(now);
  return Math.max(1, Math.ceil((THROTTLE_WINDOW_MS - elapsed) / 1000));
}
