import { kolkataToday, kolkataYear, type IsoDate } from '../../shared/domain.js';

/**
 * Server time. The test clock exists only when `INTERVAL_TEST_CLOCK` is `on`,
 * and replaces server time for every date and state decision. Real elapsed time
 * (link lifetimes, limit windows, provider timeouts) always runs on the
 * monotonic/wall clock, never the test clock.
 */
export class Clock {
  private testNow: Date | null = null;

  constructor(private enabled: boolean) {}

  get testClockEnabled(): boolean {
    return this.enabled;
  }

  setTest(now: Date): void {
    if (!this.enabled) throw new Error('test clock disabled');
    this.testNow = now;
  }

  clearTest(): void {
    if (!this.enabled) throw new Error('test clock disabled');
    this.testNow = null;
  }

  /** The instant the domain reads: test time when set, else real time. */
  now(): Date {
    return this.testNow ?? new Date();
  }

  today(): IsoDate {
    return kolkataToday(this.now());
  }

  year(): number {
    return kolkataYear(this.now());
  }
}
