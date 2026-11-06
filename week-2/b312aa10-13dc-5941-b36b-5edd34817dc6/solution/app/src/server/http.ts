// The HTTP boundary: routing, the brief's error precedence, body limits, origin checks and the
// static allow-list. Every error leaves through `ApiError` and `sendError`, in one shape.

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { authenticate, type Session } from "./auth.js";
import { COPY, VARIANT_COPY, variantCopy, type Variant, type VariantArgs } from "../shared/copy.js";

type Extra = Record<string, unknown>;
type Headers = Record<string, string>;

/** An API error: only ever made from a published code and its copy, through the two factories below. */
export class ApiError extends Error {
  private constructor(readonly status: number, readonly code: string, message: string, readonly extra: Extra, readonly headers: Headers) {
    super(message);
  }

  /** An error whose code has one fixed published copy. */
  static fixed(status: number, code: keyof typeof COPY, extra: Extra = {}, headers: Headers = {}): ApiError {
    return new ApiError(status, code, COPY[code]!, extra, headers);
  }

  /** An error whose published copy has a variant or placeholders, filled from the given values. */
  static variant<V extends Variant>(status: number, variant: V, args: VariantArgs<V>, extra: Extra = {}, headers: Headers = {}): ApiError {
    return new ApiError(status, VARIANT_COPY[variant].code, variantCopy(variant, ...args), extra, headers);
  }
}

export const apiError = ApiError.fixed;
export const variantError = ApiError.variant;

export const notFound = (): ApiError => apiError(404, "not_found");
export const forbidden = (): ApiError => apiError(403, "forbidden");
export const invalid = (errors: Record<string, string>): ApiError => apiError(422, "validation_failed", { errors });

/** Throws the 422 when any field failed. */
export function refuseInvalid(errors: Record<string, string>): void {
  if (Object.keys(errors).length) throw invalid(errors);
}

const JSON_LIMIT = 100_000;
const UPLOAD_LIMIT = 5_200_000;
const FILE_LIMIT = 5_000_000;

type BodyKind = "json" | "multipart" | "none";

export interface Ctx {
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  headers: IncomingMessage["headers"];
  origin: string;
  raw: Buffer;
  body: unknown;
  session: Session | null;
}

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** A non-JSON payload (CSV, PDF, a stored file). */
  bytes?: Buffer;
}

type Handler = (ctx: Ctx) => Promise<Reply>;

interface Route {
  method: string;
  parts: string[];
  body: BodyKind;
  auth: boolean;
  idempotent: boolean;
  handler: Handler;
}

const routes: Route[] = [];

export function route(
  method: string,
  pattern: string,
  handler: Handler,
  options: { body?: BodyKind; auth?: boolean; idempotent?: boolean } = {},
): void {
  routes.push({
    method, parts: pattern.split("/").filter(Boolean), handler,
    body: options.body ?? (method === "GET" || method === "DELETE" ? "none" : "json"),
    auth: options.auth ?? true, idempotent: options.idempotent ?? false,
  });
}

function match(r: Route, segments: string[]): Record<string, string> | null {
  if (r.parts.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < r.parts.length; i++) {
    const p = r.parts[i]!;
    if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(segments[i]!);
    else if (p !== segments[i]) return null;
  }
  return params;
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;

function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) over = true;
      else chunks.push(chunk);
    });
    req.on("end", () => resolve(over ? null : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function contentType(headers: IncomingMessage["headers"]): string {
  return (headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
}

/**
 * Server boundary › Cross-site requests: `Origin` decides when present (`null` is never ours), then
 * `Sec-Fetch-Site`, then `Referer`. A request with none of the three is a non-browser client.
 */
function crossSite(headers: IncomingMessage["headers"]): boolean {
  const own = `http://${headers.host ?? ""}`;
  const origin = headers.origin;
  if (origin !== undefined) return origin !== own;
  const fetchSite = headers["sec-fetch-site"];
  if (fetchSite !== undefined) return fetchSite === "cross-site" || fetchSite === "same-site";
  const referer = headers.referer;
  if (referer === undefined) return false;
  try {
    const url = new URL(referer);
    return `${url.protocol}//${url.host}` !== own && url.origin !== own;
  } catch {
    return true;
  }
}

async function dispatch(req: IncomingMessage): Promise<Reply> {
  const url = new URL(req.url ?? "/", "http://lineboard.invalid");
  const segments = url.pathname.split("/").filter(Boolean);
  const method = req.method ?? "GET";
  const isInspect = segments[0] === "api" && segments[1] === "inspect";
  // Precedence step 1, before the inspector's 405, any body read, session or key.
  if (method !== "GET" && method !== "HEAD" && crossSite(req.headers)) throw apiError(403, "cross_origin");
  if (isInspect && method !== "GET") throw apiError(405, "read_only");
  let found: { r: Route; params: Record<string, string> } | null = null;
  for (const r of routes) {
    const params = r.method === method ? match(r, segments) : null;
    if (params) {
      found = { r, params };
      break;
    }
  }
  if (!found) {
    // Only the published surface: an unlisted method or path passes the cross-origin, size and
    // session steps, then answers 404 and touches nothing.
    if ((await readBody(req, JSON_LIMIT)) === null) throw apiError(413, "payload_too_large");
    if (!(await authenticate(req.headers.cookie))) throw apiError(401, "unauthenticated");
    throw notFound();
  }
  const { r, params } = found;
  const raw = await readBody(req, r.body === "multipart" ? UPLOAD_LIMIT : JSON_LIMIT);
  if (raw === null) throw apiError(413, "payload_too_large");
  let body: unknown = {};
  if (r.body === "multipart") {
    const form = parseMultipart(raw, req.headers["content-type"] ?? "");
    if ([...form.files.values()].some((f) => f.data.length > FILE_LIMIT)) {
      throw apiError(413, "payload_too_large");
    }
    body = form;
  } else if (raw.length > 0 && r.body === "json") {
    if (contentType(req.headers) !== "application/json") {
      throw apiError(415, "unsupported_media_type");
    }
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      throw apiError(400, "bad_request");
    }
  }
  const session = r.auth ? await authenticate(req.headers.cookie) : null;
  if (r.auth && !session) throw apiError(401, "unauthenticated");
  if (r.idempotent && !IDEMPOTENCY_KEY.test(String(req.headers["idempotency-key"] ?? ""))) {
    throw apiError(400, "idempotency_key_required");
  }
  return r.handler({
    method, path: url.pathname, query: url.searchParams, params, headers: req.headers,
    origin: `http://${req.headers.host}`, raw, body, session,
  });
}

function send(res: ServerResponse, reply: Reply, last: Record<string, string> = {}): void {
  const headers: Record<string, string> = { "X-Content-Type-Options": "nosniff", ...reply.headers, ...last };
  if (reply.bytes) {
    res.writeHead(reply.status, headers);
    res.end(reply.bytes);
  } else if (reply.body === undefined) {
    res.writeHead(reply.status, headers);
    res.end();
  } else {
    res.writeHead(reply.status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers, ...last });
    res.end(JSON.stringify(reply.body));
  }
}

export function errorBody(error: ApiError): Record<string, unknown> {
  return { error: error.code, message: error.message, ...error.extra };
}

function sendError(res: ServerResponse, error: unknown, last: Record<string, string>): void {
  if (error instanceof ApiError) {
    const headers: Record<string, string> = { ...(error.status === 413 ? { Connection: "close" } : {}), ...error.headers };
    send(res, { status: error.status, body: errorBody(error), headers }, last);
    return;
  }
  // The cause goes to the server log only; the body is the published copy and nothing else.
  console.error(error);
  send(res, { status: 500, body: errorBody(apiError(500, "internal")) }, last);
}

// The built browser app: screen addresses get index.html, built files are served by exact name.
const SCREENS = new Set(["", "board", "bookings", "documents", "invoices", "reports", "sanitation", "settings"]);
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2",
  ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml",
};
const PAGE_HEADERS = { "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY" };
const files = new Map<string, { bytes: Buffer; type: string }>();

/**
 * The signed-in context a screen document starts from (what GET /api/session and GET /api/kitchen
 * answer for its cookie), or null when signed out, so the frame draws on load without a round trip.
 */
type ScreenBoot = (cookieHeader: string | undefined) => Promise<unknown>;
let screenBoot: ScreenBoot = async () => null;

export async function loadClient(dir: string, boot: ScreenBoot): Promise<void> {
  screenBoot = boot;
  const walk = async (rel: string): Promise<void> => {
    for (const entry of await readdir(join(dir, rel), { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path);
      else {
        const ext = entry.name.slice(entry.name.lastIndexOf("."));
        const type = TYPES[ext];
        if (type) files.set(`/${path}`, { bytes: await readFile(join(dir, path)), type });
      }
    }
  };
  await walk("");
}

async function staticReply(path: string, cookieHeader: string | undefined): Promise<Reply | null> {
  const segments = path.split("/").filter(Boolean);
  const inspect = segments.length === 2 && segments[0] === "inspect";
  if (inspect || (segments.length <= 1 && SCREENS.has(segments[0] ?? ""))) {
    const page = files.get("/index.html")!;
    // The inspector view never reads a session: a token is never one.
    const boot = JSON.stringify(inspect ? null : await screenBoot(cookieHeader)).replace(/</g, "\\u003c");
    const bytes = Buffer.from(page.bytes.toString("utf8").replace('<div id="root">', `<script id="boot" type="application/json">${boot}</script><div id="root">`));
    return { status: 200, bytes, headers: { "Content-Type": page.type, "Cache-Control": "no-store", ...PAGE_HEADERS } };
  }
  const file = path !== "/index.html" ? files.get(path) : undefined;
  return file ? { status: 200, bytes: file.bytes, headers: { "Content-Type": file.type, "Cache-Control": "public, max-age=3600" } } : null;
}

/** Every inspector response, errors included, is never cached and never sent on as a referrer. */
const INSPECT_HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
/** Every /api response, success or error, JSON or bytes, is never cached (shared-tablet hand-over). */
const API_HEADERS = { "Cache-Control": "no-store" };

export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = new URL(req.url ?? "/", "http://lineboard.invalid").pathname;
  const last = /^\/(api\/)?inspect(\/|$)/.test(path) ? INSPECT_HEADERS : path === "/api" || path.startsWith("/api/") ? API_HEADERS : {};
  try {
    if (!path.startsWith("/api/") && (req.method === "GET" || req.method === "HEAD")) {
      const reply = await staticReply(path, req.headers.cookie);
      if (!reply) throw notFound();
      send(res, reply, last);
      return;
    }
    send(res, await dispatch(req), last);
  } catch (error) {
    sendError(res, error, last);
  }
}

/**
 * A buffered form body split into text fields and files. Uploads are multipart/form-data; a
 * url-encoded form is read as the same parts, and since it cannot carry a file it reaches the
 * missing-file check.
 */
export interface MultipartForm {
  fields: Map<string, string>;
  files: Map<string, { name: string; data: Buffer }>;
}

function parseMultipart(raw: Buffer, contentTypeHeader: string): MultipartForm {
  const type = contentTypeHeader.split(";")[0]!.trim().toLowerCase();
  if (type === "application/x-www-form-urlencoded") {
    return { fields: new Map(new URLSearchParams(raw.toString("utf8"))), files: new Map() };
  }
  if (type !== "multipart/form-data") {
    throw apiError(415, "unsupported_media_type");
  }
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentTypeHeader);
  if (!boundary) throw apiError(415, "unsupported_media_type");
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const fields = new Map<string, string>();
  const filesOut = new Map<string, { name: string; data: Buffer }>();
  let pos = raw.indexOf(delimiter);
  while (pos !== -1) {
    const start = pos + delimiter.length;
    if (raw.subarray(start, start + 2).toString() === "--") break;
    const headerEnd = raw.indexOf("\r\n\r\n", start);
    const next = raw.indexOf(delimiter, start);
    if (headerEnd === -1 || next === -1) break;
    const head = raw.subarray(start, headerEnd).toString("utf8");
    const data = raw.subarray(headerEnd + 4, next - 2);
    const name = /name="([^"]*)"/i.exec(head)?.[1];
    const filename = /filename="([^"]*)"/i.exec(head)?.[1];
    if (name !== undefined) {
      if (filename !== undefined) filesOut.set(name, { name: filename, data });
      else fields.set(name, data.toString("utf8"));
    }
    pos = next;
  }
  return { fields, files: filesOut };
}
