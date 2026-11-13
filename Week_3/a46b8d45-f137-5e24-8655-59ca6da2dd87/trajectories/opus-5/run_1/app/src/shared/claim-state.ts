/** The claim states. The moves between them are decided in `domain/state.ts`. */

export const CLAIM_STATES = [
  'started',
  'confirmed',
  'identified',
  'quoted',
  'declined',
  'dispatched',
  'closed',
  'erased',
] as const;

export type ClaimState = (typeof CLAIM_STATES)[number];

export function isClaimState(value: unknown): value is ClaimState {
  return typeof value === 'string' && (CLAIM_STATES as readonly string[]).includes(value);
}
