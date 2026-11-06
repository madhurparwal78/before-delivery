// The HTTP boundary: transport errors, the cross-site refusal, routing, the one error shape, and
// same-origin static assets with the app shell for every other page path.
//
// Error precedence for the whole API: transport (415, 400, 413) → 403 cross_origin → handlers, which
// check 401 → 404 → 403 → idempotency → 422 → 409/410 → 503 in that order.

import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type JsonBody = Record<string, unknown>;

export class HttpError extends Error {
  constructor(readonly status: number, readonly body: JsonBody, readonly headers: Record<string, string> = {}) {
    super(`HTTP ${status}`);
  }
}

export function notFound(): HttpError {
  return new HttpError(404, { error: "not_found" });
}

export function validationError(errors: Record<string, string>): HttpError {
  return new HttpError(422, { errors });
}

/** A JSON number as it was written, so exact decimals never pass through binary floating point. */
export class JsonNumber {
  constructor(readonly source: string) {}
}

export interface Reply {
  status: number;
  /** A JSON-serialisable body, or the exact text of a stored JSON body. */
  json?: unknown;
  rawJson?: string;
  bytes?: Buffer;
  headers?: Record<string, string>;
}

export interface Context {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: JsonBody;
  headers: IncomingMessage["headers"];
  cookies: Record<string, string>;
}

export interface Route {
  method: string;
  pattern: RegExp;
  bodyLimit?: number;
  handle: (ctx: Context) => Promise<Reply>;
}

const BODY_LIMIT = 65_536;
const DRAIN_LIMIT = 8_000_000;

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
};

function send(res: ServerResponse, status: number, headers: Record<string, string>, payload: Buffer | string): void {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(payload);
}

function sendJson(res: ServerResponse, status: number, text: string, headers: Record<string, string> = {}): void {
  send(res, status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }, text);
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) cookies[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return cookies;
}

function mediaType(header: string | undefined): string {
  return (header ?? "").split(";")[0]!.trim().toLowerCase();
}

/** Reads the body; null when it is over the limit (the rest is drained so the client sees the reply). */
async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > DRAIN_LIMIT) req.destroy();
    else if (size <= limit) chunks.push(chunk);
  }
  return size > limit ? null : Buffer.concat(chunks);
}

function parseJson(text: string): unknown {
  type Reviver = (this: unknown, key: string, value: unknown, context?: { source?: string }) => unknown;
  const reviver: Reviver = (_key, value, context) =>
    typeof value === "number" && context?.source !== undefined ? new JsonNumber(context.source) : value;
  return JSON.parse(text, reviver as Parameters<typeof JSON.parse>[1]);
}

function defaultPort(protocol: string): string {
  return protocol === "https:" ? "443" : "80";
}

/** A non-GET API request is cross-site when its Origin names another host and port, or its fetch site says so. */
function isCrossSite(req: IncomingMessage): boolean {
  if (req.headers["sec-fetch-site"] === "cross-site") return true;
  const origin = req.headers.origin;
  if (origin === undefined) return false;
  let originHost: URL;
  try {
    originHost = new URL(origin);
  } catch {
    return true;
  }
  const [hostName, hostPort] = (req.headers.host ?? "").toLowerCase().split(/:(?=\d+$)/);
  return originHost.hostname.toLowerCase() !== hostName ||
    (originHost.port || defaultPort(originHost.protocol)) !== (hostPort || defaultPort(originHost.protocol));
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL, routes: Route[]): Promise<void> {
  const method = req.method ?? "GET";
  const forPath = routes.filter((r) => r.pattern.test(url.pathname));
  const route = forPath.find((r) => r.method === method);

  const raw = await readBody(req, route?.bodyLimit ?? BODY_LIMIT);
  const hasBody = raw === null || raw.length > 0;
  if (hasBody && mediaType(req.headers["content-type"]) !== "application/json") {
    return sendJson(res, 415, JSON.stringify({ error: "unsupported_media_type" }));
  }
  if (raw === null) return sendJson(res, 413, JSON.stringify({ error: "payload_too_large" }));
  let body: unknown = {};
  if (raw.length > 0) {
    try {
      body = parseJson(raw.toString("utf8"));
    } catch {
      return sendJson(res, 400, JSON.stringify({ error: "invalid_json" }));
    }
  }
  if (method !== "GET" && isCrossSite(req)) return sendJson(res, 403, JSON.stringify({ error: "cross_origin" }));
  if (!route) return sendJson(res, 404, JSON.stringify({ error: "not_found" }));

  const match = route.pattern.exec(url.pathname)!;
  const ctx: Context = {
    method, path: url.pathname, query: url.searchParams, headers: req.headers,
    params: Object.fromEntries(Object.entries(match.groups ?? {}).map(([k, v]) => [k, decodeURIComponent(v)])),
    body: body !== null && typeof body === "object" && !Array.isArray(body) ? (body as JsonBody) : {},
    cookies: parseCookies(req.headers.cookie),
  };
  let reply: Reply;
  try {
    reply = await route.handle(ctx);
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    return sendJson(res, error.status, JSON.stringify(error.body), error.headers);
  }
  if (reply.bytes) return send(res, reply.status, { "Cache-Control": "no-store", ...reply.headers }, reply.bytes);
  if (reply.rawJson !== undefined) return sendJson(res, reply.status, reply.rawJson, reply.headers);
  if (reply.json === undefined) {
    res.writeHead(reply.status, { ...SECURITY_HEADERS, ...reply.headers });
    return void res.end();
  }
  sendJson(res, reply.status, JSON.stringify(reply.json), reply.headers);
}

// --- Static assets ---------------------------------------------------------------------------

const CLIENT_DIR = fileURLToPath(new URL("../client/", import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

async function staticAsset(res: ServerResponse, pathname: string): Promise<void> {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
  const file = normalize(CLIENT_DIR + relative);
  const servable = relative.startsWith(`assets${sep}`) && file.startsWith(CLIENT_DIR) && CONTENT_TYPES[extname(file)];
  if (servable) {
    try {
      const bytes = await readFile(file);
      return send(res, 200, { "Content-Type": CONTENT_TYPES[extname(file)]!, "Cache-Control": "public, max-age=31536000, immutable" }, bytes);
    } catch {
      // not an asset: fall through to the app shell
    }
  }
  const shell = await readFile(`${CLIENT_DIR}index.html`);
  send(res, 200, { "Content-Type": CONTENT_TYPES[".html"]!, "Cache-Control": "no-cache" }, shell);
}

export function createHandler(routes: Route[]) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://app.invalid");
    try {
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) await api(req, res, url, routes);
      else await staticAsset(res, url.pathname);
    } catch (error) {
      console.error(`request ${req.method} ${url.pathname} failed: ${error instanceof Error ? error.name : "error"}`);
      if (!res.headersSent) sendJson(res, 500, JSON.stringify({ error: "internal" }));
      else res.destroy();
    }
  };
}
