// A small history router: in-place navigation for same-origin links, and the location as a Preact hook.
import { useEffect, useState } from "preact/hooks";

type Place = { path: string; search: string; hash: string };
type Listener = (place: Place) => void;
const listeners = new Set<Listener>();

const current = (): Place => ({ path: location.pathname.replace(/\/+$/, "") || "/", search: location.search, hash: location.hash });

function announce(): void {
  const place = current();
  for (const listener of listeners) listener(place);
}

/** Moves to `to` without a page load; a hash scrolls to its section once the page has rendered. */
export function navigate(to: string, replace = false): void {
  const url = new URL(to, location.href);
  if (replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  announce();
  if (!url.hash) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
}

export function usePlace(): Place {
  const [place, setPlace] = useState(current);
  useEffect(() => {
    listeners.add(setPlace);
    return () => void listeners.delete(setPlace);
  }, []);
  return place;
}

/** Same-origin page links (not API, not downloads, not modified clicks) navigate in place. */
export function interceptLinks(): void {
  history.scrollRestoration = "manual";
  window.addEventListener("popstate", announce);
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest("a");
    if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
    const url = new URL(anchor.href, location.href);
    if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
    event.preventDefault();
    if (url.pathname === location.pathname && url.hash) {
      history.pushState(null, "", url);
      document.getElementById(url.hash.slice(1))?.scrollIntoView({ block: "start" });
      return;
    }
    navigate(url.pathname + url.search + url.hash);
  });
}
