// The screen table: which paths each role may open, its landing screen and its navigation links.
import type { Role } from "./types";

interface NavLink {
  path: string;
  label: string;
}

const LINKS: Record<string, NavLink> = {
  requests: { path: "/requests", label: "Requests" },
  board: { path: "/board", label: "Board" },
  offers: { path: "/offers", label: "Open seats" },
  mySeats: { path: "/my-seats", label: "My seats" },
  billing: { path: "/billing", label: "Billing" },
  org: { path: "/org", label: "Schedulers" },
};

export const ROLE_LINKS: Record<Role, NavLink[]> = {
  scheduler: [LINKS.requests!],
  org_admin: [LINKS.requests!, LINKS.org!],
  dispatcher: [LINKS.board!],
  billing_lead: [LINKS.billing!],
  interpreter: [LINKS.offers!, LINKS.mySeats!],
};

export function landingFor(role: Role): string {
  return ROLE_LINKS[role][0]!.path;
}

export function allowed(role: Role, path: string): boolean {
  return ROLE_LINKS[role].some((link) => link.path === path);
}

export function navigate(path: string, replace = false): void {
  if (replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
