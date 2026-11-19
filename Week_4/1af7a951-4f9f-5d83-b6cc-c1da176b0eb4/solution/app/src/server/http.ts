import type { IncomingMessage, ServerResponse } from "node:http";
import type { FieldErrors, JsonObject } from "./domain/validation.js";

/** Every API error leaves through this one type and `sendError`: `{"error": code, ...}` or 422 `{"errors": {...}}`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: { error: string; [extra: string]: unknown } | { errors: FieldErrors },
    readonly headers: Record<string, string> = {},
  ) {
    super("error" in body ? body.error : "validation");
  }
}

export const fail = (status: number, error: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): ApiError =>
  new ApiError(status, { error, ...extra }, headers);

export const invalid = (errors: FieldErrors): ApiError => new ApiError(422, { errors });

export const notFound = (): ApiError => fail(404, "not_found");

export interface Reply {
  status: number;
  json?: unknown;
  bytes?: { data: Buffer; contentType: string; headers: Record<string, string> };
  headers?: Record<string, string>;
  cookie?: string;
}

export const ok = (json: unknown, status = 200): Reply => ({ status, json });

const JSON_TYPE = "application/json; charset=utf-8";
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};

export function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { ...SECURITY_HEADERS, "Cache-Control": "no-store", ...reply.headers };
  if (reply.cookie) headers["Set-Cookie"] = reply.cookie;
  if (reply.bytes) {
    res.writeHead(reply.status, {
      ...headers,
      ...reply.bytes.headers,
      "Content-Type": reply.bytes.contentType,
      "Content-Length": String(reply.bytes.data.length),
    });
    res.end(reply.bytes.data);
    return;
  }
  if (reply.json === undefined) {
    res.writeHead(reply.status, headers);
    res.end();
    return;
  }
  const body = JSON.stringify(reply.json);
  res.writeHead(reply.status, { ...headers, "Content-Type": JSON_TYPE, "Content-Length": String(Buffer.byteLength(body)) });
  res.end(body);
}

export function sendError(res: ServerResponse, error: ApiError): void {
  send(res, { status: error.status, json: error.body, headers: error.headers });
}

const JSON_LIMIT = 64_000;
export const MEMO_LIMIT = 5_000_000;

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Same-origin writes. The app's own origin is the request's scheme and Host. A state-changing request fails
 * when its Origin differs (the literal "null" included), or when it has no Origin but says it is cross-site.
 */
export function checkOrigin(req: IncomingMessage): void {
  if (!STATE_CHANGING.has(req.method ?? "")) return;
  const origin = req.headers.origin;
  const scheme = "encrypted" in req.socket && req.socket.encrypted ? "https" : "http";
  if (origin !== undefined ? origin !== `${scheme}://${req.headers.host ?? ""}` : req.headers["sec-fetch-site"] === "cross-site") {
    throw fail(403, "cross_origin");
  }
}

function hasBody(req: IncomingMessage): boolean {
  return req.headers["transfer-encoding"] !== undefined || Number(req.headers["content-length"] ?? "0") > 0;
}

export function mediaType(req: IncomingMessage): string {
  return (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

/** Reads the whole body; past `limit` bytes it keeps draining but answers 413 so the client always gets a reply. */
export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += part.length;
    if (size <= limit) chunks.push(part);
  }
  if (size > limit) throw fail(413, "payload_too_large");
  return Buffer.concat(chunks);
}

/** The ladder's rungs 2 to 4 for a JSON endpoint: size, then content type, then a JSON object. */
export async function readJson(req: IncomingMessage): Promise<JsonObject> {
  if (!hasBody(req)) return {};
  const raw = await readBody(req, JSON_LIMIT);
  if (mediaType(req) !== "application/json") throw fail(415, "unsupported_media_type");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw fail(400, "invalid_json");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw fail(400, "invalid_json");
  return Object.fromEntries(Object.entries(parsed));
}

export function cookieValue(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}
