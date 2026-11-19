/** A small history router: the address is the state, and every navigation goes through `navigate`. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

interface Location {
  path: string;
  search: string;
  state: unknown;
}

interface RouterValue {
  location: Location;
  navigate: (to: string, options?: { replace?: boolean; state?: unknown }) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

const read = (): Location => ({ path: window.location.pathname, search: window.location.search, state: window.history.state });

export function Router({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<Location>(read);
  useEffect(() => {
    const onPop = () => setLocation(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((to: string, options: { replace?: boolean; state?: unknown } = {}) => {
    if (options.replace) window.history.replaceState(options.state ?? null, "", to);
    else window.history.pushState(options.state ?? null, "", to);
    setLocation(read());
  }, []);
  const value = useMemo(() => ({ location, navigate }), [location, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error("Router is missing");
  return value;
}

export function Link({ to, focus, onClick, children, ...rest }: { to: string; focus?: boolean } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { navigate } = useRouter();
  const go = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to, focus ? { state: { focus: true } } : undefined);
  };
  return (
    <a href={to} onClick={go} {...rest}>
      {children}
    </a>
  );
}

/** Only a path that starts with a single slash (or is just `/`) may be resumed after sign-in. */
export function safeResume(value: string | null): string | null {
  if (value === null) return null;
  return value === "/" || (value.startsWith("/") && value[1] !== "/" && value[1] !== "\\") ? value : null;
}
