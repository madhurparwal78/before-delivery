// The listing's state machine. Every move is decided here.

import { fail } from '../http/errors.js';
import type { ListingStatus } from './state.js';

const LEGAL: ReadonlyArray<readonly [ListingStatus, ListingStatus]> = [
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

function canMove(from: ListingStatus, to: ListingStatus): boolean {
  return LEGAL.some(([a, b]) => a === from && b === to);
}

export function requireMove(from: ListingStatus, to: ListingStatus): void {
  if (!canMove(from, to)) fail(409, 'illegal_transition', `A ${from} listing cannot become ${to}.`);
}

/** Findings, readings, advisory responses and slots change only in draft or live. */
export function requireOpenForEditing(status: ListingStatus): void {
  if (status !== 'draft' && status !== 'live') {
    fail(409, 'listing_closed', 'This car is not taking changes right now.');
  }
}

/** Claims and offers are refused unless the listing is live. */
export function requireLive(status: ListingStatus): void {
  if (status !== 'live') fail(409, 'listing_closed', 'This car is not taking viewings or offers right now.');
}
