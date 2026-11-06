// The sign-in landing rule: role homes, the routes open to each role, and where a `next` value may lead.

import type { Role } from "./api.js";

export const ROLE_HOME: Record<Role, string> = {
  owner: "/register", tech: "/register", parent: "/family", director: "/roster",
};

const ROUTES: Record<Role, readonly RegExp[]> = {
  owner: [/^\/register$/, /^\/contracts\/[^/]+$/, /^\/price-lists$/, /^\/schools$/, /^\/roster$/],
  tech: [/^\/register$/, /^\/contracts\/[^/]+$/],
  parent: [/^\/family$/, /^\/reserve$/, /^\/contracts\/[^/]+$/],
  director: [/^\/roster$/],
};

/** Whether the route of `path` (query ignored) is open to `role`. */
export function routeOpenTo(role: Role, path: string): boolean {
  const route = path.split(/[?#]/, 1)[0];
  return ROUTES[role].some((pattern) => pattern.test(route));
}

/** Routes anyone may visit signed out. */
export function isPublicRoute(path: string): boolean {
  return path === "/" || /^\/sign\/[^/]+$/.test(path);
}

const CONTROL = /[\u0000-\u001f\u007f]/;

/** A local path: one "/" followed by neither "/" nor "\", no control characters, still local once decoded. */
function isLocalPath(target: string): boolean {
  if (!/^\/(?![/\\])/.test(target) || CONTROL.test(target)) return false;
  try {
    const decoded = decodeURIComponent(target);
    return decoded === target || (/^\/(?![/\\])/.test(decoded) && !CONTROL.test(decoded));
  } catch {
    return false;
  }
}

/** Where a signed-in user lands: `next` exactly as given when it is local and open to the role, else the home. */
export function landingFor(role: Role, next: string | null): string {
  return next !== null && isLocalPath(next) && routeOpenTo(role, next) ? next : ROLE_HOME[role];
}
