import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { ApiError, fail } from "./errors.js";

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const CLIENT_ROOT = path.join(APP_ROOT, "dist", "client");

const JSON_LIMIT = 65536;
const IMAGE_LIMIT = 5_000_000;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export interface Req {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: http.IncomingHttpHeaders;
  ip: string;
  cookies: Record<string, string>;
  /** Parsed JSON body; undefined when the request had none. */
  json: unknown;
  /** Exact bytes of the body. */
  raw: Buffer;
  /** Headers every response to this request carries (rate-limit headers). */
  extraHeaders: Record<string, string>;
}

export interface Reply {
  status: number;
  /** Serialised JSON, sent byte for byte. */
  json?: string;
  bytes?: Buffer;
  contentType?: string;
  headers?: Record<string, string>;
  cookies?: string[];
}

export function reply(status: number, body?: unknown, extra: Omit<Reply, "status" | "json"> = {}): Reply {
  return { status, ...(body === undefined ? {} : { json: JSON.stringify(body) }), ...extra };
}

type BodyKind = "json" | "image" | "none";
type Handler = (req: Req, params: Record<string, string>) => Promise<Reply>;
type StreamHandler = (req: Req, res: http.ServerResponse, params: Record<string, string>) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  body: BodyKind;
  handler?: Handler;
  stream?: StreamHandler;
}

const routes: Route[] = [];

function compile(pattern: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = pattern.replace(/:(\w+)/g, (_, key: string) => {
    keys.push(key);
    return "([^/]+)";
  });
  return { pattern: new RegExp(`^${source}$`), keys };
}

export function route(method: string, pattern: string, handler: Handler, body: BodyKind = method === "GET" ? "none" : "json") {
  routes.push({ method, ...compile(pattern), body, handler });
}

export function streamRoute(pattern: string, stream: StreamHandler) {
  routes.push({ method: "GET", ...compile(pattern), body: "none", stream });
}

/** A path parameter as text: a malformed escape stays as sent and a NUL (which Postgres refuses) becomes U+FFFD, so
 * either one simply names no resource and the request answers in the API's error order. */
function param(raw: string): string {
  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch {
    // not valid percent-encoding: keep the raw text
  }
  return text.replaceAll("\0", "\uFFFD");
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

function sameOrigin(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  const host = req.headers.host ?? "";
  return origin === `http://${host}` || origin === `https://${host}` || origin === new URL(config.publicBaseUrl).origin;
}

function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) over = true;
      else if (!over) chunks.push(chunk);
    });
    req.on("end", () => (over ? reject(new ApiError("too_large")) : resolve(Buffer.concat(chunks))));
    req.on("error", reject);
  });
}

function mediaType(req: http.IncomingMessage): string | undefined {
  return req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
}

async function boundary(req: http.IncomingMessage, kind: BodyKind): Promise<{ raw: Buffer; json: unknown }> {
  const writes = req.method !== "GET" && req.method !== "HEAD";
  if (writes && !sameOrigin(req)) fail("cross_origin");
  const limit = kind === "image" ? IMAGE_LIMIT : JSON_LIMIT;
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > limit) {
    req.resume();
    fail("too_large");
  }
  const type = mediaType(req);
  if (kind === "image" && !(IMAGE_TYPES as readonly string[]).includes(type ?? "")) {
    req.resume();
    fail("unsupported_media_type");
  }
  if (kind === "json" && type !== undefined && type !== "application/json") {
    req.resume();
    fail("unsupported_media_type");
  }
  const raw = writes ? await readBody(req, limit) : Buffer.alloc(0);
  if (kind !== "json" || raw.length === 0) return { raw, json: undefined };
  try {
    return { raw, json: JSON.parse(raw.toString("utf8")) as unknown };
  } catch {
    throw new ApiError("validation", { fields: { body: "Check this value" } });
  }
}

function send(res: http.ServerResponse, out: Reply, extra: Record<string, string>) {
  const headers: Record<string, string | string[]> = { "X-Content-Type-Options": "nosniff", ...extra, ...out.headers };
  if (out.cookies?.length) headers["Set-Cookie"] = out.cookies;
  if (out.json !== undefined) {
    headers["Content-Type"] = "application/json; charset=utf-8";
    res.writeHead(out.status, headers).end(out.json);
  } else if (out.bytes) {
    headers["Content-Type"] = out.contentType ?? "application/octet-stream";
    res.writeHead(out.status, headers).end(out.bytes);
  } else {
    res.writeHead(out.status, headers).end();
  }
}

export function errorReply(error: unknown): Reply {
  if (error instanceof ApiError) return reply(error.status, error.body(), { headers: error.headers });
  console.error(error);
  return reply(500, { error: { code: "internal", message: "Something went wrong" } });
}

const SPA = /^\/(?:signin|workshops|billing|activity|join\/[^/]+|w\/[^/]+|recap\/[^/]+)?$/;
const ASSET = /^\/(?:assets|fonts)\/[A-Za-z0-9._-]+$/;
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".html": "text/html; charset=utf-8",
};

function serveStatic(res: http.ServerResponse, pathname: string, method: string) {
  const file = SPA.test(pathname) ? "index.html" : ASSET.test(pathname) || pathname === "/favicon.svg" ? pathname.slice(1) : null;
  const ext = file ? path.extname(file) : "";
  const full = file ? path.join(CLIENT_ROOT, file) : "";
  if (!file || !TYPES[ext] || !full.startsWith(CLIENT_ROOT) || !fs.existsSync(full)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" }).end("Not found");
    return;
  }
  const cache = file === "index.html" ? "no-cache" : "public, max-age=31536000, immutable";
  res.writeHead(200, { "Content-Type": TYPES[ext] ?? "application/octet-stream", "Cache-Control": cache, "X-Content-Type-Options": "nosniff" });
  if (method === "HEAD") res.end();
  else fs.createReadStream(full).pipe(res);
}

export function createServer(): http.Server {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";
    if (!url.pathname.startsWith("/api/")) {
      if (method === "GET" || method === "HEAD") serveStatic(res, url.pathname, method);
      else res.writeHead(404).end();
      return;
    }
    let params: Record<string, string> = {};
    const found = routes.find((r) => {
      if (r.method !== method) return false;
      const match = r.pattern.exec(url.pathname);
      if (!match) return false;
      params = Object.fromEntries(r.keys.map((key, i) => [key, param(match[i + 1] ?? "")]));
      return true;
    });
    const request: Req = {
      method,
      path: url.pathname,
      query: url.searchParams,
      headers: req.headers,
      ip: req.socket.remoteAddress ?? "",
      cookies: parseCookies(req.headers.cookie),
      json: undefined,
      raw: Buffer.alloc(0),
      extraHeaders: {},
    };
    void (async () => {
      try {
        if (!found) fail("not_found");
        const body = await boundary(req, found.body);
        request.json = body.json;
        request.raw = body.raw;
        if (found.stream) await found.stream(request, res, params);
        else if (found.handler) send(res, await found.handler(request, params), request.extraHeaders);
      } catch (error) {
        if (!res.headersSent) send(res, errorReply(error), request.extraHeaders);
        else res.end();
      }
    })();
  });
}
