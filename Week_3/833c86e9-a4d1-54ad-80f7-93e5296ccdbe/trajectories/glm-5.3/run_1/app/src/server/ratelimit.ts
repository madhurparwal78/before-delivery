/** Per-minute counters keyed by a limit name and a subject. */
export class RateLimiter {
  private counts = new Map<string, { windowStart: number; count: number }>();

  constructor(private limit: number) {}

  /** Returns true when the request is allowed. */
  take(key: string, nowMs: number): boolean {
    const window = Math.floor(nowMs / 60000);
    const full = key + "|" + window;
    let entry = this.counts.get(full);
    if (!entry) {
      entry = { windowStart: window, count: 0 };
      this.counts.set(full, entry);
    }
    entry.count++;
    if (this.counts.size > 5000) {
      for (const [k, v] of this.counts) {
        if (window - v.windowStart >= 2) this.counts.delete(k);
      }
    }
    return entry.count <= this.limit;
  }

  retryAfter(nowMs: number): number {
    return Math.max(1, 60 - Math.floor((nowMs % 60000) / 1000));
  }
}

export function isApiError(x: unknown): x is import("./errors.js").ApiError {
  return typeof x === "object" && x !== null && "status" in x && "body" in x && !("handled" in x);
}
