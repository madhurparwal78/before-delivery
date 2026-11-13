/** The one place the published easing curve and the motion durations are decided. */

export const EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

export const DURATIONS = {
  /** Pane and sheet enter and exit, and the backdrop fade. */
  pane: 600,
  press: 80,
  hover: 100,
  chip: 240,
  accepted: 240,
  tileFlip: 360,
  tileSlide: 420,
  /** Every motion with reduced motion asked for. */
  reduced: 120,
} as const;

/** Delay between the start of one tile's flip and the next one's. */
export const TILE_FLIP_STAGGER = 70;

/** CSS custom properties, so the stylesheet and the scripts share these numbers. */
export function motionCustomProperties(): Record<string, string> {
  return {
    '--easing': EASING,
    '--duration-pane': `${DURATIONS.pane}ms`,
    '--duration-press': `${DURATIONS.press}ms`,
    '--duration-hover': `${DURATIONS.hover}ms`,
    '--duration-chip': `${DURATIONS.chip}ms`,
    '--duration-accepted': `${DURATIONS.accepted}ms`,
    '--duration-flip': `${DURATIONS.tileFlip}ms`,
    '--duration-slide': `${DURATIONS.tileSlide}ms`,
    '--duration-reduced': `${DURATIONS.reduced}ms`,
  };
}
