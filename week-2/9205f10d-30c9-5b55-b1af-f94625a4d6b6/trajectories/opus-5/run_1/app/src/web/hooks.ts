import { useCallback, useEffect, useRef, useState } from 'react';
import { RequestFailed } from './api.js';

const REFRESH_MS = 10_000;

export interface Resource<Data> {
  data: Data | null;
  error: RequestFailed | null;
  refresh: () => void;
}

/**
 * Re-reads from the server every ten seconds and on demand, and keeps the last data on
 * screen when a refresh finds the record no longer readable.
 */
export function usePolled<Data>(load: () => Promise<Data>, keys: readonly unknown[]): Resource<Data> {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<RequestFailed | null>(null);
  const serialised = useRef<string>('');
  const loader = useRef(load);
  loader.current = load;
  const dependency = JSON.stringify(keys);

  const run = useCallback(async (): Promise<void> => {
    try {
      const next = await loader.current();
      const text = JSON.stringify(next);
      if (text !== serialised.current) {
        serialised.current = text;
        setData(next);
      }
      setError(null);
    } catch (failure) {
      if (failure instanceof RequestFailed) setError(failure);
    }
  }, []);

  useEffect(() => {
    serialised.current = '';
    setData(null);
    setError(null);
    void run();
    const timer = window.setInterval(() => void run(), REFRESH_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dependency, run]);

  return { data, error, refresh: () => void run() };
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

/** Filters after a third of a second, or immediately on Enter. */
export function useDebounced(value: string, delay = 333): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
