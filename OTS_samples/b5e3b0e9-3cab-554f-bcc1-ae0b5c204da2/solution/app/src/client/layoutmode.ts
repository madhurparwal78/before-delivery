import { useLayoutEffect, useState } from "preact/hooks";

export type LayoutMode = "desktop" | "tablet" | "phone";

const desktop = window.matchMedia("(min-width: 1024px)");
const tablet = window.matchMedia("(min-width: 600px)");

const current = (): LayoutMode => (desktop.matches ? "desktop" : tablet.matches ? "tablet" : "phone");

/** `desktop` from 1024 px, `tablet` from 600 to 1023 px, `phone` below. */
export function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState(current());
  useLayoutEffect(() => {
    const update = (): void => setMode(current());
    desktop.addEventListener("change", update);
    tablet.addEventListener("change", update);
    return () => {
      desktop.removeEventListener("change", update);
      tablet.removeEventListener("change", update);
    };
  }, []);
  return mode;
}
