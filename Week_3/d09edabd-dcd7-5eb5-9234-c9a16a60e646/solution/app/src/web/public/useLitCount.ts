import { useSyncExternalStore } from 'react';
import { litCount, scrollProgress } from './tour';

function subscribe(listener: () => void): () => void {
  window.addEventListener('scroll', listener, { passive: true });
  window.addEventListener('resize', listener);
  return () => {
    window.removeEventListener('scroll', listener);
    window.removeEventListener('resize', listener);
  };
}

/** How many of the Vault's cues the current scroll position lights. */
export const useLitCount = (): number => useSyncExternalStore(subscribe, () => litCount(scrollProgress()));
