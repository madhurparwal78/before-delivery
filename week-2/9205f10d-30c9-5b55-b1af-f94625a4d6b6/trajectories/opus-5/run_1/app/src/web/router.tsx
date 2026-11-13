import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

interface Location {
  pathname: string;
  search: string;
}

interface NavigateOptions {
  replace?: boolean;
  /** Copy for the destination screen's live region, read once on arrival. */
  flash?: string;
}

interface Navigation extends Location {
  navigate: (to: string, options?: NavigateOptions) => void;
}

const NavigationContext = createContext<Navigation | null>(null);

function currentLocation(): Location {
  return { pathname: window.location.pathname, search: window.location.search };
}

export function Router({ children }: { children: ReactNode }): ReactNode {
  const [location, setLocation] = useState<Location>(currentLocation);

  useEffect(() => {
    const onPopState = (): void => setLocation(currentLocation());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to: string, options?: NavigateOptions): void => {
    const state = options?.flash === undefined ? null : { flash: options.flash };
    if (options?.replace === true) window.history.replaceState(state, '', to);
    else window.history.pushState(state, '', to);
    setLocation(currentLocation());
  }, []);

  return (
    <NavigationContext.Provider value={{ ...location, navigate }}>{children}</NavigationContext.Provider>
  );
}

/** Reads the copy carried by the navigation that opened this screen, once. */
export function takeFlash(): string {
  const state: unknown = window.history.state;
  if (typeof state === 'object' && state !== null && 'flash' in state) {
    const flash = (state as { flash: unknown }).flash;
    if (typeof flash === 'string') {
      window.history.replaceState(null, '', window.location.href);
      return flash;
    }
  }
  return '';
}

export function useNavigation(): Navigation {
  const value = useContext(NavigationContext);
  if (value === null) throw new Error('useNavigation used outside the router');
  return value;
}

type LinkProps = { to: string; children: ReactNode; ref?: React.Ref<HTMLAnchorElement> } & Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  'href'
>;

export function Link({ to, children, ...rest }: LinkProps): ReactNode {
  const { navigate } = useNavigation();
  return (
    <a
      href={to}
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
