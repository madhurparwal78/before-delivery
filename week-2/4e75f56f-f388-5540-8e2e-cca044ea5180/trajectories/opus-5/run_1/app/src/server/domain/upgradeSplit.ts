import { PRICES, UPGRADE_DIFFERENCE_CENTS } from '../../shared/prices.js';
import type { ReservationState } from './reservationState.js';
import { RESERVE_BY_DATE } from './venue.js';

export interface UpgradeSplit {
  readonly chargeNowCents: number;
  readonly paidAfterCents: number;
  readonly balanceAfterCents: number;
}

/**
 * The part of the 245000 cent Atelier difference charged now, decided by the
 * seat's state and the venue-local date of the upgrade.
 */
export function upgradeSplit(
  state: Extract<ReservationState, 'deposit_paid' | 'paid_in_full'>,
  onVenueDate: string,
): UpgradeSplit {
  if (state === 'paid_in_full') {
    return {
      chargeNowCents: UPGRADE_DIFFERENCE_CENTS,
      paidAfterCents: PRICES.atelier.fullCents,
      balanceAfterCents: 0,
    };
  }
  if (onVenueDate <= RESERVE_BY_DATE) {
    const chargeNowCents = PRICES.atelier.depositCents - PRICES.bench.depositCents;
    return {
      chargeNowCents,
      paidAfterCents: PRICES.atelier.depositCents,
      balanceAfterCents: PRICES.atelier.balanceCents,
    };
  }
  return {
    chargeNowCents: UPGRADE_DIFFERENCE_CENTS,
    paidAfterCents: PRICES.bench.depositCents + UPGRADE_DIFFERENCE_CENTS,
    balanceAfterCents: PRICES.atelier.fullCents - PRICES.bench.depositCents - UPGRADE_DIFFERENCE_CENTS,
  };
}
