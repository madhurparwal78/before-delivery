// The motion values from Motion and effects, for the motions started from script.

/** Eases in quickly and settles gently: every motion in the product uses it. */
export const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
export const DIALOG_MS = 180;
export const PAN_MS = 420;
export const DRAW_MS = 320;
export const PULSE_MS = 320;

export function reducedMotion(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}
