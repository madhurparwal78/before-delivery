import { useSyncExternalStore } from "react";

export const PHONE = "(max-width: 599px)";
export const TABLET = "(min-width: 600px) and (max-width: 1099px)";
export const REDUCED = "(prefers-reduced-motion: reduce)";

export function matches(query: string): boolean {
  return matchMedia(query).matches;
}

export function useMedia(query: string): boolean {
  return useSyncExternalStore((listener) => {
    const list = matchMedia(query);
    list.addEventListener("change", listener);
    return () => list.removeEventListener("change", listener);
  }, () => matchMedia(query).matches);
}
