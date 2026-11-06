// Request context, body reading with the published size limits, responses and a small router.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Caller } from "./access.js";
import { ApiError, invalid, jsonError } from "./errors.js";
import { JSON_BODY_MAX } from "./limits.js";

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  rawPath: string;
  rawQuery: string;
  query: URLSearchParams;
  // The instant every decision of this request is judged against; also sent as the Date header.
  now: Date;
  origin: string;
  params: Record<string, string>;
  // The session behind this request, resolved once.
  caller?: Caller;
}

export function header(ctx: Ctx, name: string): string | undefined {
  const value = ctx.req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value.join(",") : value;
}

export function createCtx(req: IncomingMessage, res: ServerResponse): Ctx {
  const target = req.url ?? "/";
  const mark = target.indexOf("?");
  const rawPath = mark < 0 ? target : target.slice(0, mark);
  const rawQuery = mark < 0 ? "" : target.slice(mark + 1);
  let path: string;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    path = rawPath;
  }
  const host = req.headers.host ?? "127.0.0.1";
  return {
    req, res, method: (req.method ?? "GET").toUpperCase(), path, rawPath, rawQuery,
    query: new URLSearchParams(rawQuery), now: new Date(), origin: `http://${host}`, params: {},
  };
}

// Reads the body up to `limit` bytes. A larger body is drained and answered with null, so the
// caller can refuse it with 413 before anything is stored.
export function readBody(ctx: Ctx, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let overflow = false;
    ctx.req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) overflow = true;
      if (!overflow) chunks.push(chunk);
    });
    ctx.req.on("end", () => resolve(overflow ? null : Buffer.concat(chunks)));
    ctx.req.on("error", reject);
  });
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

// An empty body reads as {}; anything but a JSON object is a validation failure.
export function parseJsonObject(raw: Buffer): JsonObject {
  let parsed: unknown;
  try {
    parsed = raw.length ? JSON.parse(raw.toString("utf8")) : {};
  } catch {
    throw invalid({ body: "The request body must be a JSON object." });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw invalid({ body: "The request body must be a JSON object." });
  }
  return parsed as JsonObject;
}

export async function readJson(ctx: Ctx): Promise<JsonObject> {
  const raw = await readBody(ctx, JSON_BODY_MAX);
  if (raw === null) throw new ApiError("payload_too_large");
  return parseJsonObject(raw);
}

// Published fields only: any other member and any missing required field are listed together.
export function fieldErrors(body: JsonObject, allowed: readonly string[], required: readonly string[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const name of Object.keys(body)) if (!allowed.includes(name)) errors[name] = "This field can't be set.";
  for (const name of required) if (!(name in body)) errors[name] = "This field is required.";
  return errors;
}

export function send(ctx: Ctx, status: number, headers: Record<string, string | number>, body?: Buffer | string): void {
  const payload = body === undefined ? undefined : typeof body === "string" ? Buffer.from(body) : body;
  ctx.res.statusCode = status;
  ctx.res.setHeader("Date", ctx.now.toUTCString());
  for (const [name, value] of Object.entries(headers)) ctx.res.setHeader(name, value);
  if (!ctx.res.hasHeader("Content-Length")) ctx.res.setHeader("Content-Length", payload?.length ?? 0);
  ctx.res.end(ctx.method === "HEAD" ? undefined : payload);
}

export function sendJson(ctx: Ctx, status: number, body: unknown, headers: Record<string, string> = {}): void {
  send(ctx, status, { "Content-Type": "application/json; charset=utf-8", ...headers }, JSON.stringify(body));
}

export function sendNoContent(ctx: Ctx): void {
  ctx.res.statusCode = 204;
  ctx.res.setHeader("Date", ctx.now.toUTCString());
  ctx.res.end();
}

export function sendApiError(ctx: Ctx, error: ApiError): void {
  const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
  if (error.retryAfter !== undefined) headers["Retry-After"] = String(error.retryAfter);
  send(ctx, error.status, headers, jsonError(error));
}

type Handler = (ctx: Ctx) => Promise<void>;
interface Route { method: string; segments: string[]; handler: Handler }

export class Router {
  private readonly routes: Route[] = [];

  on(method: string, pattern: string, handler: Handler): void {
    this.routes.push({ method, segments: pattern.split("/").filter(Boolean), handler });
  }

  match(method: string, rawPath: string): { handler: Handler; params: Record<string, string> } | null {
    const parts = rawPath.split("/").filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method || route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      const ok = route.segments.every((segment, i) => {
        const part = parts[i] ?? "";
        if (segment.startsWith(":")) {
          try {
            params[segment.slice(1)] = decodeURIComponent(part);
          } catch {
            return false;
          }
          return true;
        }
        return segment === part;
      });
      if (ok) return { handler: route.handler, params };
    }
    return null;
  }
}

// Seconds until `moment`, rounded up and at least 1 (Retry-After values).
export function secondsUntil(now: Date, moment: Date): number {
  return Math.max(1, Math.ceil((moment.getTime() - now.getTime()) / 1000));
}

export const truncateToSecond = (at: Date): Date => new Date(Math.floor(at.getTime() / 1000) * 1000);
export const isoSecond = (at: Date): string => at.toISOString().replace(/\.\d{3}Z$/, "Z");
export const isoOrNull = (at: Date | null | undefined): string | null => (at ? isoSecond(at) : null);
