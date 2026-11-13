import { useEffect, useRef, useState } from "preact/hooks";

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setMatch(m.matches);
    m.addEventListener("change", on);
    on();
    return () => m.removeEventListener("change", on);
  }, [query]);
  return match;
}

export const useWide = (): boolean => useMedia("(min-width: 768px)");
export const useDesktop = (): boolean => useMedia("(min-width: 1280px)");
export const useReducedMotion = (): boolean => useMedia("(prefers-reduced-motion: reduce)");

/** Runs `fn` every `ms` of the page's own timer. The latest `fn` is always the one called. */
export function useEvery(ms: number | null, fn: () => void): void {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => saved.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

