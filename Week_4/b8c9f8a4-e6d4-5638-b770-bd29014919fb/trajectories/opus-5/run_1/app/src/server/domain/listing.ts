import type { ListingStatus } from '../../shared/types';

const LEGAL: readonly (readonly [ListingStatus, ListingStatus])[] = [
  ['draft', 'rendering'],
  ['live', 'rendering'],
  ['rendering', 'live'],
  ['rendering', 'draft'],
  ['live', 'under_offer'],
  ['under_offer', 'sold'],
  ['draft', 'withdrawn'],
  ['live', 'withdrawn'],
  ['under_offer', 'withdrawn'],
];

export const isLegalTransition = (from: ListingStatus, to: ListingStatus): boolean =>
  LEGAL.some(([a, b]) => a === from && b === to);

/** Findings, readings, advisory responses and slots can be changed only in draft or live. */
export const acceptsCarChanges = (status: ListingStatus): boolean => status === 'draft' || status === 'live';

/** Viewings and offers are taken only while the listing is live. */
export const acceptsOffersAndClaims = (status: ListingStatus): boolean => status === 'live';

/** Publish blockers are only reported for a car that could still be published. */
export const reportsBlockers = (status: ListingStatus): boolean => status === 'draft' || status === 'live';
