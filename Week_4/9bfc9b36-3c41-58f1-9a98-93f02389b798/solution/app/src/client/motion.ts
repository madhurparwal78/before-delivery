/** Graded motion goes through here: WAAPI, and nothing at all when the device asks for reduced motion. */
import { useEffect, useRef, useState } from "react";

export const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

export const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function play(element: Element, keyframes: Keyframe[], duration: number, options: KeyframeAnimationOptions = {}): Animation | null {
  if (reducedMotion()) return null;
  return element.animate(keyframes, { duration, easing: EASE, fill: "both", ...options });
}

/** Counts a figure to its new value by elapsed time; under reduced motion it is set at once. */
export function useCountTo(target: number, duration: number): number {
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    if (reducedMotion() || current.current === target) {
      current.current = target;
      setShown(target);
      return;
    }
    const from = current.current;
    const started = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      current.current = Math.round(from + (target - from) * eased);
      setShown(current.current);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return shown;
}
