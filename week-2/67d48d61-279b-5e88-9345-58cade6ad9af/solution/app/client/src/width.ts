// The published layouts: phone below 768 pixels, tablet from 768 to 1199, wide from 1200.

import { useSyncExternalStore } from "react";

export type Width = "phone" | "tablet" | "wide";

const wide = matchMedia("(min-width: 1200px)");
const tablet = matchMedia("(min-width: 768px)");

const read = (): Width => (wide.matches ? "wide" : tablet.matches ? "tablet" : "phone");

const subscribe = (notify: () => void): (() => void) => {
  wide.addEventListener("change", notify);
  tablet.addEventListener("change", notify);
  return () => {
    wide.removeEventListener("change", notify);
    tablet.removeEventListener("change", notify);
  };
};

export const useWidth = (): Width => useSyncExternalStore(subscribe, read);
