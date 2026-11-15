import { useEffect, useState } from "preact/hooks";

export type Band = "wide" | "medium" | "narrow";

const wideQuery = window.matchMedia("(min-width: 1024px)");
const mediumQuery = window.matchMedia("(min-width: 768px)");
const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

function currentBand(): Band {
  if (wideQuery.matches) return "wide";
  return mediumQuery.matches ? "medium" : "narrow";
}

export function useBand(): Band {
  const [band, setBand] = useState(currentBand);
  useEffect(() => {
    const update = () => setBand(currentBand());
    wideQuery.addEventListener("change", update);
    mediumQuery.addEventListener("change", update);
    return () => {
      wideQuery.removeEventListener("change", update);
      mediumQuery.removeEventListener("change", update);
    };
  }, []);
  return band;
}

export function prefersReducedMotion(): boolean {
  return reducedQuery.matches;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(reducedQuery.matches);
  useEffect(() => {
    const update = () => setReduced(reducedQuery.matches);
    reducedQuery.addEventListener("change", update);
    return () => reducedQuery.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** Moves focus among a set of items with arrow keys, wrapping, plus Home and End. */
export function rovingIndex(key: string, index: number, count: number, axis: "both" | "horizontal" = "both"): number | null {
  const next = axis === "both" ? ["ArrowRight", "ArrowDown"] : ["ArrowRight"];
  const previous = axis === "both" ? ["ArrowLeft", "ArrowUp"] : ["ArrowLeft"];
  if (next.includes(key)) return (index + 1) % count;
  if (previous.includes(key)) return (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

export const crossfadeMs = 600;
export const restMs = 320;
