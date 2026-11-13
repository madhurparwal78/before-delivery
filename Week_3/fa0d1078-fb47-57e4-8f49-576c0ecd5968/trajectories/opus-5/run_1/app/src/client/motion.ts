export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** One browser animation, or nothing at all when the player reduces motion. */
export function play(
  element: Element,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): Animation | null {
  if (reducedMotion()) return null;
  return element.animate(keyframes, { easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', ...options });
}

export const STITCH_MS = 240;
export const COUNT_ROLL_MS = 320;
export const STITCH_STAGGER_MS = 24;
export const CELL_CELEBRATE_MS = 300;
export const CELL_CELEBRATE_STEP_MS = 40;
export const CELEBRATION_MS = CELL_CELEBRATE_STEP_MS * 16 + CELL_CELEBRATE_MS;
