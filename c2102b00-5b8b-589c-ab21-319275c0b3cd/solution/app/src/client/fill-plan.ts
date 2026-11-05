// The timeline of "Fill the case", worked out once for the cells, the numeral, the seal step and
// the crate: changed cells one after another (the last first for a reduction), then the numeral
// counts, then the seal step. An unsealing change runs the seal step first.
import type { Plan } from "./crate/pose.js";
import { SEAL_MS } from "./crate/pose.js";
import { type Line, onSealedSide } from "./line.js";

const CELL_GAP_MS = 30;
const CELL_SPREAD_MS = 800;
export const CELL_MS = 160;
export const COUNT_MS = 330;
/** The block's frame and colour change, then its glide to the rail or panel. */
export const FRAME_MS = 260;
export const GLIDE_MS = 300;

interface FillPlan {
  /** Changed cell indexes with the ms (from the response) at which each changes. */
  cells: { index: number; at: number }[];
  /** When the numeral starts counting, and the integer steps it passes. */
  countAt: number;
  /** When the seal (or unseal) step runs, or null when the case stays where it is. */
  stepAt: number | null;
  crate: Plan;
}

/** `shownSealed` is whether the block is drawn sealed now, which a cancelled sequence may not have finished. */
export function planFill(
  before: Line, shownSealed: boolean, next: Line, shown: Line["cells"], numeral: number,
): FillPlan {
  const reduction = (next.my_units ?? 0) < (before.my_units ?? 0);
  const moves = onSealedSide(next) !== shownSealed;
  const unseal = moves && shownSealed;
  const start = unseal ? SEAL_MS : 0;
  const changed = next.cells.map((c, i) => (shown[i] !== c ? i : -1)).filter((i) => i >= 0);
  const order = reduction ? changed.reverse() : changed;
  const gap = order.length > 1 ? Math.min(CELL_GAP_MS, CELL_SPREAD_MS / (order.length - 1)) : 0;
  const cells = order.map((index, n) => ({ index, at: start + n * gap }));
  const cellsDone = order.length ? start + (order.length - 1) * gap + CELL_MS : start;
  const steps = Math.abs(next.units_to_go - numeral);
  const stepAt = !moves ? null : unseal ? 0 : cellsDone + (steps ? COUNT_MS : 0);
  return {
    cells,
    countAt: cellsDone,
    stepAt,
    crate: {
      units: new Map(cells.map(({ index, at }) => [index, { at, dir: next.cells[index] === "empty" ? (-1 as const) : (1 as const) }])),
      lid: stepAt === null ? null : { at: stepAt, dir: unseal ? (-1 as const) : (1 as const) },
    },
  };
}
