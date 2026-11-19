/** The one app clock, and the only module that reads the system clock. Every domain decision and server time reads it. */

/** Wall-clock time for signing requests to storage, which checks it against its own clock. Never a domain decision. */
export const wallClock = (): Date => new Date();

/** A monotonic reading in milliseconds, for timeouts and polling deadlines. Never a domain decision. */
export const monotonicMs = (): number => Number(process.hrtime.bigint() / 1_000_000n);

export class AppClock {
  private readonly bootMs = monotonicMs();
  private readonly start: Date | null;

  constructor(start: Date | null) {
    this.start = start;
  }

  now(): Date {
    return this.start === null ? wallClock() : new Date(this.start.getTime() + (monotonicMs() - this.bootMs));
  }

  plusSeconds(from: Date, seconds: number): Date {
    return new Date(from.getTime() + seconds * 1000);
  }
}
