import { useEffect, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

// A small History API router: the address is the state of the catalogue, so every
// navigation says whether it adds a history entry or replaces the current one.

const listeners = new Set<() => void>();
let current = window.location.pathname + window.location.search;

function emit(): void {
  current = window.location.pathname + window.location.search;
  listeners.forEach((l) => l());
}

window.addEventListener("popstate", emit);

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (to === window.location.pathname + window.location.search) return;
  if (options.replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current `pathname + search`. */
export function useLocation(): string {
  return useSyncExternalStore(subscribe, () => current);
}

export function useParams(): URLSearchParams {
  const location = useLocation();
  return new URLSearchParams(location.split("?")[1] ?? "");
}

export function usePath(): string {
  return useLocation().split("?")[0] ?? "/";
}

/** Builds `path?query`, leaving out empty values. */
export function withQuery(path: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, value);
  }
  const text = query.toString().replace(/%2C/g, ",");
  return text ? `${path}?${text}` : path;
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; replace?: boolean };

export function Link({ href, replace, onClick, children, ...rest }: LinkProps): ReactNode {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    if (rest.target && rest.target !== "_self") return;
    if (!href.startsWith("/") || href.startsWith("/api/") || href.startsWith("/media/")) return;
    event.preventDefault();
    navigate(href, { replace });
  };
  return (
    <a href={href} onClick={handle} {...rest}>
      {children}
    </a>
  );
}

/** Scrolls to the top when the path (not the query) changes. */
export function ScrollToTop(): null {
  const path = usePath();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [path]);
  return null;
}
