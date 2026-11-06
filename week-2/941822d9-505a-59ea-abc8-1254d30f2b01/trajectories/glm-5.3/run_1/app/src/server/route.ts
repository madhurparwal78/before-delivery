import type { Request, Response } from "express";
import type { SessionUser } from "./session.ts";

export type Role = "learner" | "coordinator" | "planner" | "author";

export const ALL_ROLES: readonly Role[] = ["learner", "coordinator", "planner", "author"];

export type BaseCtx = {
  req: Request;
  res: Response;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  origin: string;
  user: SessionUser | null;
};

export type Ctx = BaseCtx & { user: SessionUser };
export type PublicCtx = BaseCtx & { user: null };

export type RouteHandler = ((ctx: Ctx) => Promise<void> | void) | ((ctx: PublicCtx) => Promise<void> | void);

export type RouteSpec = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Compile pattern with :name placeholders. */
  pattern: string;
  /** null = the path is public (no session required); otherwise the allowed roles. */
  roles: readonly Role[] | null;
  /** True for the paths that never answer 401 (verify, token pdf, health, sign-in). */
  publicAccess?: boolean;
  handler: RouteHandler;
};

/** Route patterns guarantee every named param, so a missing one reads as an
 * unknown id and answers 404. */
export const pathParam = (ctx: BaseCtx, name: string): string => ctx.params[name] ?? "";

export function compilePattern(pattern: string): { regex: RegExp; names: string[] } {
  const names: string[] = [];
  const source = pattern.replace(/:([a-zA-Z_]+)/g, (_m, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  return { regex: new RegExp(`^${source}/?$`), names };
}
