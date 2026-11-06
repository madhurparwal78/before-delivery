import { useEffect, useRef, useState } from 'react';

export function useMediaQuery(query: string): boolean {
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

export type Layout = 'wide' | 'stacked' | 'sheet';

export function useLayout(): Layout {
  const wide = useMediaQuery('(min-width: 1200px)');
  const sheet = useMediaQuery('(max-width: 699px)');
  return sheet ? 'sheet' : wide ? 'wide' : 'stacked';
}

export function useReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

const COUNT_MS = 450;

/**
 * Counts the visible numeral from its previous value to the new server value, reaching the
 * exact value within half a second. With reduced motion the change is instant.
 */
export function useCountingValue(target: number, reduced: boolean): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (reduced) {
      fromRef.current = target;
      setValue(target);
      return;
    }
    const from = fromRef.current;
    if (from === target) {
      setValue(target);
      return;
    }
    const started = performance.now();
    const step = (now: number): void => {
      const progress = Math.min(1, (now - started) / COUNT_MS);
      const eased = 1 - (1 - progress) ** 3;
      const next = from + (target - from) * eased;
      setValue(progress >= 1 ? target : next);
      if (progress < 1) frameRef.current = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      fromRef.current = target;
    };
  }, [target, reduced]);

  return value;
}

const REFRESH_MS = 15_000;

/** Refetches every 15 seconds while the tab is visible, and once more when it becomes visible. */
export function useRefresh(refresh: () => void, paused: boolean): void {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') latest.current();
    }, REFRESH_MS);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') latest.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [paused]);
}
