import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { refetchToken, sendRefetch, tokenIsFresh, type ApiOutcome } from './api.js';

export type LayoutRange = 'compact' | 'medium' | 'wide';

const COMPACT = '(max-width: 767px)';
const WIDE = '(min-width: 1200px)';

function currentRange(): LayoutRange {
  if (window.matchMedia(COMPACT).matches) return 'compact';
  if (window.matchMedia(WIDE).matches) return 'wide';
  return 'medium';
}

export function useLayoutRange(): LayoutRange {
  const [range, setRange] = useState<LayoutRange>(currentRange);
  useEffect(() => {
    const update = (): void => setRange(currentRange());
    const compact = window.matchMedia(COMPACT);
    const wide = window.matchMedia(WIDE);
    compact.addEventListener('change', update);
    wide.addEventListener('change', update);
    update();
    return () => {
      compact.removeEventListener('change', update);
      wide.removeEventListener('change', update);
    };
  }, []);
  return range;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

export const REFRESH_INTERVAL_MS = 10_000;

export interface PolledResource<T> {
  data: T | null;
  missing: boolean;
  reload: () => Promise<void>;
  apply: Dispatch<SetStateAction<T | null>>;
}

/**
 * Periodic refetching that merges into what is on screen and discards any response that
 * was requested before the user's most recent action finished.
 */
export function usePolledResource<T>(path: string | null): PolledResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [missing, setMissing] = useState(false);
  const pathRef = useRef(path);
  pathRef.current = path;

  const reload = useCallback(async () => {
    const target = pathRef.current;
    if (target === null) return;
    const token = refetchToken();
    const outcome: ApiOutcome<T> = await sendRefetch<T>(target);
    if (!tokenIsFresh(token)) return;
    if (pathRef.current !== target) return;
    if (outcome.kind === 'ok') {
      setData(outcome.data);
      setMissing(false);
    } else if (outcome.kind === 'error' && outcome.body.error === 'not_found') {
      setMissing(true);
    }
  }, []);

  useEffect(() => {
    if (path === null) {
      setData(null);
      setMissing(false);
      return;
    }
    setMissing(false);
    void reload();
    const timer = window.setInterval(() => void reload(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [path, reload]);

  return { data, missing, reload, apply: setData };
}

export function useLocationHref(): string {
  const [href, setHref] = useState(() => window.location.pathname + window.location.search);
  useEffect(() => {
    const update = (): void => setHref(window.location.pathname + window.location.search);
    window.addEventListener('popstate', update);
    window.addEventListener('relayline:navigate', update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener('relayline:navigate', update);
    };
  }, []);
  return href;
}

export function navigate(href: string, mode: 'push' | 'replace'): void {
  if (mode === 'push') window.history.pushState(null, '', href);
  else window.history.replaceState(null, '', href);
  window.dispatchEvent(new Event('relayline:navigate'));
}
