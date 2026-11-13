import { useEffect, useState } from 'preact/hooks';

export interface Location {
  pathname: string;
  search: string;
}

const LOCATION_EVENT = 'ourlet:location';

function current(): Location {
  return { pathname: window.location.pathname, search: window.location.search };
}

/** One new history entry, so Back and Forward step through the choices made. */
export function go(to: string): void {
  if (to === `${window.location.pathname}${window.location.search}`) return;
  window.history.pushState(null, '', to);
  window.dispatchEvent(new Event(LOCATION_EVENT));
}

/** Replaces the current entry, for a redirect that should not be stepped back into. */
export function replace(to: string): void {
  window.history.replaceState(null, '', to);
  window.dispatchEvent(new Event(LOCATION_EVENT));
}

export function useLocation(): Location {
  const [location, setLocation] = useState<Location>(current);
  useEffect(() => {
    const update = (): void => setLocation(current());
    window.addEventListener('popstate', update);
    window.addEventListener(LOCATION_EVENT, update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(LOCATION_EVENT, update);
    };
  }, []);
  return location;
}

export function hrefOf(location: Location): string {
  return `${location.pathname}${location.search}`;
}
