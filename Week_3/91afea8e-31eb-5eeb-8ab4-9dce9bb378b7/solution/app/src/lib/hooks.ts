import { useEffect, useState } from "react";

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

export const usePhone = (): boolean => useMedia("(max-width: 767px)");
export const useDesktop = (): boolean => useMedia("(min-width: 1200px)");
export const useReducedMotion = (): boolean => useMedia("(prefers-reduced-motion: reduce)");

/** Phone layout up to and including 767, tablet 768 to 1199, desktop from 1200. */
export function useLayout(): "phone" | "tablet" | "desktop" {
  const phone = usePhone();
  const desktop = useDesktop();
  return phone ? "phone" : desktop ? "desktop" : "tablet";
}

export function useTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} | Chauraha Bazaar`;
  }, [title]);
}
