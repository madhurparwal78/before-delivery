import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useSyncExternalStore } from 'react';

export function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

export function useReducedMotion(): boolean {
  return useMedia('(prefers-reduced-motion: reduce)');
}

const LIVE_REFRESH_MS = 4000;

// Re-reads a page's data while the tab is visible, and again when it regains focus.
export function useLiveRefresh(refresh: () => void, enabled: boolean): void {
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });
  useEffect(() => {
    if (!enabled) return undefined;
    const tick = () => {
      if (!document.hidden) latest.current();
    };
    const timer = window.setInterval(tick, LIVE_REFRESH_MS);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [enabled]);
}

export type FocusFinder = () => HTMLElement | null;

// Moves focus once the next render has committed the element the finder looks for.
export function useFocusAfterRender(): (finder: FocusFinder) => void {
  const pending = useRef<FocusFinder | null>(null);
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  useLayoutEffect(() => {
    const finder = pending.current;
    if (!finder) return;
    const element = finder();
    if (element) {
      pending.current = null;
      element.focus();
    }
  });
  return useCallback((finder: FocusFinder) => {
    pending.current = finder;
    rerender();
  }, []);
}

export function useTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · Keel Outpost 2026` : 'Keel Outpost 2026';
  }, [title]);
}
