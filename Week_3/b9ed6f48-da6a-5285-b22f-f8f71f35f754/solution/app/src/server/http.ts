// HTTP plumbing: the single error shape, body limits, content types, same-origin writes and a
// small router (brief: API › Error shape, Error precedence, Limits; Server boundary).

import type { IncomingMessage, ServerResponse } from "node:http";
import { COPY } from "../shared/copy.js";

const JSON_LIMIT = 65_536;
const UPLOAD_REQUEST_LIMIT = 20_100_000;

export type Fields = Record<string, string>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Fields,
  ) {
    super(message);
  }
}

export const fail = {
  validation: (fields: Fields) => new ApiError(422, "validation_failed", COPY.validation, fields),
  notFound: () => new ApiError(404, "not_found", COPY.notFound),
  unauthenticated: () => new ApiError(401, "unauthenticated", COPY.unauthenticated),
  forbidden: () => new ApiError(403, "forbidden", COPY.forbidden),
  conflict: (code: string, message: string) => new ApiError(409, code, message),
  billing: () => new ApiError(503, "billing_unavailable", COPY.billingDown),
  accounts: () => new ApiError(503, "accounts_unavailable", COPY.accountsDown),
  storage: (message: string = COPY.mediaUnavailable) => new ApiError(503, "storage_unavailable", message),
};

/** Throws a 422 when any field failed. */
export function assertValid(fields: Fields): void {
  if (Object.keys(fields).length) throw fail.validation(fields);
}

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export function errorBody(error: ApiError): unknown {
  return { error: { code: error.code, message: error.message, ...(error.status === 422 ? { fields: error.fields ?? {} } : {}) } };
}

export function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...reply.headers };
  if (reply.body === undefined) {
    res.writeHead(reply.status, headers).end();
    return;
  }
  const payload = Buffer.from(JSON.stringify(reply.body));
  res.writeHead(reply.status, { ...headers, "Content-Type": "application/json; charset=utf-8", "Content-Length": String(payload.length) });
  res.end(payload);
}

export function redirect(location: string): Reply {
  return { status: 302, headers: { Location: location } };
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? "0");
  if (declared > limit) throw new ApiError(413, "payload_too_large", COPY.tooLarge);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw new ApiError(413, "payload_too_large", COPY.tooLarge);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export interface Upload {
  fields: Record<string, string>;
  file: { filename: string; contentType: string; data: Buffer } | null;
}

function parseMultipart(body: Buffer, boundary: string): Upload {
  const delimiter = Buffer.from(`--${boundary}`);
  const upload: Upload = { fields: {}, file: null };
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const partStart = start + delimiter.length;
    if (body.subarray(partStart, partStart + 2).toString() === "--") break;
    const next = body.indexOf(delimiter, partStart);
    if (next === -1) break;
    const part = body.subarray(partStart + 2, next - 2);
    const split = part.indexOf("\r\n\r\n");
    const head = part.subarray(0, split).toString("utf8");
    const content = part.subarray(split + 4);
    const name = /name="([^"]*)"/i.exec(head)?.[1];
    const filename = /filename="([^"]*)"/i.exec(head)?.[1];
    const type = /content-type:\s*([^\r\n;]+)/i.exec(head)?.[1]?.trim() ?? "application/octet-stream";
    if (name === "file" && filename !== undefined) upload.file = { filename, contentType: type.toLowerCase(), data: Buffer.from(content) };
    else if (name) upload.fields[name] = content.toString("utf8");
    start = next;
  }
  return upload;
}

type BodyKind = "json" | "multipart" | "none";

export interface Context {
  req: IncomingMessage;
  url: URL;
  params: Record<string, string>;
  body: unknown;
  upload: Upload | null;
  cookies: Record<string, string>;
}

function cookies(req: IncomingMessage): Record<string, string> {
  const jar: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) jar[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
  }
  return jar;
}

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Limits and content type (413/415), then same-origin writes (403), in the brief's order; a body that
 * does not parse is left for fieldsOf (422). */
export async function prepare(req: IncomingMessage, url: URL, kind: BodyKind, params: Record<string, string>): Promise<Context> {
  const type = (req.headers["content-type"] ?? "").toLowerCase();
  const hasBody = Number(req.headers["content-length"] ?? "0") > 0 || req.headers["transfer-encoding"] !== undefined;
  let body: unknown = {};
  let upload: Upload | null = null;
  if (kind === "json" && hasBody) {
    if (!type.startsWith("application/json")) throw new ApiError(415, "unsupported_media_type", COPY.sendJson);
    const raw = await readBody(req, JSON_LIMIT);
    try {
      body = raw.length ? JSON.parse(raw.toString("utf8")) : {};
    } catch {
      body = undefined;
    }
  } else if (kind === "multipart") {
    const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(req.headers["content-type"] ?? "");
    if (!type.startsWith("multipart/form-data") || !boundary) throw new ApiError(415, "unsupported_media_type", COPY.sendJson);
    upload = parseMultipart(await readBody(req, UPLOAD_REQUEST_LIMIT), boundary[1] ?? boundary[2]);
  } else if (hasBody) {
    await readBody(req, JSON_LIMIT);
  }
  const origin = req.headers.origin;
  if (WRITES.has(req.method ?? "") && origin !== undefined && origin !== `http://${req.headers.host}`) {
    throw new ApiError(403, "forbidden_origin", COPY.forbiddenOrigin);
  }
  return { req, url, params, body, upload, cookies: cookies(req) };
}

type Handler = (ctx: Context) => Promise<Reply>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  kind: BodyKind;
  handler: Handler;
}

/** A path parameter that does not decode, or decodes to a control character, names no record. */
function pathParam(raw: string): string | null {
  try {
    const value = decodeURIComponent(raw);
    return /[\u0000-\u001f\u007f]/.test(value) ? null : value;
  } catch {
    return null;
  }
}

export class Router {
  private routes: Route[] = [];

  add(method: string, path: string, handler: Handler, kind: BodyKind = method === "GET" ? "none" : "json"): void {
    const keys: string[] = [];
    const pattern = new RegExp(`^${path.replace(/:(\w+)/g, (_, key: string) => (keys.push(key), "([^/]+)"))}$`);
    this.routes.push({ method, pattern, keys, kind, handler });
  }

  match(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method !== method && !(method === "HEAD" && route.method === "GET")) continue;
      const m = route.pattern.exec(pathname);
      if (!m) continue;
      const params: Record<string, string> = {};
      for (const [i, key] of route.keys.entries()) {
        const value = pathParam(m[i + 1]);
        if (value === null) return null;
        params[key] = value;
      }
      return { route, params };
    }
    return null;
  }
}

/** Reads a JSON body as a record of unknown values for field-by-field validation. A body that is
 * not a JSON object is a 422, so handlers call this after their auth, lookup and idempotency checks. */
export function fieldsOf(ctx: Context): Record<string, unknown> {
  const body = ctx.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw fail.validation({ body: COPY.sendJson });
  return body as Record<string, unknown>;
}
