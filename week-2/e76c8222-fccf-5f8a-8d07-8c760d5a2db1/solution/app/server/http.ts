// The HTTP boundary: one origin serving the built client and /api, nothing else.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import type { User } from "../shared/api.js";
import type { Role } from "../shared/domain.js";
import { sessionUser } from "./auth.js";
import { ApiError } from "./errors.js";
import { parseMultipart, type Part } from "./uploads.js";

const JSON_LIMIT = 64 * 1024;
export const UPLOAD_LIMIT = 10 * 1024 * 1024;
const MULTIPART_LIMIT = UPLOAD_LIMIT + 1024 * 1024;

type JsonBody = Record<string, unknown>;

export interface Ctx {
  req: IncomingMessage;
  url: URL;
  params: Record<string, string>;
  user: User | null;
  /** The parsed JSON body ({} when empty). */
  body: JsonBody;
  parts: Part[];
}

/** A signed-in context, as handlers behind an access rule receive it. */
export type AuthedCtx = Ctx & { user: User };

export interface Reply {
  status: number;
  json?: unknown;
  /** A pre-serialised JSON body, replayed byte for byte. */
  text?: string;
  bytes?: Buffer;
  headers?: Record<string, string>;
}

type Access = "public" | "signed-in" | readonly Role[];

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  access: Access;
  body: "json" | "multipart" | "none";
  handler: (ctx: AuthedCtx) => Promise<Reply>;
}

const routes: Route[] = [];

export function route(
  method: string,
  path: string,
  access: Access,
  handler: (ctx: AuthedCtx) => Promise<Reply>,
  body: Route["body"] = method === "GET" || method === "DELETE" ? "none" : "json",
): void {
  const keys: string[] = [];
  const source = path.replace(/:([a-z_]+)/g, (_m, key: string) => {
    keys.push(key);
    return "([^/]+)";
  });
  routes.push({ method, pattern: new RegExp(`^${source}$`), keys, access, body, handler });
}

export const json = (status: number, value: unknown, headers?: Record<string, string>): Reply => ({ status, json: value, headers });

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size <= limit) chunks.push(chunk);
  }
  if (size > limit) throw new ApiError("payload_too_large");
  return Buffer.concat(chunks);
}

function parseJson(raw: Buffer): JsonBody {
  if (raw.length === 0) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new ApiError("bad_json");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("bad_json", {}, "Send a JSON object.");
  }
  return value as JsonBody;
}

function crossOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined || ["GET", "HEAD"].includes(req.method ?? "GET")) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { "cache-control": "no-store", ...reply.headers };
  if (reply.bytes) {
    res.writeHead(reply.status, headers).end(reply.bytes);
    return;
  }
  if (reply.json === undefined && reply.text === undefined) {
    res.writeHead(reply.status, headers).end();
    return;
  }
  const text = reply.text ?? JSON.stringify(reply.json);
  res.writeHead(reply.status, { "content-type": "application/json; charset=utf-8", ...headers }).end(text);
}

const sendError = (res: ServerResponse, error: ApiError): void => send(res, json(error.status, error.toBody()));

async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  try {
    if (crossOrigin(req)) throw new ApiError("cross_origin");
    const method = req.method ?? "GET";
    let match: { route: Route; params: Record<string, string> } | null = null;
    for (const candidate of routes) {
      const found = candidate.method === method ? candidate.pattern.exec(url.pathname) : null;
      if (found) {
        const params: Record<string, string> = {};
        candidate.keys.forEach((key, i) => {
          params[key] = decodeURIComponent(found[i + 1] ?? "");
        });
        match = { route: candidate, params };
        break;
      }
    }
    if (!match) throw new ApiError("not_found");
    const { route: hit, params } = match;
    const user = await sessionUser(req);
    if (hit.access !== "public") {
      if (!user) throw new ApiError("unauthenticated");
      if (hit.access !== "signed-in" && !hit.access.includes(user.role)) throw new ApiError("forbidden");
    }
    let body: JsonBody = {};
    let parts: Part[] = [];
    if (hit.body === "json") body = parseJson(await readBody(req, JSON_LIMIT));
    if (hit.body === "multipart") parts = parseMultipart(await readBody(req, MULTIPART_LIMIT), req.headers["content-type"] ?? "");
    if (hit.body === "none") req.resume();
    send(res, await hit.handler({ req, url, params, user, body, parts } as AuthedCtx));
  } catch (error) {
    if (error instanceof ApiError) {
      req.resume();
      sendError(res, error);
      return;
    }
    console.error("unhandled", error);
    sendError(res, new ApiError("internal"));
  }
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

async function listFiles(root: string, dir: string = root): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => (entry.isDirectory() ? listFiles(root, join(dir, entry.name)) : Promise.resolve([join(dir, entry.name)]))),
  );
  return nested.flat();
}

/** Serves the built client: known asset paths, the shell for client routes, 404 for anything else. */
async function staticFiles(root: string): Promise<(url: URL, res: ServerResponse) => Promise<void>> {
  const files = new Map<string, { bytes: Buffer; type: string }>();
  for (const file of await listFiles(root)) {
    const path = `/${relative(root, file).split(sep).join("/")}`;
    files.set(path, { bytes: await readFile(file), type: TYPES[extname(file)] ?? "application/octet-stream" });
  }
  const shell = files.get("/index.html");
  return async (url, res) => {
    const asset = url.pathname === "/index.html" ? undefined : files.get(url.pathname);
    const last = url.pathname.split("/").pop() ?? "";
    const hit = asset ?? (last.includes(".") ? undefined : shell);
    if (!hit) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
    res.writeHead(200, { "content-type": hit.type, "cache-control": "no-cache" }).end(hit.bytes);
  };
}

export async function createApp(clientRoot: string, ready: () => boolean): Promise<Server> {
  const serveStatic = await staticFiles(clientRoot);
  return createServer((req, res) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "same-origin");
    res.setHeader("x-frame-options", "DENY");
    const url = new URL(req.url ?? "/", "http://app.invalid");
    if (url.pathname === "/api/health") {
      req.resume();
      send(res, ready() ? json(200, { status: "ok" }) : json(503, { status: "starting" }));
      return;
    }
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      void api(req, res, url);
      return;
    }
    req.resume();
    void serveStatic(url, res);
  });
}
