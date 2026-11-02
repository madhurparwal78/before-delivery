import type { CertificationState } from '../../shared/domain.ts';
import { errors } from '../http/errors.ts';

export type CertificationMove = 'verify' | 'deprecate' | 'reinstate';

const TARGET_STATE: Record<CertificationMove, CertificationState> = {
  verify: 'verified',
  deprecate: 'deprecated',
  reinstate: 'draft',
};

const ALLOWED_FROM: Record<CertificationMove, readonly CertificationState[]> = {
  verify: ['draft'],
  deprecate: ['draft', 'verified'],
  reinstate: ['deprecated'],
};

/** Certification moves only along the published state machine. */
export function assertTransition(
  assetId: string,
  from: CertificationState,
  move: CertificationMove,
): CertificationState {
  if (!ALLOWED_FROM[move].includes(from)) {
    throw errors.invalidTransition(assetId, from, TARGET_STATE[move]);
  }
  return TARGET_STATE[move];
}
