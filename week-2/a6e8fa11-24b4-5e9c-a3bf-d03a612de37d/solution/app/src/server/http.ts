// The server boundary: request size, same-origin writes, sessions, routing, errors and static files.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, relative, sep } from "node:path";
import { LIMITS, MAX_IMPORT_REQUEST_BYTES } from "../shared/limits.js";
import { type Member, sessionMember } from "./auth.js";
import { type Db } from "./db.js";
import { ApiError, invalid, notFound, payloadTooLarge, storageUnavailable, unauthenticated } from "./errors.js";
import { StorageUnavailable } from "./services/storage.js";
import { type Part, parseMultipart } from "./files/multipart.js";

export interface Request {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage["headers"];
  body: Buffer;
  /** The form parts of an upload route. */
  parts: Part[] | null;
  /** Scheme, host and port of this request, as mail links use them. */
  origin: string;
  params: Record<string, string>;
}

export interface Reply {
  status: number;
  json?: unknown;
  /** A pre-rendered JSON body, sent byte for byte (idempotent replays). */
  rawJson?: string;
  file?: { data: Buffer; type: string; disposition?: string };
  headers?: Record<string, string>;
}

interface Ctx {
  req: Request;
  member: Member;
}

interface PublicCtx {
  req: Request;
}

type MemberHandler = (ctx: Ctx) => Promise<Reply>;
type PublicHandler = (ctx: PublicCtx) => Promise<Reply>;

interface Route {
  method: string;
  pattern: RegExp;
  names: string[];
  auth: boolean;
  upload: boolean;
  handler: MemberHandler | PublicHandler;
}

const routes: Route[] = [];

function compile(path: string): { pattern: RegExp; names: string[] } {
  const names: string[] = [];
  const source = path.replace(/:([a-zA-Z]+)/g, (_m, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  return { pattern: new RegExp(`^${source}$`), names };
}

export function member(method: string, path: string, handler: MemberHandler, options: { upload?: boolean } = {}): void {
  routes.push({ method, ...compile(path), auth: true, upload: options.upload ?? false, handler });
}

export function open(method: string, path: string, handler: PublicHandler): void {
  routes.push({ method, ...compile(path), auth: false, upload: false, handler });
}

/** Parses the JSON body; anything but an object is a validation error. */
export function jsonBody(req: Request): Record<string, unknown> {
  if (req.body.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(req.body.toString("utf8"));
  } catch {
    throw invalid({ body: "Send a JSON object." });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw invalid({ body: "Send a JSON object." });
  return parsed as Record<string, unknown>;
}

const BASE_HEADERS = { "X-Content-Type-Options": "nosniff" };
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { ...BASE_HEADERS, ...reply.headers };
  if (reply.file) {
    headers["Content-Type"] = reply.file.type;
    if (reply.file.disposition) headers["Content-Disposition"] = reply.file.disposition;
    res.writeHead(reply.status, headers);
    res.end(reply.file.data);
    return;
  }
  if (reply.rawJson === undefined && reply.json === undefined) {
    res.writeHead(reply.status, headers);
    res.end();
    return;
  }
  headers["Content-Type"] = "application/json; charset=utf-8";
  res.writeHead(reply.status, headers);
  res.end(reply.rawJson ?? JSON.stringify(reply.json));
}

function sendError(res: ServerResponse, error: ApiError): void {
  res.writeHead(error.status, { ...BASE_HEADERS, "Content-Type": "application/json; charset=utf-8" });
  res.end(error.body());
}

function readBody(raw: IncomingMessage, limit: number): Promise<Buffer> {
  // An import request is capped a little above its file part, but the published limit is the file's.
  const published = limit === MAX_IMPORT_REQUEST_BYTES ? LIMITS.maxImportBytes : limit;
  return new Promise((resolve, reject) => {
    const declared = Number(raw.headers["content-length"] ?? "0");
    if (declared > limit) {
      raw.resume();
      reject(payloadTooLarge(published));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    raw.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    raw.on("end", () =>
      size > limit ? reject(payloadTooLarge(published)) : resolve(Buffer.concat(chunks)),
    );
    raw.on("error", reject);
  });
}

export function cookie(headers: IncomingMessage["headers"], name: string): string | null {
  for (const part of (headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export const SESSION_COOKIE = "furrowbook_session";

async function handleApi(db: Db, raw: IncomingMessage, res: ServerResponse, url: { pathname: string; searchParams: URLSearchParams }): Promise<void> {
  const method = raw.method ?? "GET";
  const path = url.pathname;
  const route = routes.find((r) => r.method === method && r.pattern.test(path));
  try {
    const body = await readBody(raw, route?.upload ? MAX_IMPORT_REQUEST_BYTES : LIMITS.maxJsonBytes);
    const parts = route?.upload ? parseMultipart(body, raw.headers["content-type"]) : null;
    if (parts?.some((p) => p.filename !== null && p.data.length > LIMITS.maxImportBytes)) throw payloadTooLarge(LIMITS.maxImportBytes);
    const origin = `http://${raw.headers.host ?? ""}`;
    const sentOrigin = raw.headers.origin;
    if (STATE_CHANGING.has(method) && sentOrigin !== undefined && sentOrigin !== origin) {
      throw new ApiError(403, "cross_origin", "Cross-origin requests are not accepted.");
    }
    if (!route) throw notFound();
    const m = route.pattern.exec(path) as RegExpExecArray;
    const params = Object.fromEntries(route.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
    const req: Request = { method, path, query: url.searchParams, headers: raw.headers, body, parts, origin, params };
    let reply: Reply;
    if (route.auth) {
      const token = cookie(raw.headers, SESSION_COOKIE);
      const who = token ? await sessionMember(db, token) : null;
      if (!who) throw unauthenticated();
      reply = await (route.handler as MemberHandler)({ req, member: who });
    } else {
      reply = await (route.handler as PublicHandler)({ req });
    }
    send(res, reply);
  } catch (error) {
    if (error instanceof ApiError) {
      sendError(res, error);
      return;
    }
    if (error instanceof StorageUnavailable) {
      sendError(res, storageUnavailable());
      return;
    }
    console.error(error);
    sendError(res, new ApiError(500, "internal", "Something went wrong on the server."));
  }
}

// ---- static browser assets: only files under dist/client are ever served ----

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const PAGE_HEADERS = {
  "Content-Security-Policy":
    "connect-src 'self'; font-src 'self'; img-src 'self' data: blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "Referrer-Policy": "same-origin",
};

const APP_ROUTES = [/^\/$/, /^\/signin$/, /^\/station$/, /^\/w\/[^/]+$/, /^\/invite\/[^/]+$/, /^\/s\/[^/]+$/];

function staticFiles(dir: string): Map<string, { data: Buffer; type: string }> {
  const files = new Map<string, { data: Buffer; type: string }>();
  const walk = (folder: string): void => {
    for (const name of readdirSync(folder)) {
      const full = join(folder, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (TYPES[extname(name)]) files.set(`/${relative(dir, full).split(sep).join("/")}`, { data: readFileSync(full), type: TYPES[extname(name)] });
    }
  };
  walk(dir);
  return files;
}

function handleStatic(files: Map<string, { data: Buffer; type: string }>, raw: IncomingMessage, res: ServerResponse, url: { pathname: string }): void {
  const path = url.pathname;
  const asset = path === "/index.html" ? undefined : files.get(path);
  if (asset && (raw.method === "GET" || raw.method === "HEAD")) {
    res.writeHead(200, {
      ...BASE_HEADERS,
      "Content-Type": asset.type,
      "Cache-Control": path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    });
    res.end(raw.method === "HEAD" ? undefined : asset.data);
    return;
  }
  const page = files.get("/index.html") as { data: Buffer; type: string };
  const known = APP_ROUTES.some((r) => r.test(path));
  const share = path.startsWith("/s/");
  res.writeHead(known ? 200 : 404, {
    ...BASE_HEADERS,
    ...PAGE_HEADERS,
    "Content-Type": page.type,
    "Cache-Control": "no-store",
    ...(share ? { "Referrer-Policy": "no-referrer" } : {}),
  });
  res.end(raw.method === "HEAD" ? undefined : page.data);
}

export function createHandler(db: Db, clientDir: string): (raw: IncomingMessage, res: ServerResponse) => void {
  const files = staticFiles(clientDir);
  return (raw, res) => {
    const target = raw.url ?? "/";
    const q = target.indexOf("?");
    const url = { pathname: q < 0 ? target : target.slice(0, q), searchParams: new URLSearchParams(q < 0 ? "" : target.slice(q + 1)) };
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      void handleApi(db, raw, res, url);
      return;
    }
    handleStatic(files, raw, res, url);
  };
}
