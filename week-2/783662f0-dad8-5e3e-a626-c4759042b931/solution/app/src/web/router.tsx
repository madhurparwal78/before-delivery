import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';

interface RouterValue {
  readonly path: string;
  readonly search: string;
  readonly go: (to: string, options?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterValue>({
  path: '/',
  search: '',
  go: () => undefined,
});

export function RouterProvider({ children }: { children: ReactNode }): ReactNode {
  const [location, setLocation] = useState(() => ({
    path: window.location.pathname,
    search: window.location.search,
  }));

  useEffect(() => {
    const onPop = (): void => {
      setLocation({ path: window.location.pathname, search: window.location.search });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = useCallback((to: string, options?: { replace?: boolean }) => {
    const url = new URL(to, window.location.origin);
    if (options?.replace === true) window.history.replaceState({}, '', url);
    else window.history.pushState({}, '', url);
    setLocation({ path: url.pathname, search: url.search });
  }, []);

  return (
    <RouterContext.Provider value={{ path: location.path, search: location.search, go }}>
      {children}
    </RouterContext.Provider>
  );
}

export const useRouter = (): RouterValue => useContext(RouterContext);

export function Link({
  to,
  children,
  ...rest
}: { to: string; children: ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>): ReactNode {
  const { go } = useRouter();
  return (
    <a
      href={to}
      {...rest}
      onClick={(event) => {
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.button !== 0) return;
        event.preventDefault();
        go(to);
      }}
    >
      {children}
    </a>
  );
}

interface Match {
  readonly name: string;
  readonly params: Record<string, string>;
}

const ROUTES: readonly { name: string; pattern: string }[] = [
  { name: 'sign-in', pattern: '/sign-in' },
  { name: 'join', pattern: '/join/:token' },
  { name: 'help', pattern: '/help' },
  { name: 'servers', pattern: '/servers' },
  { name: 'new-server', pattern: '/servers/new' },
  { name: 'billing', pattern: '/s/:slug/billing' },
  { name: 'admin', pattern: '/s/:slug/admin' },
  { name: 'roster', pattern: '/s/:slug/roster' },
  { name: 'coins', pattern: '/s/:slug/coins' },
  { name: 'purchase', pattern: '/s/:slug/coins/:purchaseId' },
  { name: 'leaderboards', pattern: '/s/:slug/leaderboards' },
  { name: 'games', pattern: '/s/:slug/games' },
  { name: 'replay', pattern: '/s/:slug/games/:gameId' },
  { name: 'table', pattern: '/s/:slug/w/:world/t/:tableId' },
  { name: 'world', pattern: '/s/:slug/w/:world' },
];

export function matchRoute(path: string): Match {
  const parts = path.replace(/\/+$/, '').split('/').filter((part) => part !== '');
  for (const route of ROUTES) {
    const wanted = route.pattern.split('/').filter((part) => part !== '');
    if (wanted.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < wanted.length; i += 1) {
      const segment = wanted[i];
      if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(parts[i]);
      else if (segment !== parts[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return { name: route.name, params };
  }
  if (parts.length === 0) return { name: 'servers', params: {} };
  return { name: 'not-found', params: {} };
}

export const PUBLIC_ROUTES: readonly string[] = ['sign-in', 'join', 'help'];
