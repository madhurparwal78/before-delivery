import { useEffect } from "react";

type Listener = () => void;

const listeners = new Set<Listener>();
let frame = 0;
let seen = Number.NaN;

function sample(force: boolean): void {
  const at = window.scrollY;
  if (!force && at === seen) return;
  seen = at;
  for (const listener of listeners) listener();
}

const onEvent = (): void => sample(true);

function loop(): void {
  sample(false);
  frame = requestAnimationFrame(loop);
}

/**
 * Runs `listener` whenever the scroll position (or the viewport) changes. Scroll events are delivered a frame late,
 * so one shared animation-frame poll reads `scrollY` as well: every scroll-driven effect is then a pure function of
 * the scroll position as it is at that frame, with no smoothing.
 */
export function useScrollSync(active: boolean, listener: Listener): void {
  useEffect(() => {
    if (!active) return undefined;
    if (listeners.size === 0) {
      window.addEventListener("scroll", onEvent, { passive: true });
      window.addEventListener("resize", onEvent);
      seen = Number.NaN;
      frame = requestAnimationFrame(loop);
    }
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        window.removeEventListener("scroll", onEvent);
        window.removeEventListener("resize", onEvent);
        cancelAnimationFrame(frame);
      }
    };
  }, [active, listener]);
}
