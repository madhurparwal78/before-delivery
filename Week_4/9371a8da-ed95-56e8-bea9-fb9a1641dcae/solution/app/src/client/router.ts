import { useLayoutEffect, useState } from "preact/hooks";

const NAVIGATED = "mg:navigate";

export function currentLocation(): string {
  return location.pathname + location.search;
}

export function navigate(url: string, replace = false): void {
  if (replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  dispatchEvent(new Event(NAVIGATED));
}

export function useLocation(): string {
  const [where, setWhere] = useState(currentLocation);
  useLayoutEffect(() => {
    const update = () => setWhere(currentLocation());
    addEventListener("popstate", update);
    addEventListener(NAVIGATED, update);
    return () => {
      removeEventListener("popstate", update);
      removeEventListener(NAVIGATED, update);
    };
  }, []);
  return where;
}

/** Only same-origin paths: exactly one leading slash, not followed by "/" or "\". */
export function safeNext(next: string | null): string {
  if (!next || next[0] !== "/") return "/";
  const second = next[1];
  if (second === "/" || second === "\\") return "/";
  return next;
}

export function signInFor(where: string): string {
  return where.startsWith("/p/") ? `/signin?next=${encodeURIComponent(where)}` : "/signin";
}

/** The notice shown once on Projects after losing access to a project. */
let accessNotice: string | null = null;
export function setAccessNotice(message: string): void {
  accessNotice = message;
}
export function takeAccessNotice(): string | null {
  const message = accessNotice;
  accessNotice = null;
  return message;
}
