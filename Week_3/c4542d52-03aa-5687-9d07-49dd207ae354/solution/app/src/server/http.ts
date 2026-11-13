import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Person } from "../shared/types.js";
import { databaseReady } from "./db.js";
import { ApiError, forbidden, internalError, notFound, refuseUpgrade, sendError, sendJson, unauthenticated, unavailable } from "./errors.js";
import { acceptSocket, currentSequence } from "./live.js";
import { personForToken } from "./people.js";

const BODY_LIMIT = 65536;
const SESSION_COOKIE = "sid";
const PUBLIC_DIR = resolve(fileURLToPath(new URL("./public/", import.meta.url)));

type Reply = { status: number; body?: unknown; headers?: Record<string, string>; bytes?: Buffer };
export type Context = {
  person: Person;
  id: string;
  body: Record<string, unknown>;
  query: URLSearchParams;
  header: (name: string) => string | undefined;
  token: string;
};
type PublicContext = Omit<Context, "person"> & { person: Person | null };

type Route = { method: string; pattern: RegExp; open: boolean; handler: (context: PublicContext) => Promise<Reply> };
const routes: Route[] = [];

function compile(path: string): RegExp {
  return new RegExp(`^${path.replace(/:[a-z]+/g, "([^/]+)")}$`);
}

/** A route that needs a signed-in person. */
export function route(method: string, path: string, handler: (context: Context) => Promise<Reply>): void {
  routes.push({ method, pattern: compile(path), open: false, handler: (context) => handler(context as Context) });
}

/** A route anyone may call. */
export function openRoute(method: string, path: string, handler: (context: PublicContext) => Promise<Reply>): void {
  routes.push({ method, pattern: compile(path), open: true, handler });
}

function cookieValue(request: IncomingMessage, name: string): string | null {
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export const sessionCookie = (token: string): string => `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`;
export const clearedSessionCookie = `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

function ownOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const length = Number.parseInt(request.headers["content-length"] ?? "0", 10);
  const hasBody = length > 0 || request.headers["transfer-encoding"] !== undefined;
  if (!hasBody) return {};
  if (length > BODY_LIMIT) throw new ApiError(413, "payload_too_large", "That request is too large.");
  if (!/^application\/json\b/i.test(request.headers["content-type"] ?? "")) {
    throw new ApiError(415, "unsupported_media_type", "Send the request as application/json.");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > BODY_LIMIT) throw new ApiError(413, "payload_too_large", "That request is too large.");
    chunks.push(chunk as Buffer);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    throw new ApiError(400, "bad_json", "The request body is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ApiError(400, "bad_json", "The request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

type Address = { pathname: string; searchParams: URLSearchParams };

function addressOf(request: IncomingMessage): Address {
  const [pathname = "/", search = ""] = (request.url ?? "/").split("?", 2);
  return { pathname, searchParams: new URLSearchParams(search) };
}

async function handleApi(request: IncomingMessage, response: ServerResponse, url: Address): Promise<void> {
  const method = request.method ?? "GET";
  const body = await readBody(request);
  if (method !== "GET" && method !== "HEAD" && !ownOrigin(request)) throw forbidden();
  if (url.pathname === "/api/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }
  if (!databaseReady) throw unavailable("register_unavailable", "The register database is starting. Try again shortly.");
  const match = routes
    .filter((candidate) => candidate.method === method)
    .map((candidate) => ({ candidate, found: candidate.pattern.exec(url.pathname) }))
    .find((entry) => entry.found !== null);
  if (!match || !match.found) throw notFound();
  const token = cookieValue(request, SESSION_COOKIE) ?? "";
  const person = token ? await personForToken(token) : null;
  if (!person && !match.candidate.open) throw unauthenticated();
  const reply = await match.candidate.handler({
    person,
    id: decodeURIComponent(match.found[1] ?? ""),
    body,
    query: url.searchParams,
    header: (name) => {
      const value = request.headers[name.toLowerCase()];
      return Array.isArray(value) ? value[0] : value;
    },
    token,
  });
  if (reply.bytes) {
    response.writeHead(reply.status, { "Content-Length": reply.bytes.length, "Cache-Control": "no-store", ...reply.headers });
    response.end(reply.bytes);
  } else if (reply.status === 204) {
    response.writeHead(204, { "Cache-Control": "no-store", ...reply.headers });
    response.end();
  } else {
    sendJson(response, reply.status, reply.body, reply.headers);
  }
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
};

/** A file that is not there is a plain 404 for the browser; any other failure is a real error. */
function missingFile(error: NodeJS.ErrnoException): null {
  if (error.code === "ENOENT" || error.code === "EISDIR") return null;
  throw error;
}

async function serveStatic(url: Address, response: ServerResponse): Promise<void> {
  const requested = normalize(decodeURIComponent(url.pathname));
  const extension = extname(requested);
  const file = extension === "" ? join(PUBLIC_DIR, "index.html") : join(PUBLIC_DIR, requested);
  const bytes = file.startsWith(PUBLIC_DIR) ? await readFile(file).catch(missingFile) : null;
  if (bytes === null) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
    "Content-Length": bytes.length,
    "Cache-Control": extname(file) === ".html" ? "no-cache" : "public, max-age=3600",
  });
  response.end(bytes);
}

export function createHttpServer(): Server {
  const server = createServer((request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "same-origin");
    const url = addressOf(request);
    const work = url.pathname.startsWith("/api/") || url.pathname === "/api" ? handleApi(request, response, url) : serveStatic(url, response);
    work.catch((error: unknown) => {
      if (response.headersSent) return;
      if (error instanceof ApiError) sendError(response, error);
      else {
        console.error(error);
        sendError(response, internalError());
      }
    });
  });
  server.on("upgrade", (request, socket, head) => {
    const url = addressOf(request);
    if (url.pathname !== "/api/live") return refuseUpgrade(socket, notFound());
    if (!ownOrigin(request) || request.headers.origin === undefined) return refuseUpgrade(socket, forbidden());
    const token = cookieValue(request, SESSION_COOKIE) ?? "";
    const since = url.searchParams.get("since");
    void (async () => {
      const person = databaseReady && token ? await personForToken(token) : null;
      if (!person) return refuseUpgrade(socket, unauthenticated());
      const parsed = since === null ? null : Number.parseInt(since, 10);
      acceptSocket(request, socket, head, person.id, parsed !== null && Number.isFinite(parsed) ? parsed : await currentSequence());
    })().catch((error: unknown) => {
      console.error("socket upgrade failed:", error);
      refuseUpgrade(socket, internalError());
    });
  });
  return server;
}
