// Reduced-motion preference and the page clock used by every sequence (performance.now, never the date).
import { useSyncExternalStore } from "react";

const query = matchMedia("(prefers-reduced-motion: reduce)");

export const prefersReduced = (): boolean => query.matches;

export function useReducedMotion(): boolean {
  return useSyncExternalStore((l) => {
    query.addEventListener("change", l);
    return () => query.removeEventListener("change", l);
  }, () => query.matches);
}

export const clock = (): number => performance.now() / 1000;
