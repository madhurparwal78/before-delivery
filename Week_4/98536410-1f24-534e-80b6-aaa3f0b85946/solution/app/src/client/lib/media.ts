import { useSyncExternalStore } from "react";

/** True while the viewport matches the media query. */
export function useMedia(query: string): boolean {
  const list = window.matchMedia(query);
  return useSyncExternalStore(
    (listener) => {
      list.addEventListener("change", listener);
      return () => list.removeEventListener("change", listener);
    },
    () => list.matches,
  );
}

export const PHONE = "(max-width: 767px)";
