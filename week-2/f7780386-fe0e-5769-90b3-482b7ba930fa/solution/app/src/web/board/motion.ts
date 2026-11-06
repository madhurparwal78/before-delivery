// Graded motion with element.animate(): timings from DESIGN.md, and nothing at all under reduced motion.

const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
export const ROLL_MS = 240;
export const FLIGHT_MS = 320;
export const SHAKE_MS = 320;
export const FADE_MS = 160;
export const DRAWER_MS = 250;
/** The drawer slides in from the right over a short run with a fade, so its controls barely move while it settles. */
export const DRAWER_IN: Keyframe[] = [{ transform: "translateX(48px)", opacity: 0 }, { transform: "translateX(0)", opacity: 1 }];
export const DRAWER_OUT: Keyframe[] = [{ transform: "translateX(0)", opacity: 1 }, { transform: "translateX(48px)", opacity: 0 }];
export const EXPIRE_MS = 250;
export const LOSS_EDGE_MS = 2000;

export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Runs a WAAPI animation unless the user asked for reduced motion. */
export function animate(element: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  if (reducedMotion()) return null;
  return element.animate(keyframes, { easing: EASE_OUT, ...options });
}
