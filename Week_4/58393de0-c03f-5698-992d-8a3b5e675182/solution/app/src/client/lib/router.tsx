import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

interface Location {
  path: string;
  search: URLSearchParams;
}

interface RouterValue {
  location: Location;
  navigate: (to: string, options?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

function read(): Location {
  return { path: window.location.pathname, search: new URLSearchParams(window.location.search) };
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<Location>(read);
  useEffect(() => {
    const onPop = () => setLocation(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    if (options?.replace) window.history.replaceState(null, "", to);
    else window.history.pushState(null, "", to);
    setLocation(read());
    if (!options?.replace) window.scrollTo(0, 0);
  }, []);
  const value = useMemo(() => ({ location, navigate }), [location, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error("useRouter outside RouterProvider");
  return value;
}

/** Matches `/classrooms/:id` style patterns; returns the params or null. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const want = pattern.split("/").filter(Boolean);
  const have = path.split("/").filter(Boolean);
  if (want.length !== have.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i += 1) {
    const w = want[i] as string;
    const h = have[i] as string;
    if (w.startsWith(":")) params[w.slice(1)] = decodeURIComponent(h);
    else if (w !== h) return null;
  }
  return params;
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { to: string };

/** An in-app link: plain hrefs stay real links, a click navigates without a reload. */
export function Link({ to, onClick, children, ...rest }: LinkProps) {
  const { navigate } = useRouter();
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    const sameOrigin = to.startsWith("/") && !to.startsWith("//");
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || !sameOrigin) return;
    const hashOnly = to.startsWith("/#");
    if (hashOnly && window.location.pathname === "/") return;
    event.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest}>{children}</a>;
}
