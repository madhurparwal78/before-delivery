import { useEffect, useState } from "react";

export type Layout = "phone" | "tablet" | "desktop";

const TABLET = "(min-width: 768px)";
const DESKTOP = "(min-width: 1200px)";
const REDUCED = "(prefers-reduced-motion: reduce)";

function current(): Layout {
  if (matchMedia(DESKTOP).matches) return "desktop";
  return matchMedia(TABLET).matches ? "tablet" : "phone";
}

/** The published layout for the viewport: phone below 768px, tablet to 1199px, desktop from 1200px. */
export function useLayout(): Layout {
  const [layout, setLayout] = useState(current);
  useEffect(() => {
    const queries = [matchMedia(TABLET), matchMedia(DESKTOP)];
    const update = () => setLayout(current());
    for (const query of queries) query.addEventListener("change", update);
    return () => {
      for (const query of queries) query.removeEventListener("change", update);
    };
  }, []);
  return layout;
}

export function prefersReducedMotion(): boolean {
  return matchMedia(REDUCED).matches;
}
