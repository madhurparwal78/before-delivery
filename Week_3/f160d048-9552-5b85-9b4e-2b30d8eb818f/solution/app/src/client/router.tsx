import { useCallback, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
window.addEventListener("popstate", notify);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = (): string => `${location.pathname}${location.search}`;

export function navigate(to: string, replace = false): void {
  if (to === snapshot()) return;
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  notify();
  window.scrollTo(0, 0);
}

/** Changes the address without a navigation: used for filters and tabs, which keep state in the URL. */
export function setAddress(to: string, replace: boolean): void {
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  notify();
}

export function useLocation(): { path: string; query: URLSearchParams } {
  const current = useSyncExternalStore(subscribe, snapshot);
  const [path = "/", search = ""] = current.split("?");
  return { path, query: new URLSearchParams(search) };
}

export function matchPath(pattern: string, path: string): Record<string, string> | undefined {
  const names: string[] = [];
  const source = pattern.replace(/:(\w+)/g, (_, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  const match = new RegExp(`^${source}/?$`).exec(path);
  if (!match) return undefined;
  return Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(match[index + 1] ?? "")]));
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { to: string; children?: ReactNode; onNavigate?: () => void };

export function Link({ to, children, onClick, onNavigate, ...rest }: LinkProps) {
  const handle = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event);
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      onNavigate?.();
      navigate(to);
    },
    [onClick, onNavigate, to],
  );
  return (
    <a href={to} onClick={handle} {...rest}>
      {children}
    </a>
  );
}
