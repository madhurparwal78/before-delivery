// The address is the state (brief: Interactions, Address state). Each user change pushes exactly one entry.
import { useSyncExternalStore } from "react";
import { SORT_KEYS, type SortKey } from "../shared/api";

const listeners = new Set<() => void>();
let snapshot = location.pathname + location.search;

function changed(): void {
  const next = location.pathname + location.search;
  if (next === snapshot) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

addEventListener("popstate", changed);

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (to === location.pathname + location.search) return;
  if (options.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  changed();
}

export function useLocation(): URL {
  const href = useSyncExternalStore((l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, () => snapshot);
  return new URL(href, location.origin);
}

export type View = "list" | "grid";

export interface DriveAddress {
  folder: string | null;
  view: View;
  sort: SortKey;
  q: string | null;
}

export function readAddress(url: URL): DriveAddress {
  const sort = url.searchParams.get("sort");
  return {
    folder: url.searchParams.get("folder") || null,
    view: url.searchParams.get("view") === "grid" ? "grid" : "list",
    sort: SORT_KEYS.find((k) => k === sort) ?? "name-asc",
    q: url.searchParams.get("q") || null,
  };
}

export function driveHref(address: DriveAddress): string {
  const params = new URLSearchParams();
  if (address.folder) params.set("folder", address.folder);
  if (address.view !== "list") params.set("view", address.view);
  if (address.sort !== "name-asc") params.set("sort", address.sort);
  if (address.q) params.set("q", address.q);
  const text = params.toString();
  return `/drive${text ? `?${text}` : ""}`;
}

/** Keeps the parameters of an address that already carries them, so a step changes only one thing. */
export function withAddress(url: URL, change: Partial<DriveAddress>): string {
  const current = url.pathname === "/drive" ? readAddress(url) : { folder: null, view: "list" as View, sort: "name-asc" as SortKey, q: null };
  return driveHref({ ...current, ...change });
}
