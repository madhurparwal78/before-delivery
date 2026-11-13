/**
 * The claim state machine. Every move the desk allows is decided here, and every control's
 * enabled state is read from the same table, so no screen can offer a move the server refuses.
 *
 *   started → confirmed → identified → quoted → (declined | dispatched) → closed
 *   erased can be reached from any state
 */

import { type ClaimState } from '../shared/claim-state';

export { CLAIM_STATES, isClaimState, type ClaimState } from '../shared/claim-state';

export const CLAIM_ACTIONS = [
  'confirm',
  'identify',
  'quote',
  'payment',
  'decline',
  'dispatch',
  'close',
  'share_link',
  'erase',
] as const;

export type ClaimAction = (typeof CLAIM_ACTIONS)[number];

/** What the state machine needs to know about a claim beyond its state. */
export interface ClaimStanding {
  state: ClaimState;
  paid: boolean;
}

export type ActionRefusal = 'wrong_state' | 'already_paid' | 'not_paid';

/**
 * The refusal code for a move, or null when the move is allowed. Quote covers both the
 * first quote and a re-quote, which is why payment is part of the standing.
 */
export function refuseAction(action: ClaimAction, standing: ClaimStanding): ActionRefusal | null {
  const { state, paid } = standing;
  switch (action) {
    case 'confirm':
      return state === 'started' ? null : 'wrong_state';
    case 'identify':
      return state === 'confirmed' ? null : 'wrong_state';
    case 'quote':
      if (state === 'identified') return null;
      if (state === 'quoted') return paid ? 'already_paid' : null;
      return 'wrong_state';
    case 'payment':
      if (state !== 'quoted') return 'wrong_state';
      return paid ? 'already_paid' : null;
    case 'decline':
      return state === 'quoted' ? null : 'wrong_state';
    case 'dispatch':
      if (state !== 'quoted') return 'wrong_state';
      return paid ? null : 'not_paid';
    case 'close':
      return state === 'declined' || state === 'dispatched' ? null : 'wrong_state';
    case 'share_link':
      return state === 'confirmed' ||
        state === 'identified' ||
        state === 'quoted' ||
        state === 'declined' ||
        state === 'dispatched'
        ? null
        : 'wrong_state';
    case 'erase':
      return state === 'erased' ? 'wrong_state' : null;
  }
}

export function allows(action: ClaimAction, standing: ClaimStanding): boolean {
  return refuseAction(action, standing) === null;
}

/** The state a successful move leaves the claim in, or null when the state does not move. */
export function stateAfter(action: ClaimAction, standing: ClaimStanding): ClaimState | null {
  switch (action) {
    case 'confirm':
      return 'confirmed';
    case 'identify':
      return 'identified';
    case 'quote':
      return 'quoted';
    case 'decline':
      return 'declined';
    case 'dispatch':
      return 'dispatched';
    case 'close':
      return 'closed';
    case 'erase':
      return 'erased';
    case 'payment':
    case 'share_link':
      return null;
  }
}
