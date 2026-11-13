import { Store, useStore } from "./store";

const here = () => location.pathname + location.search;
const location$ = new Store(here());

addEventListener("popstate", () => location$.set(here()));

export function navigate(url: string, replace = false): void {
  if (url === here()) return;
  if (replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  location$.set(here());
}

export function useLocation(): { path: string; query: URLSearchParams } {
  const full = useStore(location$);
  const at = full.indexOf("?");
  return { path: at < 0 ? full : full.slice(0, at), query: new URLSearchParams(at < 0 ? "" : full.slice(at + 1)) };
}

export function currentQuery(): URLSearchParams {
  return new URLSearchParams(location.search);
}

export function withQuery(path: string, params: Record<string, string | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const text = query.toString().replaceAll("%2C", ",");
  return text ? `${path}?${text}` : path;
}
