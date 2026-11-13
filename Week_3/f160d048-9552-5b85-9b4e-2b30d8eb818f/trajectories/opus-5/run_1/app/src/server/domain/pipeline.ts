import type { Stage } from '../../shared/reference';

const ORDER: ReadonlyArray<Stage> = ['submitted', 'screening', 'interview', 'offer'];

/** The one place the pipeline's legal moves are decided. */
export function isLegalStageMove(from: Stage, to: Stage): boolean {
  if (from === 'declined') return false;
  if (to === 'declined') return true;
  const fromIndex = ORDER.indexOf(from);
  const toIndex = ORDER.indexOf(to);
  return toIndex >= 0 && Math.abs(toIndex - fromIndex) === 1;
}
