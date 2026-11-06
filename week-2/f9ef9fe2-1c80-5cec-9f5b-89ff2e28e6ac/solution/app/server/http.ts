import { readdirSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { ApiError, refuse } from "./errors.js";

// Transport rules from the brief's Server boundary and the first three steps of the error
// precedence (cross origin, body size and type, malformed JSON), then routing and the reply.

const JSON_LIMIT = 64_000;
const UPLOAD_LIMIT = 5_200_000;

export interface ApiRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  headers: http.IncomingHttpHeaders;
  /** Parsed JSON body (an empty body reads as `{}`); null for multipart and bodiless methods. */
  json: unknown;
  /** Raw bytes of a multipart body. */
  raw: Buffer;
}

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  bytes?: Buffer;
}

export type Handler = (request: ApiRequest) => Promise<Reply>;

interface Route {
  method: string;
  pattern: RegExp;
  names: string[];
  multipart: boolean;
  handler: Handler;
}

const routes: Route[] = [];

export function route(method: string, template: string, handler: Handler, multipart = false): void {
  const names: string[] = [];
  const source = template.replace(/:([a-z_]+)/g, (_, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  routes.push({ method, pattern: new RegExp(`^${source}$`), names, multipart, handler });
}

export const json = (status: number, body: unknown, headers: Record<string, string> = {}): Reply => ({
  status,
  body,
  headers,
});

function sameOrigin(request: http.IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

async function readBody(request: http.IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += piece.length;
    if (size <= limit) chunks.push(piece);
  }
  return size > limit ? null : Buffer.concat(chunks);
}

function send(response: http.ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { "X-Content-Type-Options": "nosniff", ...reply.headers };
  if (reply.bytes) {
    response.writeHead(reply.status, headers);
    response.end(reply.bytes);
    return;
  }
  if (reply.body === undefined) {
    response.writeHead(reply.status, headers);
    response.end();
    return;
  }
  response.writeHead(reply.status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(reply.body));
}

function sendError(response: http.ServerResponse, error: ApiError): void {
  send(response, { status: error.status, body: error.body() });
}

async function handleApi(request: http.IncomingMessage, url: URL): Promise<Reply> {
  const method = request.method ?? "GET";
  const writes = method === "POST" || method === "PATCH" || method === "DELETE";
  if (writes && !sameOrigin(request)) {
    request.resume();
    throw refuse.crossOrigin();
  }
  const found = routes
    .filter((r) => r.method === method)
    .map((r) => ({ r, match: r.pattern.exec(url.pathname) }))
    .find((x) => x.match !== null);
  const multipart = found?.r.multipart ?? false;
  const raw = await readBody(request, multipart ? UPLOAD_LIMIT : JSON_LIMIT);
  if (raw === null) throw refuse.payloadTooLarge();
  const type = (request.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  let body: unknown = null;
  if (writes && raw.length > 0) {
    if (multipart ? type !== "multipart/form-data" : type !== "application/json") {
      throw refuse.unsupportedMediaType();
    }
    if (!multipart) {
      try {
        body = JSON.parse(raw.toString("utf8"));
      } catch {
        throw refuse.invalidJson();
      }
    }
  } else if (writes) {
    body = {};
  }
  if (!found || !found.match) throw refuse.notFound();
  const params: Record<string, string> = {};
  found.r.names.forEach((name, i) => {
    params[name] = decodeURIComponent(found.match?.[i + 1] ?? "");
  });
  return found.r.handler({
    method,
    path: url.pathname,
    query: url.searchParams,
    params,
    headers: request.headers,
    json: body,
    raw,
  });
}

// ---- the built browser app ------------------------------------------------------------------

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

const SCREENS = new Set(["/", "/signin", "/loom", "/bookings", "/papers", "/billing", "/members", "/rates", "/reports"]);

function listFiles(root: string, dir = root, found = new Map<string, string>()): Map<string, string> {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) listFiles(root, full, found);
    else found.set(`/${path.relative(root, full).split(path.sep).join("/")}`, full);
  }
  return found;
}

function staticFiles(root: string): (pathname: string) => Reply {
  const files = listFiles(root);
  const index = files.get("/index.html");
  if (!index) throw new Error("The browser app is not built");
  const indexBytes = readFileSync(index);
  return (pathname) => {
    if (SCREENS.has(pathname)) {
      return { status: 200, bytes: indexBytes, headers: { "Content-Type": TYPES[".html"] ?? "", "Cache-Control": "no-cache" } };
    }
    const file = files.get(pathname);
    if (!file || pathname === "/index.html") throw refuse.notFound();
    const immutable = pathname.startsWith("/assets/") || pathname.startsWith("/fonts/");
    return {
      status: 200,
      bytes: readFileSync(file),
      headers: {
        "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
        "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      },
    };
  };
}

export function createServer(clientRoot: string): http.Server {
  const serveStatic = staticFiles(clientRoot);
  return http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://pilotlight.invalid");
    const work = url.pathname.startsWith("/api/")
      ? handleApi(request, url)
      : request.method === "GET" || request.method === "HEAD"
        ? Promise.resolve().then(() => serveStatic(url.pathname))
        : Promise.reject(refuse.notFound());
    work.then(
      (reply) => send(response, reply),
      (error: unknown) => {
        if (error instanceof ApiError) {
          sendError(response, error);
          return;
        }
        console.error(`${request.method ?? ""} ${url.pathname} failed: ${error instanceof Error ? error.name : "error"}`);
        sendError(response, new ApiError(500, "internal", "Something went wrong. Try again."));
      },
    );
  });
}
