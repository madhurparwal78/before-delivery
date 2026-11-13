import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Route =
  | { name: 'index' }
  | { name: 'chapter'; number: number }
  | { name: 'timeline' }
  | { name: 'sources' }
  | { name: 'sessions' }
  | { name: 'support' }
  | { name: 'account' }
  | { name: 'studio' }
  | { name: 'box-office' }
  | { name: 'not-found' };

export function parseRoute(pathname: string): Route {
  if (pathname === '/') return { name: 'index' };
  const chapter = /^\/chapters\/(\d+)$/.exec(pathname);
  if (chapter) return { name: 'chapter', number: Number(chapter[1]) };
  switch (pathname) {
    case '/timeline':
      return { name: 'timeline' };
    case '/sources':
      return { name: 'sources' };
    case '/sessions':
      return { name: 'sessions' };
    case '/support':
      return { name: 'support' };
    case '/account':
      return { name: 'account' };
    case '/studio':
      return { name: 'studio' };
    case '/box-office':
      return { name: 'box-office' };
    default:
      return { name: 'not-found' };
  }
}

interface RouterValue {
  route: Route;
  search: URLSearchParams;
  navigate: (to: string, options?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

export function RouterProvider({ children }: { children: ReactNode }): JSX.Element {
  const [location, setLocation] = useState(() => `${window.location.pathname}${window.location.search}`);

  useEffect(() => {
    const onPop = (): void => setLocation(`${window.location.pathname}${window.location.search}`);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    if (options?.replace) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
    setLocation(`${window.location.pathname}${window.location.search}`);
  }, []);

  const value = useMemo<RouterValue>(() => {
    const [pathname, query = ''] = location.split('?');
    return {
      route: parseRoute(pathname as string),
      search: new URLSearchParams(query),
      navigate,
    };
  }, [location, navigate]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error('Router is missing');
  return value;
}

export interface LinkProps {
  to: string;
  children: ReactNode;
  className?: string;
  'aria-current'?: 'page';
  'aria-label'?: string;
  'data-numeral'?: string;
  onNavigate?: () => void;
}

export function Link({ to, children, onNavigate, ...rest }: LinkProps): JSX.Element {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      {...rest}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        onNavigate?.();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
