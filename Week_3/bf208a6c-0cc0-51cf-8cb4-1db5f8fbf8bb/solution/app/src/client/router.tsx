import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";

const listeners = new Set<() => void>();

export function navigate(path: string, replace = false): void {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  for (const listener of listeners) listener();
}

window.addEventListener("popstate", () => {
  for (const listener of listeners) listener();
});

export function useLocation(): { path: string; search: URLSearchParams } {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = (): void => setTick((tick) => tick + 1);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);
  return { path: location.pathname, search: new URLSearchParams(location.search) };
}

export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const follow = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={follow} {...rest} />;
}

/** A `next` parameter may only name a path on this site. */
export const safeNext = (value: string | null): string => (value && /^\/(?![/\\])/.test(value) ? value : "/");
