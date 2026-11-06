import { useEffect, useState } from "react";

const NAVIGATE = "hangline:navigate";

/** Client-side navigation that keeps the live regions and data. */
export function navigate(to: string, replace = false): void {
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  window.dispatchEvent(new Event(NAVIGATE));
}

export function useLocation(): { path: string; search: string } {
  const read = () => ({ path: location.pathname, search: location.search });
  const [loc, setLoc] = useState(read);
  useEffect(() => {
    const update = () => setLoc(read());
    window.addEventListener("popstate", update);
    window.addEventListener(NAVIGATE, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(NAVIGATE, update);
    };
  }, []);
  return loc;
}

/** Changes query parameters on the current address without a reload. */
export function setQuery(changes: Record<string, string | null>, mode: "replace" | "push" = "replace"): void {
  const params = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) params.delete(k);
    else params.set(k, v);
  }
  const query = params.toString();
  const to = `${location.pathname}${query ? `?${query}` : ""}`;
  if (to === `${location.pathname}${location.search}`) return;
  if (mode === "push") history.pushState(null, "", to);
  else history.replaceState(null, "", to);
}
