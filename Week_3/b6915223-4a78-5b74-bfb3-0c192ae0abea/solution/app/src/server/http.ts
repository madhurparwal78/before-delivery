import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { ApiError, notFound } from "./errors.ts";
import { readSession, type Session } from "./session.ts";

// The server boundary (brief: Server boundary): body size, content type, origin, auth, role, one error shape.

const BODY_LIMIT = 65536;
const CLIENT_DIR = fileURLToPath(new URL("./client/", import.meta.url));
const CLIENT_ROUTES = [/^\/$/, /^\/(signin|team|transfers|leagues|history|operator)$/, /^\/leagues\/\d+$/, /^\/leagues\/\d+\/members\/[A-Za-z0-9]+$/];
const ASSET_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
};

type Access = "manager" | "operator" | "signed-in";

interface Request<S extends Session | null = Session> {
  method: string;
  params: Record<string, string>;
  query: URLSearchParams;
  headers: IncomingMessage["headers"];
  body: unknown;
  session: S;
}

export interface Reply {
  status: number;
  body?: unknown;
  raw?: Buffer;
  headers?: Record<string, string>;
}

type Route = { method: string; pattern: RegExp; keys: string[] } & (
  | { access: "public"; handler: (request: Request<Session | null>) => Promise<Reply> }
  | { access: Access; handler: (request: Request) => Promise<Reply> }
);

function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = path.replace(/:(\w+)/g, (_match, key: string) => {
    keys.push(key);
    return "([^/]+)";
  });
  return { pattern: new RegExp(`^${source}$`), keys };
}

export function route(method: string, path: string, access: Access, handler: (request: Request) => Promise<Reply>): Route {
  return { method, ...compile(path), access, handler };
}

export function publicRoute(method: string, path: string, handler: (request: Request<Session | null>) => Promise<Reply>): Route {
  return { method, ...compile(path), access: "public", handler };
}

export const json = (status: number, body?: unknown, headers?: Record<string, string>): Reply => ({ status, body, headers });

function send(response: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...reply.headers };
  if (reply.raw) {
    response.writeHead(reply.status, headers).end(reply.raw);
  } else if (reply.body === undefined) {
    response.writeHead(reply.status, headers).end();
  } else {
    response.writeHead(reply.status, { ...headers, "Content-Type": "application/json" }).end(JSON.stringify(reply.body));
  }
}

const sendError = (response: ServerResponse, error: ApiError) => send(response, json(error.status, error.body()));

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const declared = Number(request.headers["content-length"] ?? "0");
  if (declared > BODY_LIMIT) throw new ApiError(413, "payload_too_large", "The request body is larger than 65536 bytes.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    // An oversized body is read to its end (so the client gets the answer) but never kept.
    if (size <= BODY_LIMIT) chunks.push(chunk as Buffer);
  }
  if (size > BODY_LIMIT) throw new ApiError(413, "payload_too_large", "The request body is larger than 65536 bytes.");
  return Buffer.concat(chunks);
}

export function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  const host = request.headers.host ?? "";
  return origin === `http://${host}` || origin === `https://${host}`;
}

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function api(routes: readonly Route[], request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  const method = request.method ?? "GET";
  const raw = await readBody(request);
  if (WRITES.has(method)) {
    const mediaType = (request.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
    if (raw.length > 0 && mediaType !== "application/json") {
      throw new ApiError(415, "unsupported_media_type", "Request bodies must be JSON.");
    }
    if (!sameOrigin(request)) throw new ApiError(403, "cross_origin", "Writes are only accepted from this app's own pages.");
  }
  let matched: { route: Route; params: Record<string, string> } | null = null;
  for (const candidate of routes) {
    const found = candidate.method === method ? candidate.pattern.exec(url.pathname) : null;
    if (found) {
      matched = { route: candidate, params: Object.fromEntries(candidate.keys.map((key, i) => [key, decodeURIComponent(found[i + 1] ?? "")])) };
      break;
    }
  }
  if (!matched) throw notFound();
  const { route: found, params } = matched;
  let body: unknown;
  if (raw.length > 0) {
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      body = undefined;
    }
  }
  const base = { method, params, query: url.searchParams, headers: request.headers, body };
  const reply =
    found.access === "public"
      ? await found.handler({ ...base, session: await readSession(request.headers.cookie) })
      : await found.handler({ ...base, session: await requireSession(request, found.access) });
  send(response, reply);
}

async function requireSession(request: IncomingMessage, access: Access): Promise<Session> {
  const session = await readSession(request.headers.cookie);
  if (!session) throw new ApiError(401, "unauthenticated", "Sign in first.");
  if (access !== "signed-in" && session.role !== access) {
    throw new ApiError(403, "forbidden", access === "operator" ? "Only the game operator can do this." : "Only managers can do this.");
  }
  return session;
}

async function serveClient(response: ServerResponse, path: string): Promise<void> {
  if (CLIENT_ROUTES.some((pattern) => pattern.test(path))) {
    const page = await readFile(`${CLIENT_DIR}index.html`);
    send(response, { status: 200, raw: page, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" } });
    return;
  }
  const type = ASSET_TYPES[extname(path)];
  const file = normalize(path).replace(/^\/+/, "");
  if (path.startsWith("/assets/") && type && !file.includes("..")) {
    try {
      const asset = await readFile(`${CLIENT_DIR}${file}`);
      send(response, { status: 200, raw: asset, headers: { "Content-Type": type, "Cache-Control": "no-cache" } });
      return;
    } catch {
      // falls through to the 404 below
    }
  }
  sendError(response, notFound());
}

export function handler(routes: readonly Route[]) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? "/", "http://app.invalid");
    try {
      if (url.pathname.startsWith("/api/")) await api(routes, request, response, url);
      else await serveClient(response, url.pathname);
    } catch (error) {
      if (error instanceof ApiError) {
        sendError(response, error);
      } else {
        console.error(`${request.method} ${url.pathname}:`, error);
        sendError(response, new ApiError(500, "internal", "Something went wrong on the server. Try again."));
      }
    }
  };
}
