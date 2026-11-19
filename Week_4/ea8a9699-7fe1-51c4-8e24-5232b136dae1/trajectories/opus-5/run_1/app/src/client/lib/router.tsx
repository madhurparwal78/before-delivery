import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface Location {
  pathname: string;
  search: string;
}

export interface NavigateOptions {
  replace?: boolean;
}

interface RouterValue {
  location: Location;
  navigate: (to: string, options?: NavigateOptions) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

function readLocation(): Location {
  return { pathname: window.location.pathname, search: window.location.search };
}

export function RouterProvider({ children }: { children: ReactNode }): JSX.Element {
  const [location, setLocation] = useState<Location>(readLocation);

  useEffect(() => {
    const onPopState = (): void => setLocation(readLocation());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to: string, options: NavigateOptions = {}) => {
    if (options.replace === true) {
      window.history.replaceState(null, '', to);
    } else {
      window.history.pushState(null, '', to);
    }
    setLocation(readLocation());
  }, []);

  const value = useMemo(() => ({ location, navigate }), [location, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (value === null) {
    throw new Error('Router is not mounted');
  }
  return value;
}

export function useQuery(): URLSearchParams {
  const { location } = useRouter();
  return useMemo(() => new URLSearchParams(location.search), [location.search]);
}

export function Link({
  to,
  children,
  ...rest
}: { to: string; children: ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>): JSX.Element {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      {...rest}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
          return;
        }
        event.preventDefault();
        rest.onClick?.(event);
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
