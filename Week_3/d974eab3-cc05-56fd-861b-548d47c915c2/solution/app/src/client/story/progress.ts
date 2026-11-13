/** The scroll formulas of the held chapters. Offsets are pixels into the chapter; travel is chapter height minus viewport height. */
export const PANEL_COUNT = 3;
export const STAGE_COUNT = 5;

function clampOffset(offset: number, travel: number): number {
  return Math.min(travel, Math.max(0, offset));
}

/** How far a held chapter is scrolled: the pixels into it, the whole travel and its top in the document. */
export function heldGeometry(region: HTMLElement): { offset: number; travel: number; top: number } {
  const rect = region.getBoundingClientRect();
  return { offset: -rect.top, travel: rect.height - innerHeight, top: rect.top + scrollY };
}

/** Progress 0 to 1 through the travel. */
export function share(offset: number, travel: number): number {
  return clampOffset(offset, travel) / travel;
}

/** The panel of a snapping row: the one whose centre is nearest the row's centre. */
export function panelAtScroll(left: number, width: number): number {
  return Math.min(PANEL_COUNT, Math.round(left / width) + 1);
}

/** Progress 0 to 1, shown with two decimals rounded half up. */
export function progressText(offset: number, travel: number): string {
  return (Math.floor(share(offset, travel) * 100 + 0.5 + 1e-9) / 100).toFixed(2);
}

/** Panel 1 below a quarter of the travel, 2 below three quarters, otherwise 3, decided on the exact offset. */
export function panelAt(offset: number, travel: number): number {
  const exact = clampOffset(offset, travel) * 4;
  if (exact < travel) return 1;
  return exact < travel * 3 ? 2 : PANEL_COUNT;
}

export function stageAt(offset: number, travel: number): number {
  return Math.min(STAGE_COUNT, Math.floor((clampOffset(offset, travel) * STAGE_COUNT) / travel) + 1);
}

/** Where the page sits, as a share of the travel, when panel k is chosen by a button. */
export function panelProgress(panel: number): number {
  return (panel - 1) / (PANEL_COUNT - 1);
}

/** Where the page sits, and where the dot rests when nothing is held, for stage k. */
export function stageProgress(stage: number): number {
  return (stage - 0.5) / STAGE_COUNT;
}
