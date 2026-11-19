/** Route matching: a literal segment wins over an id segment; unlisted methods answer 405 with Allow, unlisted paths 404. */
import type { Context } from "./context.js";
import type { HandlerResult } from "./reply.js";

export interface Route {
  method: "GET" | "POST" | "DELETE";
  path: string;
  /** Needs a signed-in session. */
  auth: boolean;
  /** Takes the session token from the query string instead of the Authorization header. */
  tokenInQuery?: boolean;
  handle: (ctx: Context) => Promise<HandlerResult>;
}

interface Pattern {
  segments: string[];
  routes: Route[];
}

export class Router {
  private readonly patterns: Pattern[] = [];

  constructor(routes: Route[]) {
    for (const route of routes) {
      const existing = this.patterns.find((pattern) => pattern.segments.join("/") === route.path);
      if (existing) existing.routes.push(route);
      else this.patterns.push({ segments: route.path.split("/"), routes: [route] });
    }
  }

  /** The routes listed for this path, with the id segments captured; null when the path is not listed. */
  match(path: string): { routes: Route[]; params: Record<string, string> } | null {
    const given = path.split("/");
    let best: { routes: Route[]; params: Record<string, string>; score: number } | null = null;
    for (const pattern of this.patterns) {
      if (pattern.segments.length !== given.length) continue;
      const params: Record<string, string> = {};
      let score = 0;
      let fits = true;
      pattern.segments.forEach((segment, index) => {
        const piece = given[index] ?? "";
        if (segment.startsWith(":")) params[segment.slice(1)] = piece;
        else if (segment === piece) score += 1 << (given.length - index);
        else fits = false;
      });
      if (fits && (!best || score > best.score)) best = { routes: pattern.routes, params, score };
    }
    return best ? { routes: best.routes, params: best.params } : null;
  }
}
