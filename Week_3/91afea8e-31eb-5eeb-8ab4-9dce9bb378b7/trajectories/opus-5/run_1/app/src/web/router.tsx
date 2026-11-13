/** A small history router: the address bar is the state. */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

type RouterValue = {
  path: string;
  search: string;
  navigate: (to: string, options?: { replace?: boolean }) => void;
};

const RouterContext = createContext<RouterValue>({
  path: '/',
  search: '',
  navigate: () => undefined,
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

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    const url = new URL(to, window.location.origin);
    const apply = (): void => {
      if (options?.replace === true) {
        window.history.replaceState({}, '', url);
      } else {
        window.history.pushState({}, '', url);
      }
      setLocation({ path: url.pathname, search: url.search });
    };
    const transition = (document as Document & {
      startViewTransition?: (
        callback: () => void,
      ) => { ready: Promise<void>; finished: Promise<void> };
    }).startViewTransition;
    if (
      typeof transition === 'function' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      /* A newer navigation cancels this one; those rejections are not errors. */
      const running = transition.call(document, apply);
      running.ready.catch(() => undefined);
      running.finished.catch(() => undefined);
      return;
    }
    apply();
  }, []);

  const value = useMemo<RouterValue>(
    () => ({ path: location.path, search: location.search, navigate }),
    [location.path, location.search, navigate],
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  return useContext(RouterContext);
}

export function Link({
  to,
  children,
  className,
  ariaLabel,
  disabled,
  onNavigate,
}: {
  to: string;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  onNavigate?: () => void;
}): ReactNode {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      className={className}
      aria-label={ariaLabel}
      aria-disabled={disabled === true ? 'true' : undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        onNavigate?.();
        if (disabled === true) return;
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

export function currentAddress(): string {
  return `${window.location.pathname}${window.location.search}`;
}
