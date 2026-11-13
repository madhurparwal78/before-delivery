import type { BarRange } from './running-time.js';

export interface PrintedBars {
  bars_from: number;
  bars_to: number;
}

/** A part's printed bars share a bar with the cut. */
export function partPlaysInCut(part: PrintedBars, cut: BarRange): boolean {
  return part.bars_from <= cut.to_bar && part.bars_to >= cut.from_bar;
}

/** The cuts a part still has to have marked: it plays in them and has no mark for them. */
export function cutsToMark<Cut extends BarRange & { id: string }>(
  part: PrintedBars,
  cuts: readonly Cut[],
  markedCutIds: ReadonlySet<string>,
): string[] {
  return cuts.filter((cut) => partPlaysInCut(part, cut) && !markedCutIds.has(cut.id)).map((cut) => cut.id);
}
