const EASE = "cubic-bezier(.22, .8, .24, 1)";

/** Wide screens without reduced motion hold Inner Pace and Oxygen & Energy in view; everything else scrolls normally. */
const HELD_QUERY = "(min-width: 768px) and (prefers-reduced-motion: no-preference)";

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)");
const HELD = matchMedia(HELD_QUERY);

export function reducedMotion(): boolean {
  return REDUCED.matches;
}

export function held(): boolean {
  return HELD.matches;
}

export function onHeldChange(listener: () => void, signal: AbortSignal): void {
  HELD.addEventListener("change", listener, { signal });
}

/** A published motion; with reduced motion nothing runs and the end state is already in place. */
export function play(element: Element, keyframes: Keyframe[], duration: number): Animation | null {
  return reducedMotion() ? null : element.animate(keyframes, { duration, easing: EASE });
}
