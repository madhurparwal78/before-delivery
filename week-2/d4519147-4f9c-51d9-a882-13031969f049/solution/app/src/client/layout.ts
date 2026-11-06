import { useSyncExternalStore } from "react";

type Layout = "desktop" | "tablet" | "phone";

const wide = window.matchMedia("(min-width: 1200px)");
const medium = window.matchMedia("(min-width: 768px)");

function current(): Layout {
  return wide.matches ? "desktop" : medium.matches ? "tablet" : "phone";
}

function subscribe(listener: () => void): () => void {
  wide.addEventListener("change", listener);
  medium.addEventListener("change", listener);
  return () => {
    wide.removeEventListener("change", listener);
    medium.removeEventListener("change", listener);
  };
}

/** The published editor layout for the window width: 1200 and wider, 768 to 1199, below 768. */
export function useLayout(): Layout {
  return useSyncExternalStore(subscribe, current);
}
