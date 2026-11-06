// Media query hook: phone layout (≤ 767px) and reduced motion.

import { useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const list = matchMedia(query);
      list.addEventListener("change", listener);
      return () => list.removeEventListener("change", listener);
    },
    () => matchMedia(query).matches,
  );
}

export const PHONE = "(max-width: 767px)";

export function prefersReducedMotion(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}
