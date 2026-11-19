// Request context, the single error shape and the response helpers.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApiErrorBody } from "../shared/api.ts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
    readonly headers: Record<string, string> = {},
  ) {
    super(body.error);
  }
}

export const fail = {
  unauthenticated: () => new ApiError(401, { error: "unauthenticated" }),
  invalidCredentials: () => new ApiError(401, { error: "invalid_credentials" }),
  forbidden: () => new ApiError(403, { error: "forbidden" }),
  notFound: () => new ApiError(404, { error: "not_found" }),
  methodNotAllowed: () => new ApiError(405, { error: "method_not_allowed" }),
  readOnly: () => new ApiError(405, { error: "read_only" }),
  conflict: (error: string, extra: Omit<ApiErrorBody, "error"> = {}) => new ApiError(409, { error, ...extra }),
  gone: (status: ApiErrorBody["status"]) => new ApiError(410, { error: "invite_unavailable", status }),
  stale: (current: ApiErrorBody["current"]) => new ApiError(412, { error: "stale_revision", current }),
  tooLarge: () => new ApiError(413, { error: "too_large" }),
  unsupportedFileType: () => new ApiError(415, { error: "unsupported_file_type" }),
  unsupportedMediaType: () => new ApiError(415, { error: "unsupported_media_type" }),
  malformedJson: () => new ApiError(400, { error: "malformed_json" }),
  invalid: (errors: Record<string, string>) => new ApiError(422, { error: "invalid", errors }),
  rateLimited: (seconds: number) =>
    new ApiError(429, { error: "rate_limited", retryAfterSeconds: seconds }, { "Retry-After": String(seconds) }),
  storage: () => new ApiError(503, { error: "storage_unavailable" }),
  mail: () => new ApiError(503, { error: "mail_unavailable" }),
  internal: () => new ApiError(500, { error: "internal" }),
};

export type JsonBody = Record<string, unknown>;

export interface Context {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  params: Record<string, string>;
  raw: Buffer;
  body: JsonBody;
  cookies: Record<string, string>;
}

export interface Reply {
  status: number;
  body?: unknown;
  bytes?: Buffer;
  contentType?: string;
  headers?: Record<string, string>;
}

export const ok = (body: unknown, status = 200, headers: Record<string, string> = {}): Reply => ({ status, body, headers });
export const noContent = (): Reply => ({ status: 204 });
export const bytes = (data: Buffer, contentType: string, headers: Record<string, string> = {}): Reply => ({
  status: 200,
  bytes: data,
  contentType,
  headers,
});

export function errorReply(error: ApiError): Reply {
  return { status: error.status, body: error.body, headers: error.headers };
}

export function send(res: ServerResponse, reply: Reply): void {
  for (const [name, value] of Object.entries(reply.headers ?? {})) res.setHeader(name, value);
  if (reply.bytes) {
    res.setHeader("Content-Type", reply.contentType ?? "application/octet-stream");
    res.setHeader("Content-Length", reply.bytes.length);
    res.writeHead(reply.status);
    res.end(reply.bytes);
    return;
  }
  if (reply.body === undefined) {
    res.writeHead(reply.status);
    res.end();
    return;
  }
  const payload = Buffer.from(JSON.stringify(reply.body), "utf8");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", payload.length);
  res.writeHead(reply.status);
  res.end(payload);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) cookies[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return cookies;
}
