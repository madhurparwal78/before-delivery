import { ReactElement, ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';

interface RouterValue {
  path: string;
  navigate: (to: string, options?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterValue>({ path: '/', navigate: () => undefined });

export function RouterProvider({ children }: { children: ReactNode }): ReactElement {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPop = (): void => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    if (to === window.location.pathname) return;
    if (options?.replace) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
    setPath(to);
  }, []);

  return <RouterContext.Provider value={{ path, navigate }}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  return useContext(RouterContext);
}

export function Link({
  to,
  children,
  className,
}: {
  to: string;
  children: ReactNode;
  className?: string;
}): ReactElement {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
