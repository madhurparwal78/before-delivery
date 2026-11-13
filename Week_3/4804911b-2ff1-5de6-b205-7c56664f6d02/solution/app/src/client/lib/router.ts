import { useLayoutEffect, useState } from "preact/hooks";

type Route =
  | { name: "home" }
  | { name: "notice"; number: string }
  | { name: "sign-in" }
  | { name: "stockist" }
  | { name: "editor" }
  | { name: "missing" };

function parseRoute(path: string): Route {
  const p = path.replace(/\/+$/, "") || "/";
  if (p === "/") return { name: "home" };
  if (p === "/sign-in") return { name: "sign-in" };
  if (p === "/stockist") return { name: "stockist" };
  if (p === "/editor") return { name: "editor" };
  const m = /^\/notices\/([^/]+)$/.exec(p);
  if (m) return { name: "notice", number: decodeURIComponent(m[1]!) };
  return { name: "missing" };
}

const listeners = new Set<() => void>();
const bump = () => listeners.forEach((l) => l());
addEventListener("popstate", bump);

export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  if (opts.replace) history.replaceState(history.state, "", path);
  else history.pushState({}, "", path);
  bump();
}

export function useRoute(): Route {
  const [path, setPath] = useState(location.pathname);
  useLayoutEffect(() => {
    const on = () => setPath(location.pathname);
    listeners.add(on);
    on();
    return () => void listeners.delete(on);
  }, []);
  return parseRoute(path);
}

/** Internal links: keep the single-page app, let modified clicks through. */
export function followLink(e: MouseEvent, path: string): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  saveScroll();
  navigate(path);
  window.scrollTo(0, 0);
}

export function saveScroll(): void {
  history.replaceState({ ...(history.state as object | null), scrollY: Math.round(scrollY) }, "");
}
