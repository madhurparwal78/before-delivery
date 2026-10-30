// Route table and request context.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Person } from "./auth.js";

export type BodyKind = "none" | "json" | "multipart";

/** What every handler gets; endpoints that need no session see only this. */
export interface RequestCtx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: string[];
  body: unknown;
  multipart: { bytes: Buffer; overLimit: boolean };
}

/** A request with a valid session. */
export interface Ctx extends RequestCtx {
  person: Person;
}

interface RouteBase {
  method: string;
  pattern: RegExp;
  body: BodyKind;
}

export type Route =
  | RouteBase & { auth: true; handle: (ctx: Ctx) => Promise<void> }
  | RouteBase & { auth: false; handle: (ctx: RequestCtx) => Promise<void> };

const routes: Route[] = [];

const patternOf = (path: string): RegExp => new RegExp(`^${path.replace(/:[a-z_]+/g, "([^/]+)")}$`);

export function on(method: string, path: string, body: BodyKind, handle: (ctx: Ctx) => Promise<void>): void {
  routes.push({ method, pattern: patternOf(path), body, auth: true, handle });
}

/** The few endpoints that need no session. */
export function onPublic(method: string, path: string, body: BodyKind, handle: (ctx: RequestCtx) => Promise<void>): void {
  routes.push({ method, pattern: patternOf(path), body, auth: false, handle });
}

export function match(method: string, path: string): { route: Route; params: string[] } | "method" | null {
  let pathMatched = false;
  for (const route of routes) {
    const m = route.pattern.exec(path);
    if (!m) continue;
    pathMatched = true;
    if (route.method === method) return { route, params: m.slice(1).map((p) => decodeURIComponent(p)) };
  }
  return pathMatched ? "method" : null;
}
