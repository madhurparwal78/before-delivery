// Client routes and the signed-in user.
import type { User } from "../shared/api";
import type { Role } from "../shared/kitchen";
import { Store } from "./store";

export const route = new Store<string>(location.pathname);

export function navigate(path: string, replace = false): void {
  if (path === location.pathname) return;
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  route.set(path);
  window.scrollTo(0, 0);
}

addEventListener("popstate", () => route.set(location.pathname));

/** `undefined` while the session is being read. */
export const session = new Store<User | null | undefined>(undefined);

export interface Screen {
  path: string;
  label: string;
  roles: readonly Role[];
}

export const SCREENS: readonly Screen[] = [
  { path: "/", label: "Dial", roles: ["operator", "owner", "cook"] },
  { path: "/bookings", label: "Bookings", roles: ["operator", "owner", "cook"] },
  { path: "/documents", label: "Documents", roles: ["operator", "owner"] },
  { path: "/billing", label: "Billing", roles: ["operator", "owner"] },
  { path: "/tenants", label: "Tenants", roles: ["operator"] },
  { path: "/settings", label: "Settings", roles: ["operator"] },
];
