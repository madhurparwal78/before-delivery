import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';

interface Location {
  path: string;
  search: string;
}

interface RouterValue extends Location {
  navigate: (to: string, options?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

const read = (): Location => ({ path: window.location.pathname, search: window.location.search });

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<Location>(read);
  useEffect(() => {
    const onPop = () => setLocation(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    if (options?.replace) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
    setLocation(read());
  }, []);
  const value = useMemo(() => ({ ...location, navigate }), [location, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error('RouterProvider is missing');
  return value;
}

/** An in-app link: a real anchor, navigated without a reload on a plain click. */
export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const { navigate } = useRouter();
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return <a {...rest} href={to} onClick={handle} />;
}
