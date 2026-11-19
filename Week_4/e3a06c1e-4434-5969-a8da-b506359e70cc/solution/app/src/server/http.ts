// HTTP plumbing: the one error shape, body limits, routing and the static browser bundle.
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFound = () => new ApiError(404, "not_found", "Not found.");
export const forbidden = () => new ApiError(403, "forbidden", "Your role can't do that.");
export const invalid = (fields: Record<string, string>) => new ApiError(422, "validation_failed", "Some fields need attention.", fields);
export const internalError = () => new ApiError(500, "internal", "Something went wrong. Try again.");

const JSON_LIMIT = 65_536;
const MULTIPART_LIMIT = 50_400_000;

export interface Part {
  name: string;
  filename: string | null;
  data: Buffer;
}

type Body = { kind: "none" } | { kind: "json"; value: unknown } | { kind: "multipart"; parts: Part[] };

export interface Request {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  body: Body;
}

export function sendJson(res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), "cache-control": "no-store", ...headers });
  res.end(text);
}

/** The one error shape: {"error","message"} plus "fields" for validation errors. */
export function errorBody(error: ApiError): { error: string; message: string; fields?: Record<string, string> } {
  return { error: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) };
}

export function sendError(res: ServerResponse, error: ApiError): void {
  sendJson(res, error.status, errorBody(error));
}

/** A log-safe description of an unexpected error: its code or class, never a message that may carry a host or user. */
export function describe(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  return (error as Error & { code?: string }).code ?? error.name;
}

async function drain(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size <= limit) chunks.push(chunk);
  }
  return size <= limit ? Buffer.concat(chunks) : null;
}

function multipart(raw: Buffer, boundary: string): Part[] {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: Part[] = [];
  let at = raw.indexOf(delimiter);
  while (at !== -1) {
    const start = at + delimiter.length;
    if (raw.subarray(start, start + 2).toString() === "--") break;
    const headerEnd = raw.indexOf("\r\n\r\n", start);
    const next = raw.indexOf(Buffer.from(`\r\n--${boundary}`), headerEnd);
    if (headerEnd === -1 || next === -1) break;
    const headers = raw.subarray(start + 2, headerEnd).toString("utf8");
    const disposition = /content-disposition:[^\r\n]*/i.exec(headers)?.[0] ?? "";
    const name = /\bname="([^"]*)"/i.exec(disposition)?.[1];
    const filename = /\bfilename="([^"]*)"/i.exec(disposition)?.[1] ?? null;
    if (name !== undefined) parts.push({ name, filename, data: raw.subarray(headerEnd + 4, next) });
    at = next + 2;
  }
  return parts;
}

/** Reads the body under the published limits: 415 for a non-JSON body on a JSON route, 413 above the limit. */
export async function readBody(req: IncomingMessage, accepts: "json" | "multipart"): Promise<Body> {
  const length = Number(req.headers["content-length"] ?? 0);
  const hasBody = length > 0 || req.headers["transfer-encoding"] !== undefined;
  if (!hasBody) return { kind: "none" };
  const type = (req.headers["content-type"] ?? "").toLowerCase();
  if (accepts === "json") {
    if (!/^application\/json\s*(;|$)/.test(type)) {
      await drain(req, 0);
      throw new ApiError(415, "unsupported_media_type", "Send JSON with Content-Type: application/json.");
    }
    const raw = await drain(req, JSON_LIMIT);
    if (!raw) throw new ApiError(413, "payload_too_large", "JSON bodies can be up to 65,536 bytes.");
    if (raw.length === 0) return { kind: "none" };
    try {
      return { kind: "json", value: JSON.parse(raw.toString("utf8")) };
    } catch {
      // A body that isn't JSON carries no fields; each route then reports its own failing fields.
      return { kind: "none" };
    }
  }
  const boundary = /^multipart\/form-data;.*boundary="?([^";]+)"?/.exec(req.headers["content-type"] ?? "")?.[1];
  if (!boundary) {
    await drain(req, 0);
    throw new ApiError(415, "unsupported_media_type", "Send multipart/form-data.");
  }
  const raw = await drain(req, MULTIPART_LIMIT);
  if (!raw) throw new ApiError(413, "payload_too_large", "Audio files can be up to 50,000,000 bytes.");
  return { kind: "multipart", parts: multipart(raw, boundary) };
}

type Handler = (request: Request) => Promise<void>;

interface Route {
  method: string;
  path: string;
  pattern: RegExp;
  keys: string[];
  body: "json" | "multipart";
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: Handler, body: "json" | "multipart" = "json"): void {
    const keys: string[] = [];
    const source = path.replace(/:(\w+)/g, (_, key: string) => {
      keys.push(key);
      return "([^/]+)";
    });
    this.routes.push({ method, path, pattern: new RegExp(`^${source}$`), keys, body, handler });
  }

  match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
    for (const route of this.routes) {
      const found = route.method === method ? route.pattern.exec(path) : null;
      if (found) return { route, params: Object.fromEntries(route.keys.map((key, i) => [key, decodeURIComponent(found[i + 1])])) };
    }
    return null;
  }
}

// ---- static browser bundle ----
const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
};
const SPA_ROUTES = [/^\/$/, /^\/sign-in$/, /^\/join\/[^/]+$/, /^\/console(?:\/.*)?$/];

let indexHtml: Promise<Buffer> | null = null;

/** Serves the built assets under /assets/ and the page shell for the brief's screens; everything else is 404. */
export async function serveStatic(path: string, res: ServerResponse): Promise<boolean> {
  if (SPA_ROUTES.some((route) => route.test(path))) {
    indexHtml ??= readFile(join(PUBLIC_DIR, "index.html"));
    const html = await indexHtml;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": html.length, "cache-control": "no-cache" });
    res.end(html);
    return true;
  }
  if (!path.startsWith("/assets/") || path.endsWith(".map")) return false;
  const type = TYPES[extname(path)];
  const file = normalize(join(PUBLIC_DIR, path));
  if (!type || !file.startsWith(join(PUBLIC_DIR, "assets"))) return false;
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": type, "content-length": data.length, "cache-control": "public, max-age=3600" });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

/** The JSON object body, or an empty object when there is none. */
export function jsonFields(request: Request): Record<string, unknown> {
  const value = request.body.kind === "json" ? request.body.value : null;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
