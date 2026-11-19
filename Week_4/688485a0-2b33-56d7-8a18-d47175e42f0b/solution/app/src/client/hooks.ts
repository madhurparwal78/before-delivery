import { useSyncExternalStore } from "react";

export type Layout = "phone" | "tablet" | "desktop";

const PHONE = "(max-width: 767.98px)";
const DESKTOP = "(min-width: 1280px)";

function subscribe(listener: () => void): () => void {
  const queries = [window.matchMedia(PHONE), window.matchMedia(DESKTOP)];
  queries.forEach((query) => query.addEventListener("change", listener));
  return () => queries.forEach((query) => query.removeEventListener("change", listener));
}

function layoutNow(): Layout {
  if (window.matchMedia(PHONE).matches) return "phone";
  return window.matchMedia(DESKTOP).matches ? "desktop" : "tablet";
}

/** The published workspace layout for the current viewport width. */
export function useLayout(): Layout {
  return useSyncExternalStore(subscribe, layoutNow);
}
