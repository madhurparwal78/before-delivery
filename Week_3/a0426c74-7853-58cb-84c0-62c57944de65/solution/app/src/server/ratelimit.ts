import { clock } from './clock.ts';

const WINDOW_MS = 60000;
/** Past this many keys, keys with no hit in the last minute are forgotten, so a flood of different usernames cannot grow the map forever. */
const SWEEP_ABOVE_KEYS = 10000;

interface Hit { at: number; count: number }

/** Counts hits per key over the last minute of the server clock (login attempts per username, operations per person). */
export class RateLimiter {
  private readonly hits = new Map<string, Hit[]>();

  constructor(private readonly limit: number) {}

  /** Records `count` hits for `key` unless that would pass the limit; says whether they were recorded. */
  take(key: string, count = 1): boolean {
    const now = clock.now();
    if (this.hits.size > SWEEP_ABOVE_KEYS) this.forgetIdle(now);
    const recent = (this.hits.get(key) ?? []).filter((hit) => hit.at > now - WINDOW_MS);
    const total = recent.reduce((sum, hit) => sum + hit.count, 0);
    if (total + count > this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push({ at: now, count });
    this.hits.set(key, recent);
    return true;
  }

  private forgetIdle(now: number): void {
    for (const [key, hits] of this.hits) {
      if (hits.every((hit) => hit.at <= now - WINDOW_MS)) this.hits.delete(key);
    }
  }
}
