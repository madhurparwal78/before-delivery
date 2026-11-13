export const PANEL_COUNT = 3;
export const STAGE_COUNT = 5;

/** Chapters are held in view at this width and above. */
export const HELD_MIN_WIDTH = 768;

/** The share of the viewport height that decides the current chapter. */
export const CURRENT_CHAPTER_PROBE = 0.4;

export function clampProgress(progress: number): number {
  return Math.min(1, Math.max(0, progress));
}

/** `data-progress` is the progress with two decimals, rounded half up. */
export function formatProgress(progress: number): string {
  return (Math.floor(progress * 100 + 0.5) / 100).toFixed(2);
}

export function panelFromProgress(progress: number): number {
  if (progress < 0.25) {
    return 1;
  }
  return progress < 0.75 ? 2 : 3;
}

export function progressForPanel(panel: number): number {
  return (panel - 1) / (PANEL_COUNT - 1);
}

export function stageFromProgress(progress: number): number {
  return Math.min(STAGE_COUNT, Math.floor(progress * STAGE_COUNT) + 1);
}

/**
 * Where stage `k` sits: the progress a tab jumps to while the chapter is held,
 * and how far along the oxygen path the dot sits while it is not.
 */
export function progressForStage(stage: number): number {
  return (stage - 0.5) / STAGE_COUNT;
}

/** How far the Inner Pace track moves left, counted in panel widths. */
export function trackOffsetInPanels(progress: number): number {
  return progress * (PANEL_COUNT - 1);
}
