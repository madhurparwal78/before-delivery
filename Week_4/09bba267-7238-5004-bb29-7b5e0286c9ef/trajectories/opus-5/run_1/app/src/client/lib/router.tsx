import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface Place {
  readonly pathname: string;
  readonly search: string;
}

interface RouterValue extends Place {
  readonly go: (to: string, options?: { readonly replace?: boolean }) => void;
}

const RouterContext = createContext<RouterValue | undefined>(undefined);

export function Router({ children }: { readonly children: ReactNode }): ReactNode {
  const [place, setPlace] = useState<Place>(() => ({
    pathname: window.location.pathname,
    search: window.location.search,
  }));

  useEffect(() => {
    const onPopState = (): void => {
      setPlace({ pathname: window.location.pathname, search: window.location.search });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const go = useCallback((to: string, options?: { replace?: boolean }) => {
    const url = new URL(to, window.location.origin);
    if (options?.replace === true) window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
    setPlace({ pathname: url.pathname, search: url.search });
  }, []);

  const value = useMemo(() => ({ ...place, go }), [place, go]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (value === undefined) throw new Error('useRouter needs a Router');
  return value;
}

export function Link({
  to,
  children,
  className,
  label,
}: {
  readonly to: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly label?: string;
}): ReactNode {
  const { go } = useRouter();
  return (
    <a
      href={to}
      className={className}
      aria-label={label}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        go(to);
      }}
    >
      {children}
    </a>
  );
}
