import { kitchenDateOf } from '../shared/time.js';

/**
 * The single server clock. Every time-dependent rule reads it; no other code
 * consults the system time or the database's clock for a business decision.
 */
export class ServerClock {
  readonly #offsetMs: number;
  readonly #timeZone: string;

  constructor(timeZone: string, fixedNow: Date | null) {
    this.#timeZone = timeZone;
    this.#offsetMs = fixedNow === null ? 0 : fixedNow.getTime() - Date.now();
  }

  now(): Date {
    return new Date(Date.now() + this.#offsetMs);
  }

  /** The kitchen's today: the date in the kitchen's zone at the server's now. */
  today(): string {
    return kitchenDateOf(this.now(), this.#timeZone);
  }

  get timeZone(): string {
    return this.#timeZone;
  }
}
