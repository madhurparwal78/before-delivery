import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import type { Session, Task } from "../shared/types.js";

const JSON_LIMIT = 65_536;
const FILE_LIMIT = 1_000_000;

type BodyKind = "json" | "csv" | "calendar";

const MEDIA: Record<BodyKind, string> = {
  json: "application/json",
  csv: "text/csv",
  calendar: "text/calendar",
};

type Reply = {
  status: number;
  json?: unknown;
  body?: string | Buffer;
  contentType?: string;
  headers?: Record<string, string>;
};

export type Context = {
  req: IncomingMessage;
  url: URL;
  params: Record<string, string>;
  raw: Buffer;
  origin: string;
  cookies: Record<string, string>;
};

type Handler = (ctx: Context) => Promise<Reply>;

type Route = { method: string; pattern: RegExp; keys: string[]; body: BodyKind | null; handler: Handler };

type ErrorExtra = { fields?: Record<string, string>; current?: Task | Session };

/** The one builder for every error response body: {"error","message"} plus fields or current. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: ErrorExtra = {},
  ) {
    super(message);
  }

  reply(): Reply {
    return { status: this.status, json: { error: this.code, message: this.message, ...this.extra } };
  }
}

export function invalid(fields: Record<string, string>): HttpError {
  return new HttpError(422, "validation_failed", "Some fields need attention.", { fields });
}

const routes: Route[] = [];

/** Registers an endpoint. `body` names the media type a request body must carry. */
export function route(method: string, path: string, handler: Handler, body: BodyKind | null = null): void {
  const keys: string[] = [];
  const source = path.replace(/\{(\w+)(\*?)\}/g, (_, key: string, rest: string) => {
    keys.push(key);
    return rest ? "(.*)" : "([^/]+)";
  });
  routes.push({ method, pattern: new RegExp(`^${source}$`), keys, body, handler });
}

export function json(status: number, body: unknown, headers?: Record<string, string>): Reply {
  return { status, json: body, headers };
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const piece of (header ?? "").split(";")) {
    const at = piece.indexOf("=");
    if (at > 0) out[piece.slice(0, at).trim()] = decodeURIComponent(piece.slice(at + 1).trim());
  }
  return out;
}

function mediaType(req: IncomingMessage): string {
  return (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
}

function hasBody(req: IncomingMessage): boolean {
  const length = req.headers["content-length"];
  if (length !== undefined) return Number(length) > 0;
  return req.headers["transfer-encoding"] !== undefined;
}

function limitFor(req: IncomingMessage): number {
  const type = mediaType(req);
  return type === MEDIA.csv || type === MEDIA.calendar ? FILE_LIMIT : JSON_LIMIT;
}

class TooLarge extends Error {}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const piece = chunk instanceof Buffer ? chunk : Buffer.from(String(chunk));
    size += piece.length;
    if (size > limit) throw new TooLarge();
    chunks.push(piece);
  }
  return Buffer.concat(chunks);
}

export function parseJson(ctx: Context): Record<string, unknown> {
  if (ctx.raw.length === 0) return {};
  let value: unknown;
  try {
    value = JSON.parse(ctx.raw.toString("utf8"));
  } catch {
    throw new HttpError(422, "invalid_json", "The request body is not valid JSON.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(422, "invalid_json", "The request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

// Static browser assets: only files produced by the build, plus the client-side routes.
const PUBLIC_DIR = join(import.meta.dirname, "public");
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8",
};
const assets = new Map<string, { type: string; body: Buffer }>();
const SHELL_ROUTES = [/^\/$/, /^\/start$/, /^\/settings$/, /^\/workspace$/, /^\/operations$/, /^\/join\/[^/]+$/];

export async function loadAssets(): Promise<void> {
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path, `${prefix}/${entry.name}`);
      else if (TYPES[extname(entry.name)]) {
        assets.set(`${prefix}/${entry.name}`, { type: TYPES[extname(entry.name)], body: await readFile(path) });
      }
    }
  };
  await walk(PUBLIC_DIR, "");
}

function serveStatic(path: string): Reply {
  const shell = SHELL_ROUTES.some((pattern) => pattern.test(path));
  const asset = assets.get(shell ? "/index.html" : path);
  if (!asset || (!shell && path === "/index.html")) return notFoundText();
  return {
    status: 200,
    body: asset.body,
    contentType: asset.type,
    headers: { "Cache-Control": shell ? "no-cache" : "public, max-age=3600" },
  };
}

export function notFoundText(): Reply {
  return { status: 404, body: "Not found", contentType: "text/plain; charset=utf-8" };
}

function send(res: ServerResponse, reply: Reply): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  for (const [name, value] of Object.entries(reply.headers ?? {})) res.setHeader(name, value);
  if (reply.json !== undefined) {
    const body = Buffer.from(JSON.stringify(reply.json));
    res.writeHead(reply.status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length });
    res.end(body);
  } else if (reply.body !== undefined) {
    const body = typeof reply.body === "string" ? Buffer.from(reply.body) : reply.body;
    res.writeHead(reply.status, { "Content-Type": reply.contentType ?? "text/plain; charset=utf-8", "Content-Length": body.length });
    res.end(body);
  } else {
    res.writeHead(reply.status);
    res.end();
  }
}

/** Runs one request through the API's error precedence: 405, 413, 415, 403, then the handler. */
export async function dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";
  const path = url.pathname;
  const matching = routes.filter((r) => r.pattern.test(path));
  const write = method !== "GET" && method !== "HEAD";
  try {
    if (matching.length === 0) {
      if (path.startsWith("/api/")) throw new HttpError(404, "not_found", "There is no such endpoint.");
      send(res, write ? notFoundText() : serveStatic(path));
      return;
    }
    const chosen = matching.find((r) => r.method === method || (method === "HEAD" && r.method === "GET"));
    if (!chosen) {
      res.setHeader("Allow", [...new Set(matching.map((r) => r.method))].join(", "));
      throw new HttpError(405, "method_not_allowed", "This method is not allowed on this path.");
    }
    const limit = limitFor(req);
    if (Number(req.headers["content-length"] ?? 0) > limit) {
      throw new HttpError(413, "payload_too_large", "The request body is too large.");
    }
    if (write && hasBody(req) && (chosen.body === null || mediaType(req) !== MEDIA[chosen.body])) {
      throw new HttpError(415, "unsupported_media_type", "This endpoint does not accept that content type.");
    }
    const host = req.headers.host ?? "";
    const origin = `http://${host}`;
    if (write && req.headers.origin !== undefined && req.headers.origin !== origin) {
      throw new HttpError(403, "cross_origin", "Writes are only accepted from this app's own origin.");
    }
    let raw: Buffer;
    try {
      raw = write ? await readBody(req, limit) : Buffer.alloc(0);
    } catch (error) {
      if (error instanceof TooLarge) throw new HttpError(413, "payload_too_large", "The request body is too large.");
      throw error;
    }
    const match = chosen.pattern.exec(path);
    const params = Object.fromEntries(chosen.keys.map((key, i) => [key, decodeURIComponent(match?.[i + 1] ?? "")]));
    const reply = await chosen.handler({ req, url, params, raw, origin, cookies: parseCookies(req.headers.cookie) });
    send(res, reply);
  } catch (error) {
    if (error instanceof HttpError) {
      send(res, error.reply());
      return;
    }
    console.error("Unhandled request error:", error instanceof Error && "code" in error ? String(error.code) : error instanceof Error ? error.name : "unknown");
    send(res, new HttpError(500, "server_error", "Something went wrong on our side. Nothing was changed.").reply());
  }
}
