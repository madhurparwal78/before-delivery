// Client routes on the History API: navigation never reloads the page.

import { useEffect, useState } from "react";

const listeners = new Set<() => void>();

export function navigate(to: string, replace = false): void {
  if (to === location.pathname + location.search) return;
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  listeners.forEach((listener) => listener());
}

export function useLocation(): { path: string; search: URLSearchParams } {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const update = (): void => setVersion((v) => v + 1);
    listeners.add(update);
    window.addEventListener("popstate", update);
    return () => {
      listeners.delete(update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return { path: location.pathname, search: new URLSearchParams(location.search) };
}

/** Props for an in-app link: a real href, followed without a reload. */
export function linkTo(to: string, after?: () => void): { href: string; onClick: (event: React.MouseEvent) => void } {
  return {
    href: to,
    onClick: (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      navigate(to);
      after?.();
    },
  };
}
