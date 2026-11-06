import { useEffect, useState } from 'react';

export interface Location {
  path: string;
  search: string;
}

function current(): Location {
  return { path: window.location.pathname, search: window.location.search };
}

const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

export function useLocation(): Location {
  const [location, setLocation] = useState<Location>(current);
  useEffect(() => {
    const update = (): void => setLocation(current());
    listeners.add(update);
    window.addEventListener('popstate', update);
    return () => {
      listeners.delete(update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return location;
}

export function navigate(to: string, replace = false): void {
  if (replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  announce();
}
