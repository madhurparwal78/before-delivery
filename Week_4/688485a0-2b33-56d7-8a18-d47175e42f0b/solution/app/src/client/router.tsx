import { type AnchorHTMLAttributes, type MouseEvent, type ReactNode, useSyncExternalStore } from "react";

/** A small history-API router: the route table is the table in the brief. */

type Section = "documents" | "queries" | "pipeline" | "indexes" | "schema" | "rules";

export type Route =
  | { name: "landing" | "signup" | "confirm" | "signin" | "projects" | "invites" | "notfound" }
  | { name: "project"; pid: string }
  | { name: "members"; pid: string }
  | { name: "collection"; pid: string; cid: string; section: Section; did: string | null };

const SECTIONS: Record<string, Section> = { queries: "queries", pipeline: "pipeline", indexes: "indexes", schema: "schema", rules: "rules" };
const SIMPLE: Record<string, Route> = {
  "/": { name: "landing" },
  "/signup": { name: "signup" },
  "/confirm": { name: "confirm" },
  "/signin": { name: "signin" },
  "/projects": { name: "projects" },
  "/invites": { name: "invites" },
};

export function parseRoute(path: string): Route {
  const simple = SIMPLE[path];
  if (simple) return simple;
  const parts = path.split("/").filter(Boolean);
  const [head, pid, kind, cid, extra, did] = parts;
  if (head !== "p" || !pid) return { name: "notfound" };
  if (parts.length === 2) return { name: "project", pid };
  if (parts.length === 3 && kind === "members") return { name: "members", pid };
  if (kind !== "c" || !cid) return { name: "notfound" };
  if (parts.length === 4) return { name: "collection", pid, cid, section: "documents", did: null };
  const section = extra ? SECTIONS[extra] : undefined;
  if (parts.length === 5 && section) return { name: "collection", pid, cid, section, did: null };
  if (parts.length === 6 && extra === "d" && did) return { name: "collection", pid, cid, section: "documents", did };
  return { name: "notfound" };
}

export const collectionPath = (pid: string, cid: string, tail = ""): string => `/p/${pid}/c/${cid}${tail}`;

const listeners = new Set<() => void>();

export function navigate(to: string, replace = false): void {
  if (to === location.pathname + location.search) return;
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

const snapshot = (): string => location.pathname + location.search;

export function useLocation(): { path: string; search: URLSearchParams } {
  const full = useSyncExternalStore(subscribe, snapshot);
  const [path = "/", query = ""] = full.split("?");
  return { path, search: new URLSearchParams(query) };
}

export function Link({ to, children, onClick, ...rest }: { to: string; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">): ReactNode {
  const handle = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={handle} {...rest}>
      {children}
    </a>
  );
}
