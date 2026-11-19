import { useSyncExternalStore, type ReactElement } from "react";

const listeners = new Set<() => void>();
let clientNavigations = 0;

function emit(): void {
  listeners.forEach((listener) => listener());
}

window.addEventListener("popstate", () => {
  clientNavigations += 1;
  emit();
});

export function navigate(to: string, replace = false): void {
  if (replace) window.history.replaceState(null, "", to);
  else {
    window.history.pushState(null, "", to);
    clientNavigations += 1;
  }
  emit();
}

/** True once the page has changed by in-app navigation (so headings take focus). */
export function hasNavigated(): boolean {
  return clientNavigations > 0;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): string {
  return window.location.pathname + window.location.search;
}

interface Location {
  path: string;
  search: URLSearchParams;
}

export function useLocation(): Location {
  const href = useSyncExternalStore(subscribe, snapshot);
  const at = href.indexOf("?");
  return {
    path: at < 0 ? href : href.slice(0, at),
    search: new URLSearchParams(at < 0 ? "" : href.slice(at + 1)),
  };
}

/** Replace the query string without adding a history entry. */
export function replaceQuery(params: URLSearchParams): void {
  const query = params.toString();
  navigate(window.location.pathname + (query ? `?${query}` : ""), true);
}

export function safeNext(value: string | null): string {
  return value && /^\/(?![/\\])/.test(value) ? value : "/";
}

export function Link({ href, onClick, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }): ReactElement {
  return (
    <a
      href={href}
      {...rest}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}
