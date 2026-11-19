import { limits } from '../config.ts';
import type { EventType, OfferStatus, Party } from '../../shared/types.ts';

/**
 * Offer status, version and response-window rules. Every statement about how an
 * offer may change lives here.
 */

/** Statuses in which a response window runs. */
export function windowRuns(status: OfferStatus): boolean {
  return status === 'sent' || status === 'countered';
}

/** Statuses an offer may still be expired from. */
export function canExpire(status: OfferStatus): boolean {
  return windowRuns(status);
}

/** Terminal statuses: nothing further may be commanded. */
export function isExpired(status: OfferStatus): boolean {
  return status === 'expired';
}

/** A replacement by a party returns the offer to that party's live status. */
export function statusAfterChangeBy(party: Party): OfferStatus {
  return party === 'dealer' ? 'sent' : 'countered';
}

/** The window a change by this party opens, in seconds. */
export function windowSecondsFor(party: Party): number {
  return party === 'dealer' ? limits.offerWindowS : limits.counterWindowS;
}

/**
 * The three groups of effects on an offer's version and acceptances.
 *
 * - `bump_and_clear`: bumps the version and clears both acceptances.
 * - `bump_only`: bumps the version and keeps both acceptances.
 * - `neither`: never touches the offer version or its acceptances.
 */
export type VersionEffect = 'bump_and_clear' | 'bump_only' | 'neither';

const BUMP_AND_CLEAR: ReadonlySet<EventType> = new Set([
  'offer.sent',
  'offer.replaced',
  'specimen.reconciled',
  'annotation.saved',
]);

const BUMP_ONLY: ReadonlySet<EventType> = new Set([
  'receipt.recorded',
  'dispute.opened',
  'resolution.approved',
  'ownership.transferred',
  'offer.returned',
]);

/**
 * `manifest.frozen` bumps the offer only when it makes the offer `dispatched`;
 * a freeze that leaves the other manifest unfrozen bumps only its manifest.
 */
export function versionEffectOf(
  type: EventType,
  context: { becomesDispatched?: boolean } = {},
): VersionEffect {
  if (type === 'manifest.frozen') {
    return context.becomesDispatched ? 'bump_only' : 'neither';
  }
  if (BUMP_AND_CLEAR.has(type)) return 'bump_and_clear';
  if (BUMP_ONLY.has(type)) return 'bump_only';
  return 'neither';
}

/**
 * A change to an included specimen only voids acceptances while the offer is
 * live, that is `sent`, `countered` or `accepted`.
 */
export function specimenChangeVoidsAcceptances(status: OfferStatus): boolean {
  return status === 'sent' || status === 'countered' || status === 'accepted';
}

export interface WindowView {
  expires_at: string | null;
  remaining_seconds: number | null;
  closing: boolean;
}

/**
 * The window the browser is shown. In `draft`, and from `accepted` onwards,
 * there is no window at all, so an accepted offer never expires and never makes
 * the closing pill show. An `expired` offer keeps the moment it expired at.
 */
export function windowView(
  status: OfferStatus,
  expiresAt: Date | null,
  now: Date,
): WindowView {
  if (status === 'expired') {
    return {
      expires_at: expiresAt ? expiresAt.toISOString() : null,
      remaining_seconds: 0,
      closing: false,
    };
  }
  if (!windowRuns(status) || !expiresAt) {
    return { expires_at: null, remaining_seconds: null, closing: false };
  }
  const remaining = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
  return {
    expires_at: expiresAt.toISOString(),
    remaining_seconds: remaining,
    closing: remaining <= limits.closingS,
  };
}

/** Expiry is decided on the namespace clock whenever an offer is read or written. */
export function hasLapsed(status: OfferStatus, expiresAt: Date | null, now: Date): boolean {
  return canExpire(status) && expiresAt !== null && expiresAt.getTime() <= now.getTime();
}

/** Statuses counted as open offers by the corner block and the exchange chip. */
export function isOpenOffer(status: OfferStatus): boolean {
  return status === 'sent' || status === 'countered' || status === 'accepted';
}

/** Statuses counted as awaiting receipt. */
export function isAwaitingReceipt(status: OfferStatus): boolean {
  return status === 'dispatched' || status === 'received';
}

/** Items of an offer are reserved while it is live. */
export function reservesItems(status: OfferStatus): boolean {
  return (
    status === 'sent' ||
    status === 'countered' ||
    status === 'accepted' ||
    status === 'dispatched' ||
    status === 'received' ||
    status === 'disputed'
  );
}

/** Items become outbound once the offer is accepted and until it settles. */
export function itemsAreOutbound(status: OfferStatus): boolean {
  return (
    status === 'accepted' ||
    status === 'dispatched' ||
    status === 'received' ||
    status === 'disputed'
  );
}

/** A dispute may be opened on an offer in these statuses. */
export function canOpenDispute(status: OfferStatus): boolean {
  return status === 'dispatched' || status === 'received';
}

/** Freezing a manifest needs the offer to be accepted. */
export function canFreeze(status: OfferStatus): boolean {
  return status === 'accepted';
}

/** The basket side a party owns. */
export function basketOf(party: Party): 'dealer_items' | 'counterpart_items' {
  return party === 'dealer' ? 'dealer_items' : 'counterpart_items';
}

export const otherParty = (party: Party): Party =>
  party === 'dealer' ? 'counterpart' : 'dealer';

/** Each basket side holds 1 to FLAN_OFFER_MAX_ITEMS specimens, inclusive. */
export type BasketProblem = 'empty' | 'full' | null;

export function basketProblem(items: string[]): BasketProblem {
  if (items.length === 0) return 'empty';
  if (items.length > limits.offerMaxItems) return 'full';
  return null;
}
