import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface Location {
  readonly path: string;
  readonly search: string;
}

interface RouterValue extends Location {
  navigate(to: string, options?: { replace?: boolean }): void;
  /** Changes the query string without adding a history entry. */
  setQuery(key: string, value: string | null): void;
}

const RouterContext = createContext<RouterValue | null>(null);

export function RouterProvider({ children }: { children: ReactNode }): JSX.Element {
  const [location, setLocation] = useState<Location>(() => ({
    path: window.location.pathname,
    search: window.location.search,
  }));

  useEffect(() => {
    const onPopState = (): void =>
      setLocation({ path: window.location.pathname, search: window.location.search });
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    const url = new URL(to, window.location.origin);
    if (options?.replace) {
      window.history.replaceState(null, '', url);
    } else {
      window.history.pushState(null, '', url);
    }
    setLocation({ path: url.pathname, search: url.search });
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  const setQuery = useCallback((key: string, value: string | null) => {
    const url = new URL(window.location.href);
    if (value === null) {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, value);
    }
    window.history.replaceState(null, '', url);
    setLocation({ path: url.pathname, search: url.search });
  }, []);

  const value = useMemo<RouterValue>(
    () => ({ ...location, navigate, setQuery }),
    [location, navigate, setQuery],
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error('useRouter used outside the router');
  return value;
}

export function useQueryParam(key: string): string | null {
  const { search } = useRouter();
  return useMemo(() => new URLSearchParams(search).get(key), [search, key]);
}

export function Link({
  to,
  className,
  children,
  ...rest
}: {
  to: string;
  className?: string;
  children: ReactNode;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>): JSX.Element {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.button !== 0) return;
        event.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

export function signInTo(returnTo: string): void {
  window.location.assign(`/auth/login?return_to=${encodeURIComponent(returnTo)}`);
}
