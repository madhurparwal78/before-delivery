import { useSyncExternalStore } from 'react';

export type MediaLayout = 'phone' | 'tablet' | 'desk';

const PHONE_QUERY = '(max-width: 767.98px)';
const DESK_QUERY = '(min-width: 1280px)';

function currentLayout(): MediaLayout {
  if (window.matchMedia(PHONE_QUERY).matches) return 'phone';
  return window.matchMedia(DESK_QUERY).matches ? 'desk' : 'tablet';
}

function subscribe(onChange: () => void): () => void {
  const lists = [window.matchMedia(PHONE_QUERY), window.matchMedia(DESK_QUERY)];
  for (const list of lists) list.addEventListener('change', onChange);
  return () => {
    for (const list of lists) list.removeEventListener('change', onChange);
  };
}

/** The published breakpoint the window is in right now; re-renders when it changes. */
export function useMediaLayout(): MediaLayout {
  return useSyncExternalStore(subscribe, currentLayout);
}
