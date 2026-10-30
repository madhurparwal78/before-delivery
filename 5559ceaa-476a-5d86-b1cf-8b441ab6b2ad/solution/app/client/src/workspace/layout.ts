import { useEffect, useState } from "react";

export type Band = "narrow" | "mid" | "wide";

const WIDE = "(min-width: 1280px)";
const MID = "(min-width: 768px)";

function current(): Band {
  if (window.matchMedia(WIDE).matches) return "wide";
  return window.matchMedia(MID).matches ? "mid" : "narrow";
}

/** The published layout band; the layout changes only at 768 and 1280 wide. */
export function useBand(): Band {
  const [band, setBand] = useState(current);
  useEffect(() => {
    const queries = [window.matchMedia(WIDE), window.matchMedia(MID)];
    const update = () => setBand(current());
    queries.forEach((q) => q.addEventListener("change", update));
    return () => queries.forEach((q) => q.removeEventListener("change", update));
  }, []);
  return band;
}
