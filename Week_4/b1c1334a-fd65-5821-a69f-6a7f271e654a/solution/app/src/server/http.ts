// The server boundary and the one JSON error shape every API answer uses.
import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "./config.js";
import { type Json, JsonSyntaxError, parseJson } from "./json.js";

const MAX_BODY_BYTES = 1_000_000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const notFound = () => new ApiError(404, "not_found", "That was not found.");
export const forbidden = () => new ApiError(403, "forbidden", "Your role does not allow this.");
export const invalid = (fields: Record<string, string>) =>
  new ApiError(422, "invalid", "Some fields need attention.", { fields });

export interface Request {
  method: string;
  path: string;
  search: string;
  query: URLSearchParams;
  headers: IncomingMessage["headers"];
  raw: Buffer;
  body: Json | undefined;
  malformed: boolean; // a body that is not JSON is refused at the 422 step, like any other invalid field
}

export interface Reply {
  status: number;
  body: string;
  headers?: Record<string, string>;
}

export function json(status: number, payload: unknown, headers: Record<string, string> = {}): Reply {
  return { status, body: JSON.stringify(payload), headers };
}

export function errorReply(error: ApiError): Reply {
  return json(error.status, { error: { code: error.code, message: error.message, ...error.extra } });
}

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Reads the body and applies the boundary checks in their published order.
export async function readRequest(req: IncomingMessage): Promise<Request | ApiError> {
  const url = new URL(req.url ?? "/", config.publicUrl);
  const declared = Number(req.headers["content-length"] ?? "0");
  if (declared > MAX_BODY_BYTES) return new ApiError(413, "payload_too_large", "The request body is too large.");
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      tooLarge = true;
      break;
    }
    chunks.push(chunk);
  }
  if (tooLarge) return new ApiError(413, "payload_too_large", "The request body is too large.");
  const raw = Buffer.concat(chunks);
  if (raw.length > 0) {
    const type = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (type !== "application/json") return new ApiError(415, "unsupported_media_type", "Send the body as application/json.");
  }
  const method = (req.method ?? "GET").toUpperCase();
  if (STATE_CHANGING.has(method) && isCrossSite(req)) {
    return new ApiError(403, "cross_origin", "Requests from another site are refused.");
  }
  let body: Json | undefined;
  let malformed = false;
  if (raw.length > 0) {
    try {
      body = parseJson(raw.toString("utf8"));
    } catch (error) {
      if (!(error instanceof JsonSyntaxError)) throw error;
      malformed = true;
    }
  }
  return { method, path: url.pathname, search: url.search, query: url.searchParams, headers: req.headers, raw, body, malformed };
}

function isCrossSite(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin !== undefined) {
    if (origin === "null") return true;
    const allowed = [`http://${req.headers.host ?? ""}`, new URL(config.publicUrl).origin];
    return !allowed.includes(origin);
  }
  const site = req.headers["sec-fetch-site"];
  return site === "cross-site" || site === "same-site";
}

export function send(res: ServerResponse, reply: Reply, contentType = "application/json; charset=utf-8"): void {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(reply.status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...reply.headers,
  });
  res.end(reply.body);
}

export function cookie(req: { headers: IncomingMessage["headers"] }, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}
