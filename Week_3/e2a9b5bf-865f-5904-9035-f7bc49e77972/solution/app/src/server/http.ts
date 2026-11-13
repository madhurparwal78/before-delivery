import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { authenticate, type Authed } from "./auth";
import { LIMITS } from "./config";
import { ApiError, notFound, StorageUnavailable, unauthenticated } from "./errors";

export interface Reply {
  status: number;
  body?: unknown;
  /** Raw bytes with their content type, instead of a JSON body. */
  raw?: { data: Buffer; type: string };
  headers?: Record<string, string>;
}

interface Ctx {
  req: IncomingMessage;
  params: string[];
  /** The parsed JSON body; `undefined` when absent and `null` when it didn't parse. */
  body: unknown;
  account: Authed;
}

interface PublicCtx extends Omit<Ctx, "account"> {
  account: Authed | null;
}

interface Route {
  method: string;
  pattern: RegExp;
  auth: boolean;
  handler: (ctx: never) => Promise<Reply>;
}

const routes: Route[] = [];
let ready = false;

export function setReady(value: boolean): void {
  ready = value;
}

export function route(method: string, path: string, handler: (ctx: Ctx) => Promise<Reply>): void {
  routes.push({ method, pattern: new RegExp(`^${path.replace(/:[a-z_]+/g, "([^/]+)")}$`), auth: true, handler: handler as Route["handler"] });
}

export function publicRoute(method: string, path: string, handler: (ctx: PublicCtx) => Promise<Reply>): void {
  routes.push({ method, pattern: new RegExp(`^${path.replace(/:[a-z_]+/g, "([^/]+)")}$`), auth: false, handler: handler as Route["handler"] });
}

export const ok = (body: unknown, status = 200, headers?: Record<string, string>): Reply => ({ status, body, headers });

type Body = { kind: "ok"; data: Buffer } | { kind: "too_large" };

function readBody(req: IncomingMessage, limit: number): Promise<Body> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > limit) return Promise.resolve({ kind: "too_large" });
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        chunks.length = 0;
        resolve({ kind: "too_large" });
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve({ kind: "ok", data: Buffer.concat(chunks) }));
    req.on("error", reject);
  });
}

function parseJson(data: Buffer): unknown {
  if (data.length === 0) return undefined;
  try {
    return JSON.parse(data.toString("utf8"));
  } catch {
    return null;
  }
}

function send(res: ServerResponse, reply: Reply, close = false): void {
  const headers: Record<string, string> = { ...reply.headers };
  let payload: Buffer | string = "";
  if (reply.raw) {
    headers["content-type"] = reply.raw.type;
    payload = reply.raw.data;
  } else if (reply.body !== undefined) {
    headers["content-type"] = "application/json; charset=utf-8";
    payload = JSON.stringify(reply.body);
  }
  headers["content-length"] = String(Buffer.byteLength(payload));
  if (close) headers.connection = "close";
  res.writeHead(reply.status, headers);
  res.end(payload);
}

const fail = (error: ApiError): Reply => ({ status: error.status, body: error.body, headers: error.headers });

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function safeDecode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

async function handleApi(req: IncomingMessage, path: string): Promise<{ reply: Reply; close: boolean }> {
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  let body: unknown;
  if (hasBody) {
    const limit = path === "/api/sync" ? LIMITS.syncBodyBytes : LIMITS.bodyBytes;
    const read = await readBody(req, limit);
    if (read.kind === "too_large") return { reply: { status: 413, body: { error: "too_large" } }, close: true };
    const type = String(req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
    if (read.data.length > 0 && type !== "application/json") {
      return { reply: { status: 415, body: { error: "unsupported_media_type" } }, close: false };
    }
    if (!sameOrigin(req)) return { reply: { status: 403, body: { error: "cross_origin" } }, close: false };
    body = parseJson(read.data);
  }
  if (path === "/api/health" && method === "GET") {
    return { reply: ready ? { status: 200, body: { status: "ok" } } : { status: 503, body: { status: "starting" } }, close: false };
  }
  if (!ready) return { reply: { status: 503, body: { status: "starting" } }, close: false };
  for (const candidate of routes) {
    const match = candidate.pattern.exec(path);
    if (candidate.method !== method || !match) continue;
    const params = match.slice(1).map(safeDecode);
    let account: Authed | null = null;
    if (candidate.auth) {
      account = await authenticate(req);
      if (!account) return { reply: fail(unauthenticated()), close: false };
    }
    const reply = await (candidate.handler as (ctx: { req: IncomingMessage; params: string[]; body: unknown; account: Authed | null }) => Promise<Reply>)({
      req,
      params,
      body,
      account,
    });
    return { reply, close: false };
  }
  return { reply: fail(notFound()), close: false };
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

export const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));

async function serveStatic(path: string): Promise<Reply> {
  const clean = normalize(safeDecode(path)).replace(/^([/\\])+/, "");
  const extension = extname(clean);
  const inside = join(PUBLIC_DIR, clean);
  if (clean !== "" && !clean.split(sep).some((part) => part.startsWith(".")) && extension && inside.startsWith(PUBLIC_DIR)) {
    try {
      const data = await readFile(inside);
      const immutable = extension === ".woff2";
      return { status: 200, raw: { data, type: TYPES[extension] ?? "application/octet-stream" }, headers: { "cache-control": immutable ? "public, max-age=86400" : "no-cache" } };
    } catch {
      return { status: 404, raw: { data: Buffer.from("Not found"), type: "text/plain; charset=utf-8" } };
    }
  }
  if (extension) return { status: 404, raw: { data: Buffer.from("Not found"), type: "text/plain; charset=utf-8" } };
  const data = await readFile(join(PUBLIC_DIR, "index.html"));
  return { status: 200, raw: { data, type: TYPES[".html"] ?? "text/html" }, headers: { "cache-control": "no-cache" } };
}

export function startServer(port: number): void {
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const isApi = path === "/api" || path.startsWith("/api/");
    const work = isApi
      ? handleApi(req, path).then(({ reply, close }) => ({
          reply: { ...reply, headers: { "cache-control": "no-store", ...reply.headers } },
          close,
        }))
      : serveStatic(path).then((reply) => ({ reply, close: false }));
    work
      .then(({ reply, close }) => send(res, reply, close))
      .catch((error: unknown) => {
        if (error instanceof ApiError) {
          send(res, { ...fail(error), headers: { "cache-control": "no-store", ...error.headers } });
          return;
        }
        if (error instanceof StorageUnavailable) {
          send(res, { status: 503, body: { error: "storage_unavailable" }, headers: { "cache-control": "no-store" } });
          return;
        }
        console.error("request failed", req.method, path, error instanceof Error ? error.message : error);
        if (!res.headersSent) send(res, { status: 500, body: { error: "internal" }, headers: { "cache-control": "no-store" } });
        else res.destroy();
      });
  });
  server.keepAliveTimeout = 5000;
  server.listen(port, "0.0.0.0");
}
