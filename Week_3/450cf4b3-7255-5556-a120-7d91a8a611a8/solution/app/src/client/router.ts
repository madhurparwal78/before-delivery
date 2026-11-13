// Screens live in the URL. This module parses paths, decides who may see each screen and
// decides where sign-in may return to (adapted from kit/modules/safe_redirect).

import type { Role } from "../shared/api.js";

export type Screen =
  | { name: "signin" }
  | { name: "apply" }
  | { name: "board" }
  | { name: "packs" }
  | { name: "documents" }
  | { name: "tenants" }
  | { name: "tenant"; id: string }
  | { name: "report" }
  | { name: "receipt"; id: string }
  | { name: "home" }
  | { name: "unknown" };

const OPEN_TO: Readonly<Record<Screen["name"], readonly Role[]>> = {
  signin: [],
  apply: [],
  home: ["owner", "shift_lead", "tenant"],
  board: ["owner", "shift_lead", "tenant"],
  packs: ["tenant"],
  documents: ["tenant"],
  tenants: ["owner"],
  tenant: ["owner"],
  report: ["owner"],
  receipt: ["tenant", "owner"],
  unknown: [],
};

export function parseScreen(pathname: string): Screen {
  const parts = pathname.split("/").filter(Boolean);
  const [first, second] = parts;
  if (parts.length === 0) return { name: "home" };
  if (parts.length === 2 && first === "tenants" && second) return { name: "tenant", id: second };
  if (parts.length === 2 && first === "receipt" && second) return { name: "receipt", id: second };
  if (parts.length !== 1) return { name: "unknown" };
  switch (first) {
    case "signin": case "apply": case "board": case "packs": case "documents": case "tenants": case "report":
      return { name: first };
    default:
      return { name: "unknown" };
  }
}

export function openTo(screen: Screen, role: Role): boolean {
  return OPEN_TO[screen.name].includes(role);
}

const UNSAFE_NEXT = /[\\\s\u0000-\u001f\u007f]|%2f|%5c|%09|%0a|%0d/i;

/** `next` as written in the query string, undecoded, alongside its decoded value. */
export function nextParam(search: string): { raw: string; value: string } | null {
  const value = new URLSearchParams(search).get("next");
  const raw = /[?&]next=([^&]*)/.exec(search)?.[1];
  return value === null || raw === undefined ? null : { raw, value };
}

/** A path for `?next=`, readable and free of the sequences the return check refuses. */
export function nextFor(path: string): string {
  return encodeURIComponent(path).replace(/%2F/g, "/").replace(/%3F/g, "?").replace(/%3D/g, "=").replace(/%3A/g, ":");
}

/** Rules 1 to 4 of the return check; the record check (rule 5) needs the server. */
export function nextScreen(next: { raw: string; value: string }, role: Role): Screen | null {
  if (!/^\/[a-z]/.test(next.value) || UNSAFE_NEXT.test(next.value) || UNSAFE_NEXT.test(next.raw)) return null;
  const target = new URL(next.value, location.origin);
  if (target.origin !== location.origin) return null;
  const screen = parseScreen(target.pathname);
  return openTo(screen, role) && screen.name !== "home" ? screen : null;
}

type Listener = () => void;
const listeners = new Set<Listener>();

export function onLocation(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) listener();
}

window.addEventListener("popstate", notify);

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (options.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  notify();
}
