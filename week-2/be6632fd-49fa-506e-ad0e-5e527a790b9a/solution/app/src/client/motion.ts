// The motion system (brief: Motion and effects): three durations and one easing, CSS or element animations only,
// and nothing that moves under reduced motion.
export const FEEDBACK = 140;
export const STATE = 280;
export const ENTRANCE = 560;
export const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Plays an element animation unless reduced motion is asked for. */
export function play(el: Element, frames: Keyframe[], duration: number): Animation | null {
  if (reducedMotion()) return null;
  return el.animate(frames, { duration, easing: EASE });
}

/** FLIP: slides each element from its old place to its new one over 280 ms. */
export function glide(elements: Map<string, HTMLElement>, before: Map<string, DOMRect>): void {
  if (reducedMotion()) return;
  for (const [key, el] of elements) {
    const old = before.get(key);
    if (!old) continue;
    const now = el.getBoundingClientRect();
    const dx = old.left - now.left;
    const dy = old.top - now.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], { duration: STATE, easing: EASE });
  }
}

export function rects(elements: Map<string, HTMLElement>): Map<string, DOMRect> {
  return new Map([...elements].map(([key, el]) => [key, el.getBoundingClientRect()]));
}
