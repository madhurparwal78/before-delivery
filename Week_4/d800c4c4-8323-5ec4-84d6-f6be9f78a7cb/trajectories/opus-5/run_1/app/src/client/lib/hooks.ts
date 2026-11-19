import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiFailed } from './api';

/**
 * Reads a path now and then on an interval. A poll answered with a 401, or one
 * whose data is unchanged, leaves the screen exactly as it was.
 */
export function usePoll<T>(
  path: string | null,
  intervalMs: number,
  enabled = true,
): { data: T | null; reload: () => Promise<void>; replace: (value: T) => void } {
  const [data, setData] = useState<T | null>(null);
  const snapshot = useRef<string>('');
  const livePath = useRef(path);
  livePath.current = path;

  const read = useCallback(async () => {
    const target = livePath.current;
    if (target === null) return;
    try {
      const value = await api.get<T>(target);
      const serialised = JSON.stringify(value);
      if (serialised !== snapshot.current) {
        snapshot.current = serialised;
        setData(value);
      }
    } catch (error) {
      if (error instanceof ApiFailed && (error.status === 401 || error.status === 404)) return;
      if (!(error instanceof ApiFailed)) return;
    }
  }, []);

  const replace = useCallback((value: T) => {
    snapshot.current = JSON.stringify(value);
    setData(value);
  }, []);

  useEffect(() => {
    if (!enabled || path === null) return undefined;
    void read();
    const timer = setInterval(() => void read(), intervalMs);
    return () => clearInterval(timer);
  }, [path, intervalMs, enabled, read]);

  return { data, reload: read, replace };
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const listener = (): void => setReduced(query.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);
  return reduced;
}

export function useViewportWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const listener = (): void => setWidth(window.innerWidth);
    window.addEventListener('resize', listener);
    return () => window.removeEventListener('resize', listener);
  }, []);
  return width;
}

/** Three panes at 1,100 and wider, two from 700, one below 700. */
export function paneCount(width: number): 1 | 2 | 3 {
  if (width >= 1100) return 3;
  if (width >= 700) return 2;
  return 1;
}
