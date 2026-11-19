import { type AnchorHTMLAttributes, type MouseEvent, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((listener) => listener());
window.addEventListener("popstate", emit);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const current = (): string => window.location.pathname + window.location.search;

export function navigate(to: string, replace = false): void {
  if (to === current()) return;
  window.history[replace ? "replaceState" : "pushState"](null, "", to);
  emit();
}

export function useLocation(): { path: string; query: URLSearchParams } {
  const href = useSyncExternalStore(subscribe, current);
  const [path, search = ""] = href.split("?");
  return { path, query: new URLSearchParams(search) };
}

export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const follow = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={follow} {...rest} />;
}
