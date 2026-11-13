import type { PromotionState, StageStatus } from '../../shared/types.js';

/**
 * The one rule for a stage's status. A current revision that was rolled back counts as degraded,
 * and any other active promotion means the desired bundle differs from what is live.
 */
export function stageStatus(
  activeState: PromotionState | null,
  currentRevisionState: PromotionState | null,
): StageStatus {
  if (activeState === 'applying' || activeState === 'health_wait') return 'progressing';
  if (activeState !== null) return 'out_of_sync';
  if (currentRevisionState === null) return 'not_deployed';
  return currentRevisionState === 'healthy' ? 'healthy' : 'degraded';
}
