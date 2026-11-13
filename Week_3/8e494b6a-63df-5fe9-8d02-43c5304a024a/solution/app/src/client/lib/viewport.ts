// The three layout bands, decided by viewport width only: phone below 768, tablet to 1099, desk from 1100.
import { useSyncExternalStore } from "react";

type Band = "phone" | "tablet" | "desk";

const bandNow = (): Band => (window.innerWidth < 768 ? "phone" : window.innerWidth < 1100 ? "tablet" : "desk");

export function useBand(): Band {
  return useSyncExternalStore(
    (listener) => {
      window.addEventListener("resize", listener);
      return () => window.removeEventListener("resize", listener);
    },
    bandNow,
  );
}
