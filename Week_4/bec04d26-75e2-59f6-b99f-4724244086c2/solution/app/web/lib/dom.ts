import { useSyncExternalStore } from "react";

/** Keyboard-reachable descendants in document order (adapted from the kit's a11y_dialog module). */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [tabindex]")].filter((el) => {
    if (el.hasAttribute("disabled") || el.getAttribute("type") === "hidden") return false;
    const tabindex = el.getAttribute("tabindex");
    return tabindex === null || Number(tabindex) >= 0;
  });
}

export const prefersReducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore((listener) => {
    const list = window.matchMedia(query);
    list.addEventListener("change", listener);
    return () => list.removeEventListener("change", listener);
  }, () => window.matchMedia(query).matches);
}
