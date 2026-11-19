import { createContext, useContext, useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

// A small history router: pushState navigation, links that stay in the app, and a one-shot message a
// page can hand to the next one (an announcement that must survive the navigation).

interface Location {
  path: string;
  search: URLSearchParams;
}

const read = (): Location => ({ path: window.location.pathname, search: new URLSearchParams(window.location.search) });

const RouterContext = createContext<Location>(read());
const listeners = new Set<() => void>();
let handoff: string | null = null;

export function navigate(to: string, options: { replace?: boolean; message?: string } = {}): void {
  handoff = options.message ?? null;
  if (options.replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.scrollTo({ top: 0, behavior: "instant" });
  listeners.forEach((fn) => fn());
}

/** The message the previous page handed over, read once. */
export function takeHandoff(): string | null {
  const message = handoff;
  handoff = null;
  return message;
}

export function Router({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(read);
  useEffect(() => {
    const update = () => setLocation(read());
    listeners.add(update);
    window.addEventListener("popstate", update);
    return () => {
      listeners.delete(update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return <RouterContext.Provider value={location}>{children}</RouterContext.Provider>;
}

export const useLocation = (): Location => useContext(RouterContext);

export function Link({ to, children, onClick, ...rest }: { to: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (to.startsWith("/auth/") || to.includes("#")) return;
    event.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={follow} {...rest}>
      {children}
    </a>
  );
}

export const signInHref = (returnTo: string): string => `/auth/login?return_to=${encodeURIComponent(returnTo)}`;
