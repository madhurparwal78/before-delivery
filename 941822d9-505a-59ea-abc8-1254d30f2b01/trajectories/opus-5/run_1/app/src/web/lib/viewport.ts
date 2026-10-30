import { useSyncExternalStore } from 'react';

const WIDE_QUERY = '(min-width: 1024px)';

function subscribe(listener: () => void): () => void {
  const media = window.matchMedia(WIDE_QUERY);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}

function isWide(): boolean {
  return window.matchMedia(WIDE_QUERY).matches;
}

/**
 * Columns are reordered in the DOM rather than with CSS, so reading order, tab order
 * and visual order stay the same at every viewport.
 */
export function useWideLayout(): boolean {
  return useSyncExternalStore(subscribe, isWide, () => true);
}
