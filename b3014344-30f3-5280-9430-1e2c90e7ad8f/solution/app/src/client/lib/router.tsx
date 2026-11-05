import { createContext, useContext, useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

// History-API routing for one client app. The server already set each first load's status.

interface Location {
  path: string;
  hash: string;
  search: string;
  /** Increments on every navigation, so pages can react to back/forward. */
  key: number;
  state: unknown;
}

const RouterContext = createContext<Location>({ path: "/", hash: "", search: "", key: 0, state: null });

let counter = 0;
const listeners = new Set<() => void>();

function current(): Location {
  return { path: window.location.pathname, hash: window.location.hash, search: window.location.search, key: counter, state: history.state };
}

export function navigate(to: string, options: { replace?: boolean; state?: unknown } = {}): void {
  counter += 1;
  if (options.replace) history.replaceState(options.state ?? null, "", to);
  else history.pushState(options.state ?? null, "", to);
  listeners.forEach((listener) => listener());
}

export function Router({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(current);
  useEffect(() => {
    const update = () => setLocation(current());
    const pop = () => {
      counter += 1;
      update();
    };
    listeners.add(update);
    window.addEventListener("popstate", pop);
    return () => {
      listeners.delete(update);
      window.removeEventListener("popstate", pop);
    };
  }, []);
  return <RouterContext.Provider value={location}>{children}</RouterContext.Provider>;
}

export function useLocation(): Location {
  return useContext(RouterContext);
}

/** Scrolls a hash target into view after a navigation such as `/#pricing`. */
function scrollToHash(hash: string): void {
  const target = hash ? document.getElementById(hash.slice(1)) : null;
  if (target) target.scrollIntoView({ block: "start" });
}

export function Link({ href, onClick, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin || href.startsWith("mailto:")) return;
    event.preventDefault();
    if (url.pathname === window.location.pathname && url.hash) {
      history.replaceState(history.state, "", url.pathname + url.search + url.hash);
      scrollToHash(url.hash);
      return;
    }
    navigate(url.pathname + url.search + url.hash);
    if (url.hash) requestAnimationFrame(() => scrollToHash(url.hash));
    else window.scrollTo(0, 0);
  };
  return (
    <a href={href} onClick={follow} {...rest}>
      {children}
    </a>
  );
}
