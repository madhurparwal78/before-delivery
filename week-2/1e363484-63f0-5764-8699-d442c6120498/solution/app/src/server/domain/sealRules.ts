// The seal preconditions and their order. Seals check readings_changed first; previews report the
// same state blocks as `blocked_reason`, then the role. A seal refuses an overlap with the error
// `interval_overlaps_sealed`; a preview names the same block `overlaps_sealed`.

interface IntactFigure {
  id: string;
  start: number;
  end: number;
}

type StateBlock =
  | { reason: "below_coverage_floor" }
  | { reason: "overlaps_sealed" | "already_sealed"; figureId: string };

/**
 * The first state block for sealing [start, end): below the coverage floor, then an overlapping intact
 * figure, then an intact figure with exactly this interval. Intervals that only touch do not overlap.
 */
export function stateBlock(atFloor: boolean, start: number, end: number, intact: IntactFigure[]): StateBlock | null {
  if (!atFloor) return { reason: "below_coverage_floor" };
  const overlapping = intact.filter((f) => f.start < end && start < f.end);
  const partial = overlapping.find((f) => f.start !== start || f.end !== end);
  if (partial) return { reason: "overlaps_sealed", figureId: partial.id };
  const exact = overlapping[0];
  return exact ? { reason: "already_sealed", figureId: exact.id } : null;
}

type SealRefusal =
  | { reason: "readings_changed" | "below_coverage_floor" }
  | { reason: "interval_overlaps_sealed" | "already_sealed"; figureId: string };

/**
 * The first refusal for a seal, in the published order: readings changed since the preview, below the
 * coverage floor, overlapping an intact figure, then the same interval already sealed.
 */
export function sealRefusal(previewFingerprint: string, current: { fingerprint: string; atFloor: boolean },
  start: number, end: number, intact: IntactFigure[]): SealRefusal | null {
  if (previewFingerprint !== current.fingerprint) return { reason: "readings_changed" };
  const block = stateBlock(current.atFloor, start, end, intact);
  if (block === null || block.reason === "below_coverage_floor") return block;
  return { reason: block.reason === "overlaps_sealed" ? "interval_overlaps_sealed" : "already_sealed", figureId: block.figureId };
}
