import { useEffect, useState } from "react";

export type Layout = "desk" | "tablet" | "phone";

/** Breakpoints (brief: Screens and layout): desk ≥1024, tablet 600–1023, phone <600. */
function current(): Layout {
  const w = window.innerWidth;
  return w >= 1024 ? "desk" : w >= 600 ? "tablet" : "phone";
}

export function useLayout(): Layout {
  const [layout, setLayout] = useState<Layout>(current);
  useEffect(() => {
    const update = () => setLayout(current());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return layout;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
