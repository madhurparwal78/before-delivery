import type { IncomingMessage, ServerResponse } from "node:http";

// The one error shape. Every API error is an ApiError, rendered by sendError.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const errors = {
  forbiddenOrigin: () => new ApiError(403, "FORBIDDEN_ORIGIN", "Requests must come from this site."),
  tooLarge: () => new ApiError(413, "PAYLOAD_TOO_LARGE", "The request body is too large."),
  mediaType: () => new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Send the body as application/json."),
  unauthenticated: () => new ApiError(401, "UNAUTHENTICATED", "Start as a guest or sign in first."),
  notFound: () => new ApiError(404, "NOT_FOUND", "Not found."),
  keyRequired: () => new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header."),
  keyReused: () => new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was used with a different body."),
  invalid: (fields: Record<string, string>) => new ApiError(422, "VALIDATION_FAILED", "Some fields are invalid.", fields),
  insufficient: () => new ApiError(402, "INSUFFICIENT_COINS", "Not enough coins."),
  conflict: (code: string, message: string) => new ApiError(409, code, message),
  locked: (code: string, message: string) => new ApiError(403, code, message),
  linkExpired: () => new ApiError(410, "LINK_EXPIRED", "This sign-in link has expired or was already used."),
  mailUnavailable: () => new ApiError(503, "MAIL_UNAVAILABLE", "The sign-in email could not be sent."),
  replayStorage: () => new ApiError(503, "REPLAY_STORAGE_UNAVAILABLE", "Replay storage is unavailable."),
  internal: () => new ApiError(500, "INTERNAL", "Something went wrong."),
};

export function errorBody(error: ApiError): string {
  const inner: { code: string; message: string; fields?: Record<string, string> } = { code: error.code, message: error.message };
  if (error.fields) inner.fields = error.fields;
  return JSON.stringify({ error: inner });
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  sendRaw(res, status, JSON.stringify(body), headers);
}

export function sendRaw(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  const payload = Buffer.from(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(payload.length),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

export function sendError(res: ServerResponse, error: ApiError): void {
  sendRaw(res, error.status, errorBody(error));
}

export function cookies(req: IncomingMessage): Map<string, string> {
  const jar = new Map<string, string>();
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) jar.set(part.slice(0, at).trim(), decodeURIComponent(part.slice(at + 1).trim()));
  }
  return jar;
}

const STATE_CHANGING = new Set(["POST", "PATCH", "PUT", "DELETE"]);

// Precedence step 1: origin, then media type, then size. Returns the raw body bytes.
export async function readRequest(req: IncomingMessage, limit: number): Promise<Buffer> {
  const method = req.method ?? "GET";
  const origin = req.headers.origin;
  if (STATE_CHANGING.has(method) && origin && !sameOrigin(origin, req.headers.host)) throw errors.forbiddenOrigin();
  if (method === "POST" || method === "PATCH") {
    const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") throw errors.mediaType();
  }
  const declared = Number(req.headers["content-length"] ?? "0");
  if (declared > limit) {
    req.resume();
    throw errors.tooLarge();
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const piece = chunk as Buffer;
    size += piece.length;
    if (size > limit) {
      req.resume();
      throw errors.tooLarge();
    }
    chunks.push(piece);
  }
  return Buffer.concat(chunks);
}

export function sameOrigin(origin: string, host: string | undefined): boolean {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// Parsed JSON body, or undefined when it does not parse (validation decides later).
export function parseJson(raw: Buffer): unknown {
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    return undefined;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
