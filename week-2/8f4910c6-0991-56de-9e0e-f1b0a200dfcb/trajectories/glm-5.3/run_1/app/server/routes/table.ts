import type { Request, Response } from "express";
import { errors, sendError } from "../http/errors.js";
import { loadAuth, type AuthContext } from "../domain/sessions.js";

/** The route table: exact matching for 404/405 precedence, then dispatch. */

export interface RouteContext {
  req: Request;
  res: Response;
  params: Record<string, string>;
  auth: AuthContext | null;
}

export type RouteHandler = (ctx: RouteContext) => Promise<unknown>;

export interface Route {
  method: string;
  path: string;
  segments: string[];
  handler: RouteHandler;
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export function route(method: string, path: string, handler: RouteHandler): Route {
  return { method, path, segments: path.split("/").filter(Boolean), handler };
}

interface Match {
  params: Record<string, string>;
  route: Route;
}

function matchPath(segments: string[], pattern: string[]): Record<string, string> | null {
  if (segments.length !== pattern.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i];
    if (p.startsWith(":")) {
      params[p.slice(1)] = decodeURIComponent(segments[i]);
    } else if (p !== segments[i]) {
      return null;
    }
  }
  return params;
}

/** Builds an Express handler that runs the table with the published precedence. */
export function tableMiddleware(routes: Route[]) {
  return (req: Request, res: Response, next: (err: unknown) => void): void => {
    void dispatch(routes, req, res).catch(next);
  };
}

async function dispatch(routes: Route[], req: Request, res: Response): Promise<void> {
    const segments = req.path.split("/").filter(Boolean);
    const matches: Match[] = [];
    let allowed = "";
    for (const r of routes) {
      const params = matchPath(segments, r.segments);
      if (params === null) continue;
      if (r.method === req.method) {
        matches.push({ params, route: r });
      } else if (METHODS.includes(r.method)) {
        allowed = allowed ? `${allowed}, ${r.method}` : r.method;
      }
    }
    if (matches.length === 0) {
      if (allowed) {
        sendError(res, errors.methodNotAllowed(allowed));
      } else {
        sendError(res, errors.notFound());
      }
      return;
    }
    const match = matches[0];
    const auth = await loadAuth(req);
    const ctx: RouteContext = { req, res, params: match.params, auth };
    const result = await match.route.handler(ctx);
    if (result !== undefined && !res.headersSent) {
      if (result === null) {
        res.status(204).end();
        return;
      }
      const status = res.locals.status ?? 200;
      res.status(status).json(result);
    }
}
