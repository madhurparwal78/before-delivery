import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ApiError, type ApiFailure } from './api.js';
import { REFRESH_MS } from '../../shared/shop.js';

export interface Polled<T> {
  data: T | null;
  failure: ApiFailure | null;
  reload: () => Promise<void>;
}

/**
 * SR1: every screen re-reads its data from the server every 5 seconds while open. The
 * answer replaces only the data, so an open dialog, the focused control, an expanded row
 * and the scroll position all stay as they were.
 */
export function usePolling<T>(
  load: () => Promise<T>,
  key: string,
  options: { keepWhileLoading?: boolean } = {},
): Polled<T> {
  const [data, setData] = useState<T | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const loader = useRef(load);
  loader.current = load;

  // An answer for an earlier read is dropped, so the screen always shows the latest.
  const generation = useRef(0);

  const read = useCallback(async (): Promise<void> => {
    generation.current += 1;
    const mine = generation.current;
    try {
      const next = await loader.current();
      if (mine !== generation.current) return;
      setData(next);
      setFailure(null);
    } catch (error) {
      if (mine === generation.current && error instanceof ApiError) setFailure(error.failure);
    }
  }, []);

  const keep = options.keepWhileLoading === true;

  useEffect(() => {
    generation.current += 1;
    if (!keep) setData(null);
    setFailure(null);
    void read();
    const timer = setInterval(() => void read(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [key, read, keep]);

  return { data, failure, reload: read };
}
