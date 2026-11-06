import { useEffect, useState } from 'react';

/** A media query kept current as the viewport changes. */
function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = (): void => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    window.addEventListener('resize', update);
    return () => {
      list.removeEventListener('change', update);
      window.removeEventListener('resize', update);
    };
  }, [query]);
  return matches;
}

const NARROW = '(max-width: 767px)';
export const isNarrow = (): boolean => window.matchMedia(NARROW).matches;
export const useNarrow = (): boolean => useMedia(NARROW);

/** Calls `task` now and then every `ms` while mounted. A running call is never overlapped. */
export function usePoll(task: () => Promise<void>, ms: number, deps: unknown[]): void {
  useEffect(() => {
    let alive = true;
    let busy = false;
    const run = async (): Promise<void> => {
      if (busy || !alive) return;
      busy = true;
      try { await task(); } catch { /* a failed read keeps the last good one on screen */ }
      busy = false;
    };
    void run();
    const timer = window.setInterval(() => { void run(); }, ms);
    return () => { alive = false; window.clearInterval(timer); };
  }, deps);
}
