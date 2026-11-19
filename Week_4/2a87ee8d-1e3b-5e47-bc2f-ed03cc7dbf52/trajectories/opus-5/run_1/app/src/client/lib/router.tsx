import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

interface RouterValue {
  readonly path: string;
  readonly navigate: (to: string) => void;
}

const RouterContext = createContext<RouterValue>({ path: '/', navigate: () => undefined });

export function RouterProvider({ children }: { children: ReactNode }): JSX.Element {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPopState = (): void => setPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to: string) => {
    if (to === window.location.pathname) return;
    window.history.pushState(null, '', to);
    setPath(to);
  }, []);

  const value = useMemo(() => ({ path, navigate }), [path, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  return useContext(RouterContext);
}

export function Link({
  to,
  children,
  className,
  ...rest
}: { to: string; children: ReactNode; className?: string } & Record<string, unknown>): JSX.Element {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
