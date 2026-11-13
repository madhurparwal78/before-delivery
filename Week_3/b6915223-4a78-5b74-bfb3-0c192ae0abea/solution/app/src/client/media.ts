import { useEffect, useState } from "preact/hooks";

export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const list = matchMedia(query);
    const update = () => setMatches(list.matches);
    list.addEventListener("change", update);
    update();
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export const PHONE = "(max-width: 599px)";
export const REDUCED = "(prefers-reduced-motion: reduce)";
