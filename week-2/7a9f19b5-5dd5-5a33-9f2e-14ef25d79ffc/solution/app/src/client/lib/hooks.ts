import { useEffect, useRef, useState, useSyncExternalStore } from "react";

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const list = matchMedia(query);
      list.addEventListener("change", listener);
      return () => list.removeEventListener("change", listener);
    },
    () => matchMedia(query).matches,
  );
}

export function prefersReducedMotion(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export const useReducedMotion = () => useMedia("(prefers-reduced-motion: reduce)");
export const useDesktop = () => useMedia("(min-width: 1280px)");
export const usePhone = () => useMedia("(max-width: 767px)");

/** Counts from the previous value to `target` in about 0.4 s, fast first and slowing into the final figure. */
export function useCountUp(target: number, duration = 400, from?: number): number {
  const [shown, setShown] = useState(from ?? target);
  const previous = useRef(from ?? target);
  useEffect(() => {
    const start = previous.current;
    previous.current = target;
    if (start === target || prefersReducedMotion()) {
      setShown(target);
      return;
    }
    const began = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - began) / duration);
      const eased = 1 - (1 - t) ** 3;
      setShown(t >= 1 ? target : Math.round(start + (target - start) * eased));
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return shown;
}

/** `value`, once it has stopped changing for `delay` ms. */
export function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
