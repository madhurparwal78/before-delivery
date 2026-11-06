// App URLs (brief: Screens and layout, App URLs; Interactions, URLs and history).
import { useEffect, useState } from "react";
import type { Hoof } from "./api";
import { isHoof } from "./format";

export type Route =
  | { kind: "home" }
  | { kind: "sign-in"; next: string }
  | { kind: "day"; id: string }
  | { kind: "horses" }
  | { kind: "horse"; id: string; hoof: Hoof }
  | { kind: "invoices" }
  | { kind: "prices" }
  | { kind: "dashboard" }
  | { kind: "vet"; token: string };

function parseRoute(location: Location): Route {
  const path = location.pathname;
  const query = new URLSearchParams(location.search);
  const one = (prefix: string): string | null => {
    if (!path.startsWith(prefix)) return null;
    const rest = path.slice(prefix.length);
    return rest && !rest.includes("/") ? decodeURIComponent(rest) : null;
  };
  if (path === "/sign-in") return { kind: "sign-in", next: safeReturn(query.get("next")) };
  const day = one("/days/");
  if (day) return { kind: "day", id: day };
  const horse = one("/horses/");
  if (horse) {
    const hoof = query.get("hoof");
    return { kind: "horse", id: horse, hoof: isHoof(hoof) ? hoof : "LF" };
  }
  const vet = one("/vet/");
  if (vet) return { kind: "vet", token: vet };
  if (path === "/horses") return { kind: "horses" };
  if (path === "/invoices") return { kind: "invoices" };
  if (path === "/prices") return { kind: "prices" };
  if (path === "/dashboard") return { kind: "dashboard" };
  return { kind: "home" };
}

const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * A return target is kept only when it is a path on this site starting with a single `/` (adapted from
 * kit/modules/safe_redirect: no `//` or `\`, no control characters, also after percent-decoding).
 */
function safeReturn(target: string | null): string {
  if (!target || target.length > 2048) return "/";
  let text = target;
  for (let round = 0; round < 3; round++) {
    if (CONTROL.test(text) || text.includes("\\") || !text.startsWith("/") || text.startsWith("//")) return "/";
    let decoded: string;
    try {
      decoded = decodeURIComponent(text);
    } catch {
      return "/";
    }
    if (decoded === text) return new URL(target, "http://origin.invalid").origin === "http://origin.invalid" ? target : "/";
    text = decoded;
  }
  return "/";
}

const listeners = new Set<() => void>();

/** Pushes (or replaces) a history entry and re-renders the app at it. */
export function navigate(path: string, replace = false): void {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  listeners.forEach((listener) => listener());
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location));
  useEffect(() => {
    const update = (): void => setRoute(parseRoute(window.location));
    listeners.add(update);
    window.addEventListener("popstate", update);
    return () => {
      listeners.delete(update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return route;
}

export const horsePath = (id: string, hoof: Hoof = "LF"): string => `/horses/${encodeURIComponent(id)}?hoof=${hoof}`;
export const dayPath = (id: string): string => `/days/${encodeURIComponent(id)}`;
