import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 767.98px)";

/** True below 768 px; exactly 768 px is the wide layout. */
export function useNarrow(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const list = window.matchMedia(QUERY);
      list.addEventListener("change", listener);
      return () => list.removeEventListener("change", listener);
    },
    () => window.matchMedia(QUERY).matches,
  );
}
