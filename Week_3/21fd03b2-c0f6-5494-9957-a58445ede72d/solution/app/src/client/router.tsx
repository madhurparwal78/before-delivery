import { createContext, useContext, useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { matchRoute, type Route } from "../shared/routes";

const listeners = new Set<() => void>();

export function navigate(to: string, replace = false): void {
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  listeners.forEach((l) => l());
}

export function useLocation(): { pathname: string; search: string } {
  const [, tick] = useState(0);
  useEffect(() => {
    const update = (): void => tick((n) => n + 1);
    listeners.add(update);
    window.addEventListener("popstate", update);
    return () => {
      listeners.delete(update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return { pathname: location.pathname, search: location.search };
}

export function useRoute(): Route {
  return matchRoute(useLocation().pathname);
}

export function Link({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }): JSX.Element {
  const onClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    rest.onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || rest.target === "_blank") return;
    event.preventDefault();
    navigate(href);
  };
  return (
    <a {...rest} href={href} onClick={onClick}>
      {children}
    </a>
  );
}

const SessionContext = createContext<{ displayName: string } | null>(null);
const useSession = (): { displayName: string } | null => useContext(SessionContext);
