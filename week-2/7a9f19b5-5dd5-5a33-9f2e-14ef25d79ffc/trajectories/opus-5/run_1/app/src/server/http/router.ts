import type { Ctx } from "./context.js";
import { forbidden, notFound, tradeAccountRequired, unauthenticated } from "./errors.js";
import { hasTradeAccount, type Viewer } from "../../shared/projection.js";
import type { User } from "../../shared/types.js";

export type Handler = (ctx: Ctx) => Promise<void>;

/** What body the endpoint accepts, which decides its framing checks. */
export type BodyKind = "json" | "multipart";

interface Route {
  method: string;
  segments: readonly string[];
  handler: Handler;
  bodyKind: BodyKind;
}

export interface RouteMatch {
  handler: Handler;
  params: Record<string, string>;
  bodyKind: BodyKind;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler, bodyKind: BodyKind = "json"): this {
    this.routes.push({ method, segments: pattern.split("/").filter(Boolean), handler, bodyKind });
    return this;
  }

  get(pattern: string, handler: Handler): this {
    return this.add("GET", pattern, handler);
  }
  post(pattern: string, handler: Handler, bodyKind: BodyKind = "json"): this {
    return this.add("POST", pattern, handler, bodyKind);
  }
  put(pattern: string, handler: Handler): this {
    return this.add("PUT", pattern, handler);
  }
  patch(pattern: string, handler: Handler): this {
    return this.add("PATCH", pattern, handler);
  }
  delete(pattern: string, handler: Handler): this {
    return this.add("DELETE", pattern, handler);
  }

  /** Returns the matching route and its path parameters, or null for an unknown path. */
  match(method: string, path: string): RouteMatch | null {
    const parts = path.split("/").filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i += 1) {
        const segment = route.segments[i] as string;
        const value = parts[i] as string;
        if (segment.startsWith(":")) {
          params[segment.slice(1)] = decodeURIComponent(value);
        } else if (segment !== value) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params, bodyKind: route.bodyKind };
    }
    return null;
  }
}

/** Precedence step 2: a signed-in caller is required. */
export function requireUser(ctx: Ctx): User {
  if (!ctx.user) throw unauthenticated();
  return ctx.user;
}

/**
 * Precedence step 3: every `/api/admin/` path refuses a signed-in non-admin
 * before any record is looked up, so admin paths never answer 404 to non-admins.
 */
export function requireAdmin(ctx: Ctx): User {
  const user = requireUser(ctx);
  if (user.role !== "admin") throw forbidden();
  return user;
}

/** Precedence step 6: projects and account orders need an approved trade account. */
export function requireTradeAccount(ctx: Ctx): User {
  const user = requireUser(ctx);
  if (!hasTradeAccount(user)) throw tradeAccountRequired();
  return user;
}

export function viewerOf(ctx: Ctx): Viewer | null {
  return ctx.user ? { role: ctx.user.role, trade_status: ctx.user.trade_status } : null;
}

export function unknownApiPath(): never {
  throw notFound();
}
