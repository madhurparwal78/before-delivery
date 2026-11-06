// Client-side addresses: one history listener, navigation that can replace the current entry,
// and the role homes and shared-job redirects from the brief (Screens and layout).
import { useSyncExternalStore } from "react";
import type { Role } from "../shared/domain.js";
import { ROLE_HOME } from "../shared/returnAddress.js";

interface NavigationState {
  revoked?: boolean;
}

const listeners = new Set<() => void>();
let snapshot = readLocation();

function readLocation(): { path: string; search: string; state: NavigationState } {
  const state = (window.history.state ?? {}) as NavigationState;
  return { path: window.location.pathname, search: window.location.search, state };
}

function emit(): void {
  snapshot = readLocation();
  for (const listener of listeners) listener();
}

window.addEventListener("popstate", emit);

export function navigate(to: string, options: { replace?: boolean; state?: NavigationState } = {}): void {
  const state = options.state ?? {};
  if (options.replace) window.history.replaceState(state, "", to);
  else window.history.pushState(state, "", to);
  window.scrollTo(0, 0);
  emit();
}

/** Rewrites the query of the current entry without adding one (search text, stage and panel). */
export function replaceQuery(search: string): void {
  const query = search ? `?${search}` : "";
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${query}`);
  snapshot = { ...snapshot, search: query };
}

export function useLocation(): { path: string; search: string; state: NavigationState } {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}

/** Where a signed-in user who opened `path` belongs, or null when the page is theirs to see. */
export function sharedAddressRedirect(role: Role, path: string, search: string): string | null {
  const ownerSide = path === "/portal" || path.startsWith("/portal/");
  const staffJob = /^\/jobs\/[^/]+$/.exec(path);
  const portalJob = /^\/portal\/jobs\/([^/]+)$/.exec(path);
  if (role === "owner") {
    if (staffJob) return `/portal${path}${search}`;
    return ownerSide ? null : "/portal";
  }
  if (portalJob) return `/jobs/${portalJob[1]}${search}`;
  if (ownerSide || path === "/") return ROLE_HOME[role];
  return null;
}
