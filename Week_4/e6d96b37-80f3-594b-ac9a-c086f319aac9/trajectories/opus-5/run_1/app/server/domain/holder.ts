import type { Holder } from '../../shared/types.ts';

/** A tray cell's millimetre size. Every seeded cell is 60 mm by 60 mm. */
export interface CellSize {
  width_mm: number;
  height_mm: number;
}

/**
 * A holder fits when its width and height are both at most the cell's, with no
 * rotation. This is the only place holder fit is decided.
 */
export function holderFits(holder: Holder, cell: CellSize): boolean {
  return holder.width_mm <= cell.width_mm && holder.height_mm <= cell.height_mm;
}

/** Row-major order over the tray's cells, used by the audit walk and paging. */
export function rowMajorCompare(
  left: { row_index: number; col_index: number },
  right: { row_index: number; col_index: number },
): number {
  return left.row_index - right.row_index || left.col_index - right.col_index;
}
