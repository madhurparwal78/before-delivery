import { useEffect, useState } from 'react';

export interface Location {
  path: string;
  search: string;
}

function read(): Location {
  return { path: window.location.pathname, search: window.location.search };
}

const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

export function navigate(to: string): void {
  if (to === window.location.pathname + window.location.search) return;
  window.history.pushState(null, '', to);
  announce();
}

/** The brush lives in the address without adding history entries. */
export function replaceSearch(search: string): void {
  const next = `${window.location.pathname}${search}`;
  if (next === window.location.pathname + window.location.search) return;
  window.history.replaceState(null, '', next);
  announce();
}

export function useLocation(): Location {
  const [location, setLocation] = useState<Location>(read);
  useEffect(() => {
    const update = (): void => setLocation(read());
    listeners.add(update);
    window.addEventListener('popstate', update);
    return () => {
      listeners.delete(update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return location;
}
