import type { FiringStatus, PieceStatus, Plan, Stage } from '../../shared/types';

/**
 * A placed piece wears its firing's heat. Everything else shows its stored
 * status. The one place a piece's shown status is decided.
 */
export function effectivePieceStatus(
  stored: PieceStatus,
  firingStatus: FiringStatus | null,
): PieceStatus {
  if (stored !== 'loaded' || firingStatus === null) return stored;
  switch (firingStatus) {
    case 'building':
      return 'loaded';
    case 'firing':
      return 'firing';
    case 'cooling':
      return 'cooling';
    case 'unloadable':
      return 'unloadable';
    case 'unloaded':
      return 'loaded';
  }
}

export interface UnloadOutcome {
  status: Extract<PieceStatus, 'queued' | 'ready'>;
  stage: Stage | null;
}

/** What a piece becomes when its firing is unloaded. */
export function unloadOutcome(plan: Plan, stage: Stage | null): UnloadOutcome {
  if (plan === 'bisque_and_glaze' && stage === 'bisque') {
    return { status: 'queued', stage: 'glaze' };
  }
  return { status: 'ready', stage: null };
}

export function canCollect(status: PieceStatus): boolean {
  return status === 'ready' || status === 'uncollected';
}
