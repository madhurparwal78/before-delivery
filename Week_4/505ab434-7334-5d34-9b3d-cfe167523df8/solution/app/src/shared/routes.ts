// Page routes (brief: Frontend / Screens and layout). One table drives the server's page status and the browser's router.
import type { Role } from "./domain.ts";

export type ScreenId =
  | "home"
  | "chapter"
  | "rules"
  | "rule"
  | "signin"
  | "activate"
  | "library"
  | "requests"
  | "request"
  | "queue"
  | "editor"
  | "adminAssets"
  | "adminGrants"
  | "adminAudit"
  | "adminPeople";

/** `public`: anyone; `signedIn`: any signed-in role; otherwise the roles that may open it (others see Not found). */
type Access = "public" | "signedIn" | readonly Role[];

interface PageRoute {
  screen: ScreenId;
  pattern: RegExp;
  access: Access;
}

const PAGE_ROUTES: readonly PageRoute[] = [
  { screen: "home", pattern: /^\/$/, access: "public" },
  { screen: "chapter", pattern: /^\/chapters\/([a-z]+)$/, access: "public" },
  { screen: "rules", pattern: /^\/rules$/, access: "public" },
  { screen: "rule", pattern: /^\/rules\/([a-z0-9.-]+)$/, access: "public" },
  { screen: "signin", pattern: /^\/signin$/, access: "public" },
  { screen: "activate", pattern: /^\/activate\/([^/]+)$/, access: "public" },
  { screen: "library", pattern: /^\/library$/, access: "signedIn" },
  { screen: "requests", pattern: /^\/requests$/, access: ["agency"] },
  { screen: "request", pattern: /^\/requests\/([A-Z0-9-]+)$/, access: "signedIn" },
  { screen: "queue", pattern: /^\/queue$/, access: ["owner", "brand_reviewer", "legal_reviewer"] },
  { screen: "editor", pattern: /^\/editor\/([a-z]+)$/, access: ["author", "brand_reviewer", "owner"] },
  { screen: "adminAssets", pattern: /^\/admin\/assets$/, access: ["owner"] },
  { screen: "adminGrants", pattern: /^\/admin\/grants$/, access: ["owner", "legal_reviewer"] },
  { screen: "adminAudit", pattern: /^\/admin\/audit$/, access: ["owner", "legal_reviewer"] },
  { screen: "adminPeople", pattern: /^\/admin\/people$/, access: ["owner"] },
];

export function matchPage(path: string): { route: PageRoute; params: string[] } | null {
  for (const route of PAGE_ROUTES) {
    const match = route.pattern.exec(path);
    if (match) return { route, params: match.slice(1) };
  }
  return null;
}

export function mayOpen(access: Access, role: Role | null): boolean {
  if (access === "public") return true;
  if (role === null) return false;
  return access === "signedIn" || access.includes(role);
}

/** Links shown in `navigation "Main"` for a role (brief: Screens and layout). */
export function mainNavigation(role: Role): { label: string; href: string }[] {
  const links = [{ label: "Library", href: "/library" }];
  if (role === "agency") links.push({ label: "My requests", href: "/requests" });
  if (role === "owner" || role === "brand_reviewer" || role === "legal_reviewer") links.push({ label: "Queue", href: "/queue" });
  if (role === "owner" || role === "brand_reviewer" || role === "author") links.push({ label: "Editor", href: "/editor/logo" });
  if (role === "owner") links.push({ label: "Admin", href: "/admin/assets" });
  else if (role === "legal_reviewer") links.push({ label: "Admin", href: "/admin/grants" });
  return links;
}
