import { createReadStream, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Role } from "../shared/rules.js";
import { HttpError, ProviderDown, unavailable, type Outage } from "./errors.js";

const JSON_LIMIT = 65_536;
export const UPLOAD_LIMIT = 5_000_000;

export interface Auth {
  memberId: string;
  roles: Role[];
  venueId: string | null;
  /** The API key the request came with, or null for a session. */
  keyId: string | null;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  cookies: Record<string, string>;
  origin: string;
  body: unknown;
  raw: Buffer;
  auth: Auth | null;
}

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  text?: string;
  /** The handler already wrote the response (HTML pages, event streams). */
  sent?: boolean;
}

export type Handler = (ctx: Ctx) => Promise<Reply>;

export interface Route {
  method: string;
  pattern: string;
  handler: Handler;
  /** none: no session needed; session: a signed-in caller (a key only where `key` is set). */
  auth: "none" | "session";
  key?: boolean;
  body?: "json" | "multipart" | "raw";
  outage?: Outage;
}

interface Compiled extends Route {
  regex: RegExp;
  names: string[];
}

export interface Pipeline {
  authenticate(ctx: Ctx, route: Route): Promise<Auth>;
  rateLimit(keyId: string): Promise<void>;
}

export function compile(routes: Route[]): Compiled[] {
  return routes.map((route) => {
    const names: string[] = [];
    const source = route.pattern.replace(/\{(\w+)\}/g, (_, name: string) => {
      names.push(name);
      return "([^/]+)";
    });
    return { ...route, regex: new RegExp(`^${source}$`), names };
  });
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Reply {
  return { status, body, headers };
}

function send(res: ServerResponse, reply: Reply): void {
  if (reply.sent) return;
  if (reply.text !== undefined) {
    res.writeHead(reply.status, reply.headers);
    res.end(reply.text);
    return;
  }
  if (reply.body === undefined) {
    res.writeHead(reply.status, reply.headers);
    res.end();
    return;
  }
  const payload = JSON.stringify(reply.body);
  res.writeHead(reply.status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    ...reply.headers,
  });
  res.end(payload);
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

/** Reads the whole body, keeping at most `limit` bytes; `null` when it was larger. */
async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = Number(req.headers["content-length"] ?? 0) > limit;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) tooLarge = true;
    if (!tooLarge) chunks.push(chunk);
  }
  return tooLarge ? null : Buffer.concat(chunks);
}

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function requestOrigin(req: IncomingMessage): string {
  return `http://${req.headers.host ?? ""}`;
}

export function makeDispatcher(routes: Compiled[], pipeline: Pipeline, serveStatic: (ctx: Ctx) => Promise<void>) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://local");
    const method = req.method ?? "GET";
    const ctx: Ctx = {
      req,
      res,
      method,
      path: url.pathname,
      params: {},
      query: url.searchParams,
      cookies: parseCookies(req.headers.cookie),
      origin: requestOrigin(req),
      body: undefined,
      raw: Buffer.alloc(0),
      auth: null,
    };
    let route: Compiled | undefined;
    for (const candidate of routes) {
      const match = candidate.regex.exec(ctx.path);
      if (!match || candidate.method !== method) continue;
      route = candidate;
      candidate.names.forEach((name, i) => (ctx.params[name] = decodeURIComponent(match[i + 1] ?? "")));
      break;
    }
    try {
      if (!route) {
        if (ctx.path.startsWith("/api/") || (method !== "GET" && method !== "HEAD")) throw new HttpError(404, { error: "not_found" });
        await serveStatic(ctx);
        return;
      }
      const origin = req.headers.origin;
      if (STATE_CHANGING.has(method) && origin !== undefined && origin !== ctx.origin) {
        throw new HttpError(403, { error: "bad_origin" });
      }
      const limit = route.body === "multipart" ? UPLOAD_LIMIT + JSON_LIMIT : JSON_LIMIT;
      const raw = await readBody(req, limit);
      if (raw === null) throw new HttpError(413, { error: "payload_too_large" });
      ctx.raw = raw;
      if (route.body !== "multipart" && route.body !== "raw" && raw.length > 0) {
        try {
          ctx.body = JSON.parse(raw.toString("utf8"));
        } catch {
          throw new HttpError(400, { error: "bad_json" });
        }
      }
      if (route.auth === "session") {
        ctx.auth = await pipeline.authenticate(ctx, route);
        if (ctx.auth.keyId) await pipeline.rateLimit(ctx.auth.keyId);
      }
      send(res, await route.handler(ctx));
    } catch (error) {
      if (error instanceof HttpError) {
        send(res, json(error.status, error.body, error.headers));
      } else if (error instanceof ProviderDown && route?.outage) {
        send(res, json(503, unavailable(route.outage).body));
      } else {
        console.error(`${method} ${ctx.path} failed:`, error instanceof Error ? error.message : error);
        send(res, json(500, { error: "internal" }));
      }
    }
  };
}

// ---- static frontend: only files inside the build output are served ----

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

const SPA_ROUTES = [
  /^\/$/,
  /^\/markets$/,
  /^\/markets\/[^/]+$/,
  /^\/balance$/,
  /^\/orders$/,
  /^\/orders\/[^/]+$/,
  /^\/statements$/,
  /^\/profile$/,
  /^\/builder$/,
  /^\/admin$/,
  /^\/owner$/,
  /^\/platform$/,
  /^\/invites\/[^/]+$/,
];

type PageMarker = "app" | "not-found" | "signin-error" | "signin-unavailable";

let indexTemplate: string | null = null;

async function htmlPage(marker: PageMarker): Promise<string> {
  indexTemplate ??= await readFile(path.join(PUBLIC_DIR, "index.html"), "utf8");
  return indexTemplate.replace("<html lang=\"en\">", `<html lang="en" data-page="${marker}">`);
}

export async function servePage(res: ServerResponse, status: number, marker: PageMarker, headers: Record<string, string> = {}): Promise<void> {
  const html = await htmlPage(marker);
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(html);
}

export async function serveStatic(ctx: Ctx): Promise<void> {
  if (ctx.path.startsWith("/assets/") || ctx.path.startsWith("/fonts/")) {
    const file = path.resolve(PUBLIC_DIR, "." + ctx.path);
    if (file.startsWith(PUBLIC_DIR + path.sep)) {
      try {
        const info = statSync(file);
        if (info.isFile()) {
          ctx.res.writeHead(200, {
            "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
            "Content-Length": info.size,
            "Cache-Control": "public, max-age=31536000, immutable",
          });
          createReadStream(file).pipe(ctx.res);
          return;
        }
      } catch {
        // falls through to the not-found page
      }
    }
  }
  const known = SPA_ROUTES.some((pattern) => pattern.test(ctx.path));
  await servePage(ctx.res, known ? 200 : 404, known ? "app" : "not-found");
}
