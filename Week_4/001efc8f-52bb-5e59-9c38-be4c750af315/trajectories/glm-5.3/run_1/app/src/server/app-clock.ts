/** The app clock: the host's current time plus APP_CLOCK_OFFSET_SECONDS, read once at start. */
export class AppClock {
  private readonly start: number;
  private readonly startAt: number;

  constructor(offsetSeconds: number) {
    this.startAt = Date.now();
    this.start = this.startAt + offsetSeconds * 1000;
  }

  now(): Date {
    return new Date(this.start + (Date.now() - this.startAt));
  }

  nowMs(): number {
    return this.start + (Date.now() - this.startAt);
  }
}
