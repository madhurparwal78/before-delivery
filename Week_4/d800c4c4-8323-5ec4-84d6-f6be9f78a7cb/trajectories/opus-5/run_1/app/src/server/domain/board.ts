import type { Counts, ItemStatus, LoanStatus, PartState } from '../../shared/types';

export const BOARD_COLUMNS = 10;

export interface Placement {
  col: number;
  row: number;
  width: number;
  height: number;
}

/**
 * The first position where the whole rectangle fits without overlapping an
 * earlier part, scanning row by row from the top and, within a row, column by
 * column from the left. Rectangles may touch.
 */
export function placeRectangle(
  taken: readonly Placement[],
  width: number,
  height: number,
): Placement {
  for (let row = 0; ; row += 1) {
    for (let col = 0; col + width <= BOARD_COLUMNS; col += 1) {
      const candidate: Placement = { col, row, width, height };
      if (!taken.some((other) => overlaps(candidate, other))) return candidate;
    }
  }
}

function overlaps(left: Placement, right: Placement): boolean {
  return (
    left.col < right.col + right.width &&
    right.col < left.col + left.width &&
    left.row < right.row + right.height &&
    right.row < left.row + left.height
  );
}

export function boardRows(parts: readonly Placement[]): number {
  return parts.reduce((rows, part) => Math.max(rows, part.row + part.height), 0);
}

/** The three counts always add up to the total number of parts. */
export function countParts(states: readonly PartState[]): Counts {
  return {
    on_wall: states.filter((state) => state === 'hung').length,
    out: states.filter((state) => state === 'out').length,
    missing: states.filter((state) => state === 'missing').length,
  };
}

export interface ItemStatusInput {
  readonly partStates: readonly PartState[];
  readonly openLoanStatus: LoanStatus | null;
  readonly hasReadyHold: boolean;
}

export function itemStatusOf(input: ItemStatusInput): ItemStatus {
  if (input.partStates.includes('missing')) return 'incomplete';
  if (input.openLoanStatus === 'reserved') return 'reserved';
  if (input.openLoanStatus === 'out') return 'out';
  if (input.openLoanStatus === 'pending-photo') return 'pending-photo';
  if (input.hasReadyHold) return 'held';
  return 'on-wall';
}


