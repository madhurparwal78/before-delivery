// Session state and sign-in landing (DP-44, DP-66).
import { api } from "./api.js";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: "owner" | "parent" | "director" | "tech";
  family_id: string | null;
  school_id: string | null;
}

let currentUser: SessionUser | null = null;

export async function loadSession(): Promise<SessionUser | null> {
  try {
    const result = await api<{ user: SessionUser }>("GET", "/api/me");
    currentUser = result.user;
  } catch {
    currentUser = null;
  }
  return currentUser;
}

export function sessionUser(): SessionUser | null {
  return currentUser;
}

// Routes open by role.
export function routeOpenTo(path: string, role: SessionUser["role"]): boolean {
  if (path === "/register") return role === "owner" || role === "tech";
  if (path.startsWith("/contracts/")) return role === "owner" || role === "tech" || role === "parent";
  if (path === "/family" || path === "/reserve") return role === "parent";
  if (path === "/price-lists" || path === "/schools") return role === "owner";
  if (path === "/roster") return role === "director" || role === "owner";
  return false;
}

// The sign-in landing: next when it is a same-site path open to the role,
// otherwise the role's home.
export function landingPath(next: string | null, role: SessionUser["role"], roleHome: string): string {
  if (next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") && next.length > 1) {
    const queryStart = next.indexOf("?");
    const path = queryStart === -1 ? next : next.slice(0, queryStart);
    if (routeOpenTo(path, role)) {
      return next;
    }
  }
  return roleHome;
}

export function encodeNext(pathAndQuery: string): string {
  return encodeURIComponent(pathAndQuery);
}

export function roleHome(user: SessionUser): string {
  if (user.role === "owner" || user.role === "tech") return "/register";
  if (user.role === "parent") return "/family";
  return "/roster";
}
