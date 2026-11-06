/**
 * The browser router. Public page changes run the panel wipe, move focus to the
 * new level-one heading and set the page title.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { DURATION_LONG, prefersReducedMotion } from './motion.js';

export interface Location {
  pathname: string;
  search: string;
}

interface RouterValue extends Location {
  navigate: (to: string, options?: { replace?: boolean }) => void;
  query: URLSearchParams;
}

const RouterContext = createContext<RouterValue | null>(null);

const PUBLIC_PATHS = /^\/(?:$|work|start)/;

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.test(pathname);
}

let transitionTimer: number | undefined;

function runPanelWipe(direction: 'forward' | 'back'): void {
  const root = document.documentElement;
  if (prefersReducedMotion()) return;
  window.clearTimeout(transitionTimer);
  root.dataset.transition = direction;
  transitionTimer = window.setTimeout(() => {
    delete root.dataset.transition;
  }, DURATION_LONG);
}

export function RouterProvider({ children }: { children: ReactNode }): JSX.Element {
  const [location, setLocation] = useState<Location>(() => ({
    pathname: window.location.pathname,
    search: window.location.search,
  }));

  useEffect(() => {
    const onPopState = (): void => {
      const next = { pathname: window.location.pathname, search: window.location.search };
      if (isPublic(next.pathname)) runPanelWipe('back');
      setLocation(next);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    const url = new URL(to, window.location.origin);
    const next = { pathname: url.pathname, search: url.search };
    const samePage = next.pathname === window.location.pathname;
    if (options?.replace) {
      window.history.replaceState(null, '', `${next.pathname}${next.search}`);
    } else {
      window.history.pushState(null, '', `${next.pathname}${next.search}`);
    }
    if (isPublic(next.pathname) && !samePage && !options?.replace) runPanelWipe('forward');
    setLocation(next);
  }, []);

  const value = useMemo<RouterValue>(
    () => ({ ...location, navigate, query: new URLSearchParams(location.search) }),
    [location, navigate],
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error('The router is only available inside RouterProvider');
  return value;
}

/** An internal link that keeps the browser's own modifier-key behaviour. */
export function Link({
  to,
  children,
  className,
  ...rest
}: {
  to: string;
  children: ReactNode;
  className?: string;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>): JSX.Element {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) return;
        if (event.button !== 0) return;
        event.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

export function setPageTitle(title: string): void {
  if (document.title !== title) document.title = title;
}
