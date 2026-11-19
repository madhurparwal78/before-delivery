import type { Settings } from './config.js';

/**
 * The office's server clock. When `LOCKSET_CLOCK_START` is set the clock starts
 * at that instant when the process starts and then runs forward in real time;
 * otherwise the clock is the real time.
 */
export class ServerClock {
  private readonly baseInstant: number;
  private readonly baseMonotonic: number;

  constructor(private readonly settings: Settings) {
    this.baseInstant = settings.clockStart ? settings.clockStart.getTime() : Date.now();
    this.baseMonotonic = performance.now();
  }

  now(): Date {
    const elapsed = performance.now() - this.baseMonotonic;
    return new Date(this.baseInstant + elapsed);
  }

  nowMs(): number {
    const elapsed = performance.now() - this.baseMonotonic;
    return this.baseInstant + elapsed;
  }
}
