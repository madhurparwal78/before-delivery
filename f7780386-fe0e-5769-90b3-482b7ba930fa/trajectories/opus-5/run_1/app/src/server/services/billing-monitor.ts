import type { BillingState } from '../../shared/api.js';
import type { KillBillClient } from './killbill.js';

/**
 * Tracks whether Kill Bill is reachable. Routes mark it down the moment a call
 * fails, and the background probe brings it back up.
 */
export class BillingMonitor {
  readonly #killBill: KillBillClient;
  #state: BillingState = 'up';

  constructor(killBill: KillBillClient) {
    this.#killBill = killBill;
  }

  get state(): BillingState {
    return this.#state;
  }

  markDown(): void {
    this.#state = 'down';
  }

  markUp(): void {
    this.#state = 'up';
  }

  async probe(): Promise<BillingState> {
    this.#state = (await this.#killBill.isReachable()) ? 'up' : 'down';
    return this.#state;
  }
}
