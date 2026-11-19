/** Sliding-window limiter on real time: `limit` hits per key per window. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private sweeps = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60000,
  ) {}

  /** Counts a hit. Returns null when allowed, else the whole seconds to wait. */
  hit(key: string, nowMs = Date.now()): number | null {
    const recent = (this.hits.get(key) ?? []).filter((at) => nowMs - at < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return Math.max(1, Math.ceil(((recent[0] ?? nowMs) + this.windowMs - nowMs) / 1000));
    }
    recent.push(nowMs);
    this.hits.set(key, recent);
    if (++this.sweeps % 1000 === 0) this.sweep(nowMs);
    return null;
  }

  private sweep(nowMs: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((at) => nowMs - at >= this.windowMs)) this.hits.delete(key);
    }
  }
}
