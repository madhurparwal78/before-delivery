import { useEffect, useState } from "react";

const NAVIGATION = "app:navigate";

/** Push a new history entry and tell the app. */
export function navigate(url: string, options: { replace?: boolean } = {}): void {
  if (options.replace === true) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  window.dispatchEvent(new Event(NAVIGATION));
}

/** Rewrite the address bar without adding a history entry or telling the router. */
export function rewriteUrl(url: string): void {
  window.history.replaceState(null, "", url);
}

export function useLocation(): { path: string; search: string } {
  const [location, setLocation] = useState({ path: window.location.pathname, search: window.location.search });
  useEffect(() => {
    const update = (): void => setLocation({ path: window.location.pathname, search: window.location.search });
    window.addEventListener("popstate", update);
    window.addEventListener(NAVIGATION, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(NAVIGATION, update);
    };
  }, []);
  return location;
}

export function queryString(params: Record<string, string | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) if (value !== null && value !== undefined) query.set(name, value);
  const text = query.toString();
  return text === "" ? "" : `?${text}`;
}
