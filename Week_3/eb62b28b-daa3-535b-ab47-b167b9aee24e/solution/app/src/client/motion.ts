// The one path for all motion. Under reduced motion a call finishes at once, in the same call.

export const SHORT = 160;
export const MEDIUM = 320;
export const LONG = 640;
const EASE = "cubic-bezier(0.2, 0.7, 0.2, 1)";

export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function play(element: Element, frames: Keyframe[], duration: number, done?: () => void): Animation | null {
  if (reducedMotion()) {
    done?.();
    return null;
  }
  const animation = element.animate(frames, { duration, easing: EASE, fill: "both" });
  animation.onfinish = () => {
    done?.();
    animation.cancel();
  };
  return animation;
}
