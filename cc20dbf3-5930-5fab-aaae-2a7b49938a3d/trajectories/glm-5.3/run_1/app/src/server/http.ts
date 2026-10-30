import { IncomingMessage, ServerResponse } from "node:http";
import { ApiError, notFound, unauthenticated } from "./errors";

export type Role = "member" | "volunteer" | "founder";

export interface SessionUser {
  id: string;
  name: string;
  role: Role;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  user: SessionUser | null;
  rawBody: Buffer | null;
  multipart: Record<string, { name: string; filename: string | null; contentType: string | null; bytes: Buffer }> | null;
  json(): unknown;
}

export interface Handler {
  (ctx: Ctx): Promise<void> | void;
}

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): void {
    const segments = pattern.split("/").filter((s) => s.length > 0);
    this.routes.push({ method, segments, handler });
  }

  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
    const requestSegments = path.split("/").filter((s) => s.length > 0);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== requestSegments.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (const [i, segment] of route.segments.entries()) {
        const requestSegment = requestSegments[i];
        if (segment.startsWith(":")) {
          params[segment.slice(1)] = decodeURIComponent(requestSegment);
        } else if (segment !== requestSegment) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params };
    }
    return null;
  }
}

export function sendJson(ctx: Ctx, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  ctx.res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  ctx.res.end(body);
}

export function sendEmpty(ctx: Ctx, status: number): void {
  ctx.res.writeHead(status, { "Content-Length": 0 });
  ctx.res.end();
}

export async function readJsonBody(ctx: Ctx): Promise<unknown> {
  if (ctx.rawBody === null) return {};
  if (ctx.rawBody.length === 0) return {};
  try {
    return JSON.parse(ctx.rawBody.toString("utf8"));
  } catch {
    throw new ApiError(422, "validation", {});
  }
}

export function requireUser(ctx: Ctx): SessionUser {
  if (ctx.user === null) throw unauthenticated();
  return ctx.user;
}

export function requireStaff(ctx: Ctx): SessionUser {
  const user = requireUser(ctx);
  if (user.role === "member") throw new ApiError(403, "forbidden");
  return user;
}

export function requireFounder(ctx: Ctx): SessionUser {
  const user = requireUser(ctx);
  if (user.role !== "founder") throw new ApiError(403, "forbidden");
  return user;
}

export function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
