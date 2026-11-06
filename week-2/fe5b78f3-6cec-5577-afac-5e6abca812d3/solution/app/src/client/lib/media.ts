// Breakpoints and the reduced-motion setting as React state (brief: Screens and layout).
import { useSyncExternalStore } from "react";

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => matchMedia(query).matches,
  );
}

type Layout = "phone" | "tablet" | "desktop";

export function useLayout(): Layout {
  const tablet = useMedia("(min-width: 768px)");
  const desktop = useMedia("(min-width: 1200px)");
  if (desktop) return "desktop";
  return tablet ? "tablet" : "phone";
}

export function useReducedMotion(): boolean {
  return useMedia("(prefers-reduced-motion: reduce)");
}

export function prefersReducedMotion(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}
