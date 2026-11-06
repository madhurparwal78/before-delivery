// Request plumbing: body limits, routing, the error shape, page and asset serving (brief: Server boundary).
import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { read } from "./db.js";
import { ApiError, notFound } from "./errors.js";
import { staffById, type Staff } from "./model.js";

export const JSON_LIMIT = 65_536;
export const PHOTO_LIMIT = 10_000_000;

export interface Ctx {
  req: IncomingMessage;
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  body: Buffer;
  staff: Staff;
}

export type Reply =
  | { status: number; json: unknown }
  | { status: number; raw: Buffer | string; contentType: string; headers?: Record<string, string> };

export interface Route {
  method: string;
  pattern: RegExp;
  /** false for the routes anyone may call (no X-Staff-Id). */
  staff: boolean;
  handler: (ctx: Ctx) => Promise<Reply>;
}

export function route(method: string, pattern: string, handler: Route["handler"], staff = true): Route {
  const source = pattern.replace(/:(\w+)/g, (_, name: string) => `(?<${name}>[^/]+)`);
  return { method, pattern: new RegExp(`^${source}$`), staff, handler };
}

export function json(status: number, body: unknown): Reply {
  return { status, json: body };
}

/** Parses a JSON object body; anything else is a validation failure. */
export function jsonBody(ctx: Ctx): Record<string, unknown> {
  if (ctx.body.length === 0) return {};
  try {
    const value: unknown = JSON.parse(ctx.body.toString("utf8"));
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // fall through to the refusal below
  }
  throw new ApiError(422, "validation_failed", "Send a JSON object.", { fields: {} });
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

export function send(res: ServerResponse, reply: Reply): void {
  if ("json" in reply) {
    const body = JSON.stringify(reply.json);
    res.writeHead(reply.status, {
      ...SECURITY_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
    return;
  }
  res.writeHead(reply.status, {
    ...SECURITY_HEADERS,
    "Content-Type": reply.contentType,
    "Content-Length": Buffer.byteLength(reply.raw),
    ...reply.headers,
  });
  res.end(reply.raw);
}

export function sendError(res: ServerResponse, error: ApiError): void {
  send(res, json(error.status, error.body()));
}

/** Reads the whole body; past the limit the rest is drained and the answer is 413. */
export function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = Number(req.headers["content-length"] ?? 0) > limit;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) over = true;
      if (!over) chunks.push(chunk);
    });
    req.on("end", () => resolve(over ? null : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export async function dispatch(
  routes: Route[],
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: Buffer,
): Promise<void> {
  const method = req.method === "HEAD" ? "GET" : (req.method ?? "GET");
  let matched: { route: Route; params: Record<string, string> } | null = null;
  for (const candidate of routes) {
    const m = candidate.method === method ? candidate.pattern.exec(url.pathname) : null;
    if (m) {
      matched = { route: candidate, params: { ...m.groups } };
      break;
    }
  }
  if (!matched) throw notFound();
  const staffHeader = req.headers["x-staff-id"];
  const staff = matched.route.staff
    ? await read((db) => staffById(db, Array.isArray(staffHeader) ? staffHeader[0] : staffHeader))
    : ({ id: "", name: "", role: "curator" } satisfies Staff);
  const reply = await matched.route.handler({
    req,
    method,
    path: url.pathname,
    query: url.searchParams,
    params: Object.fromEntries(Object.entries(matched.params).map(([k, v]) => [k, decodeURIComponent(v)])),
    body,
    staff,
  });
  send(res, reply);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.resolve(here, "../../dist/client");

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".html": "text/html; charset=utf-8",
};

export const PAGE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
};

let shell: string | null = null;
export async function pageShell(): Promise<string> {
  shell ??= await readFile(path.join(CLIENT_DIR, "index.html"), "utf8");
  return shell;
}

/** Built assets under dist/client only; nothing outside it is ever served. */
export async function staticAsset(pathname: string): Promise<Reply | null> {
  if (!pathname.startsWith("/assets/") && pathname !== "/favicon.svg") return null;
  const file = path.resolve(CLIENT_DIR, `.${pathname}`);
  if (!file.startsWith(`${CLIENT_DIR}${path.sep}`)) return null;
  try {
    if (!(await stat(file)).isFile()) return null;
  } catch {
    return null;
  }
  return {
    status: 200,
    raw: await readFile(file),
    contentType: TYPES[path.extname(file)] ?? "application/octet-stream",
    headers: { "Cache-Control": "public, max-age=31536000, immutable" },
  };
}
