import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api.js';

export interface Loaded<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  /** Fetches again and replaces the data; the old data stays visible meanwhile. */
  reload: () => Promise<void>;
  setData: (update: T | null | ((previous: T | null) => T | null)) => void;
}

/** Loads `fetcher()` whenever `key` changes. The latest call wins. */
export function useLoad<T>(fetcher: () => Promise<T>, key: string): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(fetcher);
  latest.current = fetcher;
  const counter = useRef(0);

  const run = useCallback(async () => {
    const mine = ++counter.current;
    try {
      const result = await latest.current();
      if (mine !== counter.current) return;
      setData(result);
      setError(null);
    } catch (caught) {
      if (mine !== counter.current) return;
      setError(caught instanceof ApiError ? caught : new ApiError(0, 'UNKNOWN', 'Something went wrong'));
    } finally {
      if (mine === counter.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setData(null);
    setError(null);
    setLoading(true);
    void run();
    return () => { counter.current++; };
  }, [key, run]);

  return { data, error, loading, reload: run, setData };
}

export const prefersReducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
