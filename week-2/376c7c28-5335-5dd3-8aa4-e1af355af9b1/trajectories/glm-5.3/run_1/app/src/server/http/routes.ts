import type { Ctx } from "./context";

export type AuthKind = "any" | "signed_in" | "staff" | "owner" | "member";
export type BodyKind = "none" | "json" | "photo";

export type Route = {
  method: string;
  pattern: string;
  auth: AuthKind;
  bodyKind: BodyKind;
  handler: (ctx: Ctx) => Promise<void>;
};

export type RouteMatch = { route: Route; params: Record<string, string> } | null;

// Compile a pattern like "/api/pieces/{id}" into a matcher.
function compile(pattern: string): { regex: RegExp; names: string[] } {
  const names: string[] = [];
  const parts = pattern.split("/").map((seg) => {
    const m = seg.match(/^\{(\w+)\}$/);
    if (m) {
      names.push(m[1]);
      return "([^/]+)";
    }
    return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  });
  return { regex: new RegExp(`^${parts.join("/")}$`), names };
}

const compiled: { route: Route; regex: RegExp; names: string[] }[] = [];

export function registerRoutes(routes: Route[]): void {
  for (const route of routes) {
    const { regex, names } = compile(route.pattern);
    compiled.push({ route, regex, names });
  }
}

export function match(method: string, pathname: string): RouteMatch {
  for (const c of compiled) {
    if (c.route.method !== method) continue;
    const m = c.regex.exec(pathname);
    if (!m) continue;
    const params: Record<string, string> = {};
    c.names.forEach((name, i) => {
      params[name] = m[i + 1];
    });
    return { route: c.route, params };
  }
  return null;
}
