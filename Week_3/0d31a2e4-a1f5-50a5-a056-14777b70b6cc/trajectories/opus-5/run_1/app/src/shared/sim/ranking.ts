import type { BeanState, RoundKind } from '../types.js';

export interface RankInput {
  userId: number;
  /** Position along the course at the tick being ranked. */
  z: number;
  state: BeanState;
  qualifyTick: number | null;
  eliminatedTick: number | null;
  /** Position along the course on the tick this bean was eliminated. */
  zAtEliminated: number;
}

/**
 * The one rank order: beans qualified by this tick, then beans still in play,
 * then eliminated beans by how recently they went out.
 */
export function rankOrder(kind: RoundKind, beans: readonly RankInput[]): number[] {
  const arena = kind === 'survival';
  const qualified = beans.filter((bean) => bean.qualifyTick !== null);
  const eliminated = beans.filter(
    (bean) => bean.qualifyTick === null && bean.eliminatedTick !== null,
  );
  const playing = beans.filter((bean) => bean.qualifyTick === null && bean.eliminatedTick === null);
  qualified.sort(
    (a, b) => (a.qualifyTick ?? 0) - (b.qualifyTick ?? 0) || a.userId - b.userId,
  );
  playing.sort((a, b) => (arena ? a.userId - b.userId : b.z - a.z || a.userId - b.userId));
  eliminated.sort((a, b) => {
    const byTick = (b.eliminatedTick ?? 0) - (a.eliminatedTick ?? 0);
    if (byTick !== 0) return byTick;
    if (arena) return a.userId - b.userId;
    return b.zAtEliminated - a.zAtEliminated || a.userId - b.userId;
  });
  return [...qualified, ...playing, ...eliminated].map((bean) => bean.userId);
}

/** The one slots-left rule, used live, in frames and in the replay. */
export function slotsLeftFor(
  kind: RoundKind,
  slots: number,
  states: readonly BeanState[],
): number {
  if (kind === 'survival') {
    return Math.max(0, states.filter((state) => state === 'alive').length - slots);
  }
  return Math.max(0, slots - states.filter((state) => state === 'qualified').length);
}
