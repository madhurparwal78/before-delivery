import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

interface Location { path: string; search: string }
interface Nav { location: Location; navigate: (to: string, replace?: boolean) => void }

const RouterContext = createContext<Nav | null>(null);

function read(): Location {
  return { path: window.location.pathname, search: window.location.search };
}

export function Router({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<Location>(read);
  useEffect(() => {
    const onPop = () => setLocation(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((to: string, replace = false) => {
    if (replace) window.history.replaceState(null, "", to);
    else window.history.pushState(null, "", to);
    setLocation(read());
  }, []);
  const value = useMemo(() => ({ location, navigate }), [location, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): Nav {
  const nav = useContext(RouterContext);
  if (!nav) throw new Error("Router missing");
  return nav;
}

export function Link({ to, onNavigate, children, ...rest }: { to: string; onNavigate?: () => void } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const { navigate } = useRouter();
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    rest.onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
    onNavigate?.();
  };
  return <a {...rest} href={to} onClick={onClick}>{children}</a>;
}
