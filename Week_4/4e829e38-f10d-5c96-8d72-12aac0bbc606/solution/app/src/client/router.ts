import { useLayoutEffect, useState } from "preact/hooks";

interface Route { path: string; query: URLSearchParams }

function current(): Route {
  return { path: location.pathname, query: new URLSearchParams(location.search) };
}

const listeners = new Set<() => void>();

export function navigate(to: string, replace = false): void {
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  listeners.forEach((listener) => listener());
}

export function useRoute(): Route {
  const [route, setRoute] = useState(current);
  useLayoutEffect(() => {
    const update = () => setRoute(current());
    listeners.add(update);
    addEventListener("popstate", update);
    return () => {
      listeners.delete(update);
      removeEventListener("popstate", update);
    };
  }, []);
  return route;
}

/** Same-origin links navigate without a reload. */
export function interceptLinks(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
  const anchor = (event.target as Element).closest("a");
  if (!anchor || anchor.target || anchor.origin !== location.origin || anchor.hasAttribute("download")) return;
  if (anchor.pathname.startsWith("/api/")) return;
  event.preventDefault();
  navigate(anchor.pathname + anchor.search + anchor.hash);
}
