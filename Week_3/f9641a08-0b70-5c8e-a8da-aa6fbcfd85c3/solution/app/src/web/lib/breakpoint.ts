import { useSyncExternalStore } from "react";

// The published layout widths: tablet starts at 640, desktop at 1024.

type Breakpoint = "phone" | "tablet" | "desktop";

const tablet = window.matchMedia("(min-width: 640px)");
const desktop = window.matchMedia("(min-width: 1024px)");

function subscribe(listener: () => void): () => void {
  tablet.addEventListener("change", listener);
  desktop.addEventListener("change", listener);
  return () => {
    tablet.removeEventListener("change", listener);
    desktop.removeEventListener("change", listener);
  };
}

function snapshot(): Breakpoint {
  if (desktop.matches) return "desktop";
  return tablet.matches ? "tablet" : "phone";
}

export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, snapshot);
}
