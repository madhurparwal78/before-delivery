// Offers: the lapse rule, the transition table and the shape the product shows.

import { config } from '../config.js';
import { query, type Row, type Transaction } from '../db/pool.js';
import { fail } from '../http/errors.js';

type OfferStatus = 'open' | 'needs_reread' | 'accepted' | 'declined' | 'lapsed' | 'closed_by_acceptance';

export interface OfferRow extends Row {
  id: string;
  car_id: string;
  link_id: string;
  amount_pounds: number;
  status: OfferStatus;
  stamped_at: Date;
  lapses_at: Date;
}

interface OfferJson {
  id: string;
  amountPounds: number;
  status: OfferStatus;
  stampedAt: string;
  lapsesAt: string;
  secondsRemaining: number;
}

/**
 * A live offer, for the queries that count, close or re-read them: `open` or `needs_reread` and
 * not yet lapsed on the server's clock. The same rule `effectiveStatus` applies to a loaded row,
 * written once here so no query can forget the lapse.
 */
export const LIVE_OFFER = "status IN ('open','needs_reread') AND lapses_at > now()";

/** The offers the background pass turns into `lapsed`: live by status, past their instant. */
export const LAPSED_OFFER = "status IN ('open','needs_reread') AND lapses_at <= now()";

/** An offer lapses at the exact instant, whether or not the background pass has run yet. */
export function effectiveStatus(offer: OfferRow, now = new Date()): OfferStatus {
  const live = offer.status === 'open' || offer.status === 'needs_reread';
  if (live && offer.lapses_at.getTime() <= now.getTime()) return 'lapsed';
  return offer.status;
}

export function offerJson(offer: OfferRow, now = new Date()): OfferJson {
  const status = effectiveStatus(offer, now);
  const live = status === 'open' || status === 'needs_reread';
  return {
    id: offer.id,
    amountPounds: offer.amount_pounds,
    status,
    stampedAt: offer.stamped_at.toISOString(),
    lapsesAt: offer.lapses_at.toISOString(),
    secondsRemaining: live ? Math.max(0, Math.floor((offer.lapses_at.getTime() - now.getTime()) / 1000)) : 0,
  };
}

export function lapsesAt(stampedAt: Date): Date {
  return new Date(stampedAt.getTime() + config.offerLapseSeconds * 1000);
}

export async function offersOfCar(carId: string): Promise<OfferRow[]> {
  return query<OfferRow>('SELECT * FROM offer WHERE car_id = $1 ORDER BY stamped_at ASC', [carId]);
}

/** The refusal for an owner move on an offer that is not open. */
export function refuseMove(status: OfferStatus): never {
  if (status === 'lapsed') fail(409, 'offer_lapsed', 'This offer has lapsed.');
  if (status === 'needs_reread') fail(409, 'offer_needs_reread', 'This offer is waiting for a re-read.');
  fail(409, 'offer_not_open', 'This offer is no longer open.');
}

/**
 * An amendment moves a live offer to needs_reread when its buyer now has a material finding
 * unseen, and back to open once they have seen them all again.
 */
export async function settleRereadState(
  tx: Transaction,
  offerId: string,
  materialUnseen: number,
): Promise<void> {
  if (materialUnseen > 0) {
    await tx.query("UPDATE offer SET status = 'needs_reread' WHERE id = $1 AND status = 'open'", [offerId]);
  } else {
    await tx.query("UPDATE offer SET status = 'open' WHERE id = $1 AND status = 'needs_reread'", [offerId]);
  }
}
