import { useSyncExternalStore } from 'react';

export type Layout = 'phone' | 'tablet' | 'desk';

// A layout is chosen by width alone: phone under 768 pixels, tablet 768 to 1199, desk 1200 and wider.
const queries = ['(min-width: 768px)', '(min-width: 1200px)'];

function read(): Layout {
  if (window.matchMedia(queries[1] as string).matches) return 'desk';
  return window.matchMedia(queries[0] as string).matches ? 'tablet' : 'phone';
}

function subscribe(listener: () => void): () => void {
  const lists = queries.map((q) => window.matchMedia(q));
  lists.forEach((list) => list.addEventListener('change', listener));
  return () => lists.forEach((list) => list.removeEventListener('change', listener));
}

export const useLayout = (): Layout => useSyncExternalStore(subscribe, read);
