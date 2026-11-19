import { useCallback, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

function subscribeLocation(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener("switchyard:navigate", onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener("switchyard:navigate", onChange);
  };
}

const snapshot = (): string => location.pathname + location.search;

export function useLocation(): { path: string; search: URLSearchParams } {
  const full = useSyncExternalStore(subscribeLocation, snapshot);
  const [path, query = ""] = full.split("?") as [string, string?];
  return { path: path.length > 1 ? path.replace(/\/+$/, "") : path, search: new URLSearchParams(query) };
}

export function navigate(to: string, replace = false): void {
  if (to === location.pathname + location.search) return;
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  window.dispatchEvent(new Event("switchyard:navigate"));
}

export function Link({ to, children, ...rest }: { to: string; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">): JSX.Element {
  const onClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      rest.onClick?.(event);
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigate(to);
    },
    [to, rest],
  );
  return (
    <a {...rest} href={to} onClick={onClick}>
      {children}
    </a>
  );
}

export interface RouteDef {
  pattern: string;
  render(params: Record<string, string>): JSX.Element;
}

export function matchRoute(path: string, routes: RouteDef[]): { route: RouteDef; params: Record<string, string> } | null {
  for (const route of routes) {
    const keys: string[] = [];
    const expression = new RegExp("^" + route.pattern.replace(/:([a-z_]+)/g, (_m, key: string) => (keys.push(key), "([^/]+)")) + "$");
    const found = expression.exec(path);
    if (found) return { route, params: Object.fromEntries(keys.map((key, i) => [key, decodeURIComponent(found[i + 1]!)])) };
  }
  return null;
}
