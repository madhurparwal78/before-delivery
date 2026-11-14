import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ApiError, databaseUnavailable, formErrors, notFound, serverError, tooLarge } from "./errors.ts";
import { isDatabaseDown, requireDatabase } from "./db.ts";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  verified: boolean;
  reduce_motion: boolean;
}

interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  raw?: Buffer;
}

export const reply = (status: number, body?: unknown, headers?: Record<string, string>): Reply => ({ status, body, headers });
export const file = (raw: Buffer, headers: Record<string, string>): Reply => ({ status: 200, raw, headers });

export interface Ctx {
  req: IncomingMessage;
  url: URL;
  params: string[];
  /** The signed-in user, set by `requireUser`. */
  user: UserRow | null;
  json: (limit?: number) => Promise<Record<string, unknown>>;
  raw: (limit: number) => Promise<Buffer>;
  cookie: (name: string) => string | undefined;
}

type Handler = (ctx: Ctx) => Promise<Reply | unknown>;

interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
  database: boolean;
}

const routes: Route[] = [];

function compile(pattern: string): RegExp {
  const source = pattern.replace(/[.]/g, "\\.").replace(/:[a-zA-Z]+/g, "([^/]+)");
  return new RegExp(`^${source}$`);
}

export function route(method: string, pattern: string, handler: Handler, options: { database?: boolean } = {}): void {
  routes.push({ method, pattern: compile(pattern), handler, database: options.database ?? true });
}

const JSON_LIMIT = 1_000_000;

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > limit) throw tooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const part = chunk as Buffer;
    size += part.length;
    if (size > limit) throw tooLarge();
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

export function cookieOf(req: IncomingMessage, name: string): string | undefined {
  for (const pair of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = pair.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}, raw?: Buffer): void {
  const isRaw = raw !== undefined;
  const payload = isRaw ? raw : body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    ...(isRaw || body === undefined ? {} : { "Content-Type": "application/json; charset=utf-8" }),
    "Cache-Control": "no-store",
    ...headers,
    "Content-Length": String(payload.length),
  });
  res.end(payload);
}

const PAGES: RegExp[] = [
  /^\/$/,
  /^\/(signup|signin|verify|aerodromes|settings)$/,
  /^\/invite\/[^/]+$/,
  /^\/classes\/[^/]+$/,
  /^\/aerodromes\/[^/]+$/,
  /^\/scenarios\/[^/]+$/,
  /^\/sessions\/[^/]+(\/debrief)?$/,
  /^\/records\/[^/]+$/,
];

const MIME: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".html": "text/html; charset=utf-8",
};

const PUBLIC_DIR = path.resolve(import.meta.dirname, "public");

async function serveStatic(pathname: string): Promise<Reply | null> {
  const known = PAGES.some((page) => page.test(pathname));
  if (pathname.startsWith("/assets/")) {
    const target = path.resolve(PUBLIC_DIR, `.${pathname}`);
    if (!target.startsWith(`${PUBLIC_DIR}${path.sep}`)) return null;
    try {
      const raw = await readFile(target);
      return file(raw, { "Content-Type": MIME[path.extname(target)] ?? "application/octet-stream", "Cache-Control": "public, max-age=3600" });
    } catch {
      return null;
    }
  }
  const shell = await readFile(path.join(PUBLIC_DIR, "index.html"));
  return { status: known ? 200 : 404, raw: shell, headers: { "Content-Type": MIME[".html"] ?? "text/html" } };
}

export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";
  try {
    if (url.pathname.startsWith("/api/")) {
      const match = routes.find((r) => r.method === method && r.pattern.test(url.pathname));
      if (!match) throw notFound();
      if (match.database) await requireDatabase();
      const ctx: Ctx = {
        req,
        url,
        params: (match.pattern.exec(url.pathname) ?? []).slice(1).map(decodeURIComponent),
        user: null,
        json: async (limit = JSON_LIMIT) => {
          const body = await readBody(req, limit);
          if (body.length === 0) return {};
          try {
            const parsed: unknown = JSON.parse(body.toString("utf8"));
            if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
          } catch {
            // falls through to the shape error below
          }
          throw formErrors({ body: "Send a JSON object." });
        },
        raw: (limit) => readBody(req, limit),
        cookie: (name) => cookieOf(req, name),
      };
      const result = await match.handler(ctx);
      const answer = isReply(result) ? result : reply(200, result);
      send(res, answer.status, answer.body, answer.headers, answer.raw);
      return;
    }
    if (method !== "GET" && method !== "HEAD") throw notFound();
    const served = await serveStatic(url.pathname);
    if (!served) throw notFound();
    send(res, served.status, undefined, served.headers, served.raw);
  } catch (error) {
    if (error instanceof ApiError) return send(res, error.status, error.body);
    if (isDatabaseDown(error)) {
      const down = databaseUnavailable();
      return send(res, down.status, down.body);
    }
    console.error(error);
    const failure = serverError();
    send(res, failure.status, failure.body);
  }
}

function isReply(value: unknown): value is Reply {
  return typeof value === "object" && value !== null && "status" in value && typeof (value as { status: unknown }).status === "number";
}
