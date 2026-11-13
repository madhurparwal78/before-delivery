import { createStore, useSelect } from "./store";

interface Location {
  path: string;
  search: string;
}

const location = createStore<Location>({ path: window.location.pathname, search: window.location.search });

function read(): Location {
  return { path: window.location.pathname, search: window.location.search };
}

window.addEventListener("popstate", () => location.set(read()));

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const target = new URL(to, window.location.origin);
  const same = target.pathname === window.location.pathname && target.search === window.location.search;
  if (options.replace || same) window.history.replaceState(null, "", target.pathname + target.search);
  else window.history.pushState(null, "", target.pathname + target.search);
  location.set(read());
  window.scrollTo(0, 0);
}

export function useLocation(): Location {
  const path = useSelect(location, (l) => l.path);
  const search = useSelect(location, (l) => l.search);
  return { path, search };
}

export function currentLocation(): Location {
  return location.get();
}

export function currentPathAndQuery(): string {
  const l = location.get();
  return l.path + l.search;
}

/** Same-document navigation for plain left clicks on in-app links. */
export function interceptLinks(): void {
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest("a");
    if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
    const href = anchor.getAttribute("href");
    if (!href || !href.startsWith("/") || href.startsWith("//") || href.startsWith("/api/")) return;
    event.preventDefault();
    navigate(href);
  });
}

/** The one rule for `next`: a path on this origin that is not the sign-in or sign-up screen. */
export function safeNext(raw: string | null): string {
  const fallback = "/tonight";
  if (!raw) return fallback;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return fallback;
  }
  if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.startsWith("/\\")) return fallback;
  const pathOnly = decoded.split(/[?#]/)[0] ?? "";
  if (pathOnly === "/signin" || pathOnly === "/signup") return fallback;
  return decoded;
}
