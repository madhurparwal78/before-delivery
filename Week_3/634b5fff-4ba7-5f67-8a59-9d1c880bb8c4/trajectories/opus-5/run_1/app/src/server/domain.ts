import { roundHalfUp } from '../shared/money.js';
import type { BoxState, PaymentMethod, PaymentState, PublicBoxState } from '../shared/types.js';

/** The edition's one price, in integer øre. */
export const price = {
  grossOre: 149500,
  netOre: 119600,
  vatOre: 29900,
  courierOre: 8900,
  totalOre: 158400,
} as const;

export interface Split {
  netOre: number;
  vatOre: number;
  charityOre: number;
  makerOre: number;
}

/** The sale split: charity is the box net at the locked rate, maker the rest. */
export function saleSplit(rateBasisPoints: number): Split {
  const charityOre = roundHalfUp(price.netOre * rateBasisPoints, 10000);
  return {
    netOre: price.netOre,
    vatOre: price.vatOre,
    charityOre,
    makerOre: price.netOre - charityOre,
  };
}

export interface Remainders {
  grossOre: number;
  netOre: number;
  vatOre: number;
  charityOre: number;
  makerOre: number;
}

/**
 * A refund of `amountOre` drawn on the box. No part exceeds its remainder; the
 * shaved øre moves to the part beside it, and the refund emptying the box takes
 * the exact remainder of every part.
 */
export function refundSplit(amountOre: number, rateBasisPoints: number, left: Remainders): Split {
  if (amountOre === left.grossOre) {
    return { netOre: left.netOre, vatOre: left.vatOre, charityOre: left.charityOre, makerOre: left.makerOre };
  }
  let netOre = roundHalfUp(amountOre * 100, 125);
  let vatOre = amountOre - netOre;
  if (netOre > left.netOre) {
    vatOre += netOre - left.netOre;
    netOre = left.netOre;
  }
  if (vatOre > left.vatOre) {
    netOre += vatOre - left.vatOre;
    vatOre = left.vatOre;
  }
  let charityOre = roundHalfUp(netOre * rateBasisPoints, 10000);
  let makerOre = netOre - charityOre;
  if (charityOre > left.charityOre) {
    makerOre += charityOre - left.charityOre;
    charityOre = left.charityOre;
  }
  if (makerOre > left.makerOre) {
    charityOre += makerOre - left.makerOre;
    makerOre = left.makerOre;
  }
  return { netOre, vatOre, charityOre, makerOre };
}

/** Gateway fees come only out of the maker's share and are never returned. */
export function gatewayFeeOre(method: PaymentMethod): number {
  return method === 'card' ? roundHalfUp(price.totalOre * 125, 10000) + 100 : 400;
}

const boxTransitions: Record<BoxState, BoxState[]> = {
  available: ['held'],
  held: ['claimed', 'awaiting_transfer', 'available'],
  awaiting_transfer: ['claimed', 'available'],
  claimed: ['packed', 'returned', 'available'],
  packed: ['shipped', 'returned'],
  shipped: ['returned'],
  returned: ['available'],
};

export function boxTransitionAllowed(from: BoxState, to: BoxState): boolean {
  return (boxTransitions[from] ?? []).includes(to);
}

/** The public sees `taken` for every state from `awaiting_transfer` on. */
export function publicBoxState(state: BoxState): PublicBoxState {
  if (state === 'available') return 'available';
  if (state === 'held') return 'held';
  return 'taken';
}

const paymentTransitions: Record<PaymentState, PaymentState[]> = {
  started: ['challenge', 'authorised', 'declined'],
  challenge: ['authorised', 'declined'],
  declined: ['started'],
  authorised: ['captured', 'voided', 'capture_failed', 'authorisation_expired'],
  capture_failed: ['captured', 'voided', 'authorisation_expired'],
  captured: ['partially_refunded', 'refunded'],
  partially_refunded: ['partially_refunded', 'refunded'],
  refunded: [],
  voided: [],
  authorisation_expired: [],
  pending: ['settled', 'lapsed'],
  settled: ['partially_refunded', 'refunded'],
  lapsed: [],
};

export function paymentTransitionAllowed(from: PaymentState, to: PaymentState): boolean {
  return (paymentTransitions[from] ?? []).includes(to);
}
