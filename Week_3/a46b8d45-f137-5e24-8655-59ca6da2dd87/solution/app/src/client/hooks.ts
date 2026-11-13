import { useLayoutEffect as useEffect, useState } from "preact/hooks";

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
export const useWide = (): boolean => useMedia("(min-width: 768px)");
export const useDesktop = (): boolean => useMedia("(min-width: 1280px)");
