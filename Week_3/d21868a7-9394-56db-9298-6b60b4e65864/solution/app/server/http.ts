// The one error shape and the HTTP plumbing every endpoint shares.
import type { IncomingMessage, ServerResponse } from "node:http";

/** `{"error","message"}` plus any extra fields the endpoint row names. */
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

/** `422 {"errors":{"<field>":"<message>"}}`. */
export class ValidationError extends Error {
  constructor(readonly errors: Record<string, string>) {
    super("validation failed");
  }
}

export const notFound = () => new ApiError(404, "not_found", "Nothing was found at that address.");
export const forbidden = () => new ApiError(403, "forbidden", "Your role cannot do that.");
export const notSignedIn = () => new ApiError(401, "not_signed_in", "Sign in to continue.");
export const databaseUnavailable = () =>
  new ApiError(503, "database_unavailable", "The database is not answering yet. Try again shortly.");

/** Collects field errors and throws them together. */
export class FieldErrors {
  private readonly errors: Record<string, string> = {};
  add(field: string, message: string): void {
    this.errors[field] ??= message;
  }
  throwIfAny(): void {
    if (Object.keys(this.errors).length) throw new ValidationError(this.errors);
  }
}

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

export function sendBytes(res: ServerResponse, status: number, body: Buffer, headers: Record<string, string>): void {
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Length": body.length, ...headers });
  res.end(body);
}

export function sendError(res: ServerResponse, error: ApiError | ValidationError): void {
  if (error instanceof ValidationError) sendJson(res, 422, { errors: error.errors });
  else sendJson(res, error.status, { error: error.code, message: error.message, ...error.extra });
}

export function isJson(req: IncomingMessage): boolean {
  const type = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
  return type === "application/json";
}

/** Reads the body, refusing anything over `limit` bytes with 413 before it is all buffered. */
export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? "0");
  if (declared > limit) {
    req.resume();
    throw new ApiError(413, "too_large", "That request body is too large.");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) {
      req.resume();
      throw new ApiError(413, "too_large", "That request body is too large.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const jar = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) jar.set(part.slice(0, at).trim(), decodeURIComponent(part.slice(at + 1).trim()));
  }
  return jar;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export { SECURITY_HEADERS };
