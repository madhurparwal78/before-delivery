import { useEffect, useRef, useState } from 'react';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = (): void => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** From 720 CSS pixels up the main navigation and the cluster tray show inline. */
export function useInlineChrome(): boolean {
  return useMediaQuery('(min-width: 720px)');
}

export function useReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

function useLatest<T>(value: T): { current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

export function useInterval(callback: () => void, delayMs: number): void {
  const latest = useLatest(callback);
  useEffect(() => {
    const timer = setInterval(() => latest.current(), delayMs);
    return () => clearInterval(timer);
  }, [delayMs, latest]);
}
