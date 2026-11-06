import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ApiError, fail, invalid } from "./errors";
import { authenticate, type Auth } from "./auth";
import { config } from "./config";

// The HTTP boundary: body limits, the same-origin rule, routing, the error shape and the
// built front end. Checks run in the brief's precedence: size, origin, session, then routes.

const JSON_LIMIT = 1_000_000;
const MULTIPART_LIMIT = 10_500_000;
const CLIENT_ROOT = fileURLToPath(new URL("../client/", import.meta.url));

interface Call {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  headers: IncomingMessage["headers"];
  body: Buffer;
}

interface AuthedCall extends Call {
  auth: Auth;
}

export type Reply =
  | { status: number; json: unknown; headers?: Record<string, string> }
  | { status: 200; stream: (res: ServerResponse) => void }
  | { status: number; bytes: Uint8Array; contentType: string; headers?: Record<string, string> }
  | { status: 204; headers?: Record<string, string> };

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: (call: Call) => Promise<Reply>;
}

const routes: Route[] = [];

function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = path.replace(/:(\w+)/g, (_match, key: string) => {
    keys.push(key);
    return "([^/]+)";
  });
  return { pattern: new RegExp(`^${source}$`), keys };
}

/** A route anyone may call, such as the health check and signing in. */
export function publicRoute(method: string, path: string, handler: (call: Call) => Promise<Reply>): void {
  routes.push({ method, ...compile(path), handler });
}

/** A route that needs a live session; the handler receives who is calling. */
export function route(method: string, path: string, handler: (call: AuthedCall) => Promise<Reply>): void {
  publicRoute(method, path, async (call) => handler({ ...call, auth: await authenticate(call.headers) }));
}

export function json(status: number, body: unknown, headers?: Record<string, string>): Reply {
  return headers ? { status, json: body, headers } : { status, json: body };
}

export function noContent(headers?: Record<string, string>): Reply {
  return headers ? { status: 204, headers } : { status: 204 };
}

export function readJson(call: Call): Record<string, unknown> {
  if (call.body.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(call.body.toString("utf8"));
  } catch {
    invalid({ body: "The request body must be JSON." });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    invalid({ body: "The request body must be a JSON object." });
  }
  return parsed as Record<string, unknown>;
}

export async function readForm(call: Call): Promise<FormData> {
  const type = call.headers["content-type"] ?? "";
  if (!type.startsWith("multipart/form-data")) invalid({ file: "Send the image as multipart form data." });
  try {
    return await new Request("http://snaglight.invalid/", {
      method: "POST",
      headers: { "content-type": type },
      body: new Uint8Array(call.body),
    }).formData();
  } catch {
    invalid({ file: "The upload could not be read." });
  }
}

async function readBody(req: IncomingMessage): Promise<Buffer | null> {
  const limit = (req.headers["content-type"] ?? "").startsWith("multipart/form-data") ? MULTIPART_LIMIT : JSON_LIMIT;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size <= limit) chunks.push(chunk as Buffer);
  }
  return size > limit ? null : Buffer.concat(chunks);
}

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function crossOrigin(req: IncomingMessage): boolean {
  if (!STATE_CHANGING.has(req.method ?? "")) return false;
  if (req.headers["sec-fetch-site"] === "cross-site") return true;
  const origin = req.headers.origin;
  if (!origin) return false;
  const own = new Set([`http://${req.headers.host}`, `https://${req.headers.host}`, new URL(config.publicUrl).origin]);
  return !own.has(origin);
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};

function send(res: ServerResponse, reply: Reply): void {
  if ("stream" in reply) return reply.stream(res);
  const headers: Record<string, string> = { ...SECURITY_HEADERS, "Cache-Control": "no-store", ...reply.headers };
  if ("json" in reply) {
    res.writeHead(reply.status, { ...headers, "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(reply.json));
  } else if ("bytes" in reply) {
    res.writeHead(reply.status, { ...headers, "Content-Type": reply.contentType, "Content-Length": reply.bytes.length });
    res.end(reply.bytes);
  } else {
    res.writeHead(reply.status, headers);
    res.end();
  }
}

function sendError(res: ServerResponse, error: ApiError): void {
  send(res, json(error.status, error.body()));
}

/** Path segments with broken percent-encoding name nothing that exists. */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return "";
  }
}

async function handleApi(req: IncomingMessage, res: ServerResponse, path: string, query: URLSearchParams): Promise<void> {
  const body = await readBody(req);
  if (body === null) return sendError(res, new ApiError("too_large"));
  if (crossOrigin(req)) return sendError(res, new ApiError("cross_origin"));
  const method = req.method ?? "GET";
  try {
    for (const candidate of routes) {
      if (candidate.method !== method) continue;
      const match = candidate.pattern.exec(path);
      if (!match) continue;
      const params = Object.fromEntries(candidate.keys.map((key, index) => [key, safeDecode(match[index + 1] ?? "")]));
      return send(res, await candidate.handler({ method, path, params, query, headers: req.headers, body }));
    }
    fail("not_found");
  } catch (error) {
    if (error instanceof ApiError) return sendError(res, error);
    console.error(`${method} ${path} failed:`, error);
    send(res, json(500, { error: "internal", message: "Something went wrong on our side. Try again shortly." }));
  }
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".webmanifest": "application/manifest+json",
};

/** Serves only files from the built front end; any other path gets the app shell. */
async function handleStatic(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { ...SECURITY_HEADERS, Allow: "GET, HEAD" });
    res.end();
    return;
  }
  const requested = normalize(join(CLIENT_ROOT, safeDecode(path)));
  let file = join(CLIENT_ROOT, "index.html");
  if (requested.startsWith(CLIENT_ROOT) && !requested.endsWith(sep)) {
    const info = await stat(requested).catch(() => null);
    if (info?.isFile()) file = requested;
  }
  const immutable = file.startsWith(join(CLIENT_ROOT, "assets") + sep);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    "Content-Type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file)
    .on("error", (error) => {
      console.error(`could not read ${file}:`, error.message);
      res.destroy();
    })
    .pipe(res);
}

export function createAppServer(): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://snaglight.invalid");
    const path = url.pathname;
    const handled = path === "/api" || path.startsWith("/api/") ? handleApi(req, res, path, url.searchParams) : handleStatic(req, res, path);
    handled.catch((error: unknown) => {
      console.error("request failed:", error);
      if (!res.headersSent) send(res, json(500, { error: "internal", message: "Something went wrong on our side. Try again shortly." }));
      else res.destroy();
    });
  });
}
