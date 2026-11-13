// The only place an animation is created: named, short, and never under the reduced-motion preference.
const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
export const EASE_IN_OUT = "ease-in-out";

export function play(element: Element, id: string, keyframes: Keyframe[], duration: number, easing: string): void {
  if (reducedMotion()) return;
  element.animate(keyframes, { id, duration, easing, fill: "none" });
}
