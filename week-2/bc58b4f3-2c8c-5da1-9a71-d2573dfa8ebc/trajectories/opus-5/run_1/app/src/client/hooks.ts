import { useCallback, useEffect, useRef, useState } from 'react';
import { REFRESH_INTERVAL_MS } from '../shared/contract.js';

export interface Polled<T> {
  data: T | null;
  failed: boolean;
  refresh: () => Promise<void>;
}

/** Keeps a screen in step with the server by polling it; no stream is held open. */
export function usePoll<T>(load: () => Promise<T>, dependency: string = ''): Polled<T> {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const loader = useRef(load);
  loader.current = load;

  const refresh = useCallback(async () => {
    try {
      setData(await loader.current());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh, dependency]);

  return { data, failed, refresh };
}

export function useViewportBelow(pixels: number): boolean {
  const [below, setBelow] = useState(() => window.innerWidth < pixels);
  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${pixels - 1}px)`);
    const update = (): void => setBelow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [pixels]);
  return below;
}
