import { createContext, useContext, useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';

// A path plus its query, kept in the browser history.
function currentLocation(): string {
  return window.location.pathname + window.location.search;
}

const listeners = new Set<() => void>();

export function navigate(to: string, replace = false): void {
  if (to === currentLocation()) return;
  window.history[replace ? 'replaceState' : 'pushState']({}, '', to);
  listeners.forEach((listener) => listener());
}

const LocationContext = createContext<string>('/');

export function Router({ children }: { children: ReactNode }): ReactNode {
  const [location, setLocation] = useState(currentLocation());
  useEffect(() => {
    const update = (): void => setLocation(currentLocation());
    listeners.add(update);
    window.addEventListener('popstate', update);
    return () => {
      listeners.delete(update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return <LocationContext.Provider value={location}>{children}</LocationContext.Provider>;
}

export function useLocation(): { path: string; query: URLSearchParams } {
  const location = useContext(LocationContext);
  const [path = '/', search = ''] = location.split('?');
  return { path, query: new URLSearchParams(search) };
}

export function Link({ to, onClick, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>): ReactNode {
  const handle = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest} />;
}
