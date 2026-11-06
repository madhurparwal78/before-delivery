import type { LoadStatus, PieceStatus } from '../../shared/labels.ts';

/** The piece state machine's check-in edges, decided only here. */
export function checkInTarget(from: PieceStatus): PieceStatus | null {
  if (from === 'logged') return 'waiting_bisque';
  if (from === 'bisqued') return 'waiting_glaze';
  return null;
}

/** The load state machine, decided only here. */
const LOAD_NEXT: Record<LoadStatus, readonly LoadStatus[]> = {
  planning: ['loaded', 'cancelled'],
  loaded: ['firing', 'cancelled'],
  firing: ['cooling'],
  cooling: ['unloaded'],
  unloaded: [],
  cancelled: [],
};

export function loadMayMove(from: LoadStatus, to: LoadStatus): boolean {
  return (LOAD_NEXT[from] as readonly LoadStatus[]).includes(to);
}

export const OPEN_LOAD_STATUSES: readonly LoadStatus[] = ['planning', 'loaded', 'firing', 'cooling'];
export const KILN_BUSY_STATUSES: readonly LoadStatus[] = ['loaded', 'firing', 'cooling'];
