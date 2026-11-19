import { useSyncExternalStore } from 'react';

type LayoutName = 'phone' | 'tablet' | 'desktop';

const PHONE_BELOW = 768;
const DESKTOP_FROM = 1200;

const layoutOf = (width: number): LayoutName => (width < PHONE_BELOW ? 'phone' : width < DESKTOP_FROM ? 'tablet' : 'desktop');

function subscribe(listener: () => void): () => void {
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
}

/** The layout for the viewport width, read synchronously on every resize (never from a timer). */
export const useMediaLayout = (): LayoutName => useSyncExternalStore(subscribe, () => layoutOf(window.innerWidth));
