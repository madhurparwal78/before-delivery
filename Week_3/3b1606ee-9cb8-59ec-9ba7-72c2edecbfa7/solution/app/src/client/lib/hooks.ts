import { useCallback, useSyncExternalStore } from 'react';

function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

type Size = 'phone' | 'tablet' | 'desktop';

/** The three published layouts; the switch points are exactly 768 and 1200 pixels. */
export function useSize(): Size {
  const twoPane = useMedia('(min-width: 768px)');
  const threePane = useMedia('(min-width: 1200px)');
  return threePane ? 'desktop' : twoPane ? 'tablet' : 'phone';
}

export const useReducedMotion = (): boolean => useMedia('(prefers-reduced-motion: reduce)');

export const prefersReducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
