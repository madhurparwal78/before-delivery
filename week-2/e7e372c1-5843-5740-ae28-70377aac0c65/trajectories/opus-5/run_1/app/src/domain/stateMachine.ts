/**
 * The restatement state machine, its version check, the two-person rule and the
 * close-wins rule for withdraws. Every endpoint and timer calls these.
 */
import { RestatementState } from '../shared/labels';

export type StaffRole = 'treasury_analyst' | 'disclosure_counsel' | 'disclosure_officer' | 'operator';

export type RestatementAction =
  | 'edit'
  | 'upload_exhibit'
  | 'submit'
  | 'return'
  | 'clear'
  | 'release'
  | 'withdraw'
  | 'publish'
  | 'supersede';

const ALLOWED_FROM: Readonly<Record<RestatementAction, readonly RestatementState[]>> = {
  edit: ['draft', 'returned'],
  upload_exhibit: ['draft', 'returned'],
  submit: ['draft', 'returned'],
  return: ['in_review'],
  clear: ['in_review'],
  release: ['cleared'],
  withdraw: ['queued'],
  publish: ['cleared', 'queued'],
  supersede: ['published'],
};

export function isTransitionAllowed(action: RestatementAction, state: RestatementState): boolean {
  return ALLOWED_FROM[action].includes(state);
}

export type AuthorisationFailure =
  | 'forbidden'
  | 'not_preparer'
  | 'preparer_cannot_clear'
  | 'preparer_cannot_release'
  | 'clearer_cannot_release';

export interface ActorContext {
  userId: string;
  roles: readonly StaffRole[];
}

export interface RestatementParties {
  preparedBy: string;
  clearedBy: string | null;
}

const REQUIRED_ROLE: Readonly<Record<RestatementAction, StaffRole | null>> = {
  edit: 'treasury_analyst',
  upload_exhibit: 'treasury_analyst',
  submit: 'treasury_analyst',
  return: 'disclosure_counsel',
  clear: 'disclosure_counsel',
  release: 'disclosure_officer',
  withdraw: 'disclosure_officer',
  publish: null,
  supersede: null,
};

/** Role first, then preparer, then clearer. */
export function authoriseAction(
  action: RestatementAction,
  actor: ActorContext,
  parties: RestatementParties,
): AuthorisationFailure | null {
  const role = REQUIRED_ROLE[action];
  if (role !== null && !actor.roles.includes(role)) return 'forbidden';
  switch (action) {
    case 'edit':
    case 'upload_exhibit':
    case 'submit':
      return actor.userId === parties.preparedBy ? null : 'not_preparer';
    case 'return':
    case 'clear':
      return actor.userId === parties.preparedBy ? 'preparer_cannot_clear' : null;
    case 'release':
      if (actor.userId === parties.preparedBy) return 'preparer_cannot_release';
      if (parties.clearedBy !== null && actor.userId === parties.clearedBy) {
        return 'clearer_cannot_release';
      }
      return null;
    case 'withdraw':
      return actor.userId === parties.preparedBy ? 'preparer_cannot_release' : null;
    case 'publish':
    case 'supersede':
      return null;
  }
}

export function authoriseCreate(actor: ActorContext): AuthorisationFailure | null {
  return actor.roles.includes('treasury_analyst') ? null : 'forbidden';
}

export function versionMatches(stored: number, carried: number): boolean {
  return stored === carried;
}

/** A withdraw succeeds only strictly before the queued release instant. */
export function withdrawBeatsClose(releaseAtMs: number, marketClockMs: number): boolean {
  return marketClockMs < releaseAtMs;
}

export const OPEN_STATES: readonly RestatementState[] = [
  'draft',
  'in_review',
  'returned',
  'cleared',
  'queued',
];
