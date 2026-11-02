import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';

interface RouterValue {
  path: string;
  search: string;
  navigate: (to: string, options?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

export function RouterProvider({ children }: { children: ReactNode }): ReactNode {
  const [location, setLocation] = useState(() => ({
    path: window.location.pathname,
    search: window.location.search,
  }));

  useEffect(() => {
    const onPopState = () =>
      setLocation({ path: window.location.pathname, search: window.location.search });
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    const url = new URL(to, window.location.origin);
    if (options?.replace === true) window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
    setLocation({ path: url.pathname, search: url.search });
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  const value = useMemo(
    () => ({ path: location.path, search: location.search, navigate }),
    [location.path, location.search, navigate],
  );
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (value === null) throw new Error('useRouter needs a RouterProvider');
  return value;
}

/** Matches `/orders/:number/thanks` style patterns against the current path. */
export function matchPath(
  pattern: string,
  path: string,
): Record<string, string> | null {
  const patternParts = pattern.split('/').filter((part) => part !== '');
  const pathParts = path.split('/').filter((part) => part !== '');
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (const [index, part] of patternParts.entries()) {
    const actual = pathParts[index]!;
    if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(actual);
    else if (part !== actual) return null;
  }
  return params;
}

export function Link({
  to,
  children,
  ref,
  ...rest
}: { to: string; children: ReactNode; ref?: Ref<HTMLAnchorElement> } & Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'href' | 'ref'
>): ReactNode {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      ref={ref}
      {...rest}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(to);
        rest.onClick?.(event);
      }}
    >
      {children}
    </a>
  );
}
