import { useEffect, useState } from "react";

/** A media query that follows the browser setting. */
function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = (): void => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export const useReducedMotion = (): boolean => useMedia("(prefers-reduced-motion: reduce)");

/** The published breakpoint: 768 pixels and wider get the desktop layout. */
export const useDesktop = (): boolean => useMedia("(min-width: 768px)");
