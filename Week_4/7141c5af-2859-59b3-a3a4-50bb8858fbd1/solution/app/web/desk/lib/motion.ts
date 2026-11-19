export const STEP_MS = 160;
export const MOVE_MS = 320;
export const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

/** Read at the moment a motion would start, so turning it on or off applies from the next animation. */
export function reducedMotion(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function isPhone(): boolean {
  return matchMedia("(max-width: 767.98px)").matches;
}
