// Each role's home route and page routes (brief: Screens and layout), and the return-path check,
// shared by the server's redirects and the client.
export type Role = "grower" | "operator" | "dispatcher" | "clerk" | "reviewer";

export const HOME: Record<Role, string> = {
  grower: "/grower",
  operator: "/field",
  dispatcher: "/board",
  clerk: "/packs",
  reviewer: "/review",
};

const ORDER = /^\/orders\/[^/]+$/;
const CAPACITY = /^\/channels\/[^/]+\/capacity$/;
const RESTRICTION = /^\/restrictions\/[^/]+$/;
const CONTRACTORS = /^\/contractors$/;
const PACK = /^\/packs\/(?!new$)[^/]+$/;

const PAGE_ROUTES: Record<Role, readonly RegExp[]> = {
  grower: [/^\/grower$/, /^\/grower\/orders\/new$/, ORDER],
  operator: [/^\/field$/],
  dispatcher: [/^\/board$/, CAPACITY, RESTRICTION, ORDER, CONTRACTORS],
  clerk: [/^\/packs$/, /^\/packs\/new$/, PACK, CAPACITY, RESTRICTION, ORDER, CONTRACTORS],
  reviewer: [/^\/review$/, PACK, CAPACITY, RESTRICTION],
};

const ROLES = Object.keys(HOME) as Role[];

/** Whether `pathname` is one of the role's page routes. */
export function mayOpen(role: Role, pathname: string): boolean {
  return PAGE_ROUTES[role].some((route) => route.test(pathname));
}

/** Whether `pathname` is a page route of any role (anything else is Page not found). */
export function isPageRoute(pathname: string): boolean {
  return ROLES.some((role) => mayOpen(role, pathname));
}

/** The return-path check: `return` is followed only when it starts with exactly one `/` (not `//`
 * and not `/\`) and its pathname is a page route of the signed-in role; otherwise the home route. */
export function landingFor(role: Role, returnPath: string | null): string {
  if (returnPath === null || !returnPath.startsWith("/") || returnPath.startsWith("//") || returnPath.startsWith("/\\")) {
    return HOME[role];
  }
  const url = new URL(returnPath, "http://ditchbook.invalid");
  return url.origin === "http://ditchbook.invalid" && mayOpen(role, url.pathname) ? url.pathname + url.search : HOME[role];
}

/** The sign-in address that brings a person back to `here` (pathname and query) after signing in. */
export const signInFor = (here: string) => `/sign-in?return=${encodeURIComponent(here)}`;
