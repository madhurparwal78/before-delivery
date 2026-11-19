import { useSyncExternalStore } from 'react';

const QUERY = '(max-width: 767.98px)';

function subscribe(listener: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}

/** True below 768 pixels, where Filters and Mark details become bottom sheets and dashboards use their phone layout. */
export function usePhone(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches);
}
