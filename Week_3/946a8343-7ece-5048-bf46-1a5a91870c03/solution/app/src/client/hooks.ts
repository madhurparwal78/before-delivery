// Viewport hooks driven by matchMedia change events (no timers).
//   useMediaQuery(query)          boolean
//   useBreakpoint()               'phone' (< 768 px) | 'tablet' (768 to 1279 px) | 'desk' (1280 px and wider)
//   prefersReducedMotion()        current value of the reduced-motion preference (read at call time, for animate() guards)
import { useLayoutEffect, useState } from "preact/hooks";

export const PHONE_QUERY = "(max-width: 767.98px)";
const DESK_QUERY = "(min-width: 1280px)";
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useLayoutEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    list.addEventListener("change", onChange);
    onChange();
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

type Breakpoint = "phone" | "tablet" | "desk";

export function useBreakpoint(): Breakpoint {
  const phone = useMediaQuery(PHONE_QUERY);
  const desk = useMediaQuery(DESK_QUERY);
  return phone ? "phone" : desk ? "desk" : "tablet";
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia(REDUCED_QUERY).matches;
}
