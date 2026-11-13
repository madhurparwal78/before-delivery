/** Pages served by the app, all same-origin. */
export const PAGES = ["/", "/signin", "/signup", "/parts/new", "/dashboard"] as const;
export type PagePath = (typeof PAGES)[number];

/** The routes that render the app shell (the browser takes over from there). */
export const SHELL_ROUTES = [
  "/",
  "/signin",
  "/signup",
  "/dashboard",
  "/parts/new",
] as const;

export function isShellRoute(path: string): boolean {
  if ((SHELL_ROUTES as readonly string[]).includes(path)) return true;
  if (path === "/parts" || path.startsWith("/parts/")) return true;
  if (path === "/tapes" || path.startsWith("/tapes/")) return true;
  if (path === "/rooms" || path.startsWith("/rooms/")) return true;
  return false;
}

export const PAGE_TITLES: Record<string, string> = {
  "/": "Tinework — Parts that fit the thing you measured",
  "/signin": "Sign in — Tinework",
  "/signup": "Create an account — Tinework",
  "/dashboard": "Dashboard — Tinework",
  "/parts/new": "Publish a part — Tinework",
};
