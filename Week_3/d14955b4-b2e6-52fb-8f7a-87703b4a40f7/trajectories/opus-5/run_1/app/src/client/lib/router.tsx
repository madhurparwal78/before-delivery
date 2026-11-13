import { useEffect, useState } from 'react';

const NAVIGATION_EVENT = 'hushline:navigate';

export interface Location {
  pathname: string;
  search: string;
}

function current(): Location {
  return { pathname: window.location.pathname, search: window.location.search };
}

export function navigate(url: string, options: { replace?: boolean } = {}): void {
  if (options.replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  window.dispatchEvent(new Event(NAVIGATION_EVENT));
}

export function useLocation(): Location {
  const [location, setLocation] = useState<Location>(current);
  useEffect(() => {
    const update = (): void => setLocation(current());
    window.addEventListener('popstate', update);
    window.addEventListener(NAVIGATION_EVENT, update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(NAVIGATION_EVENT, update);
    };
  }, []);
  return location;
}

export function linkHandler(url: string): (event: React.MouseEvent) => void {
  return (event: React.MouseEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(url);
  };
}
