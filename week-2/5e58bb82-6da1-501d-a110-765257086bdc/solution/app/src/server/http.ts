// HTTP plumbing: the one error shape, body readers with limits, and the route table.
import type { IncomingMessage, ServerResponse } from "node:http";

const JSON_LIMIT = 64_000;
export const FILE_LIMIT = 50_000_000;

type Extra = Record<string, unknown>;

/** Every API error is one of these; `extra` holds only the brief's published extra keys. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Extra = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export const notFound = () => new ApiError(404, "not_found", "That resource does not exist.");
export const forbidden = () => new ApiError(403, "forbidden", "Your role may not do this.");
export const unauthenticated = () => new ApiError(401, "unauthenticated", "Sign in to continue.");
export const storageUnavailable = () =>
  new ApiError(503, "storage_unavailable", "Storage is unavailable. Try again in a moment.", {}, { "Retry-After": "30" });
const internalError = () => new ApiError(500, "internal", "Something went wrong on the server.");
export const conflict = (code: string, message: string, extra: Extra = {}) => new ApiError(409, code, message, extra);

/** 422 with per-field messages. */
export function invalid(errors: Record<string, string>): ApiError {
  return new ApiError(422, "validation", "Some fields need attention.", { errors });
}

export function illegalTransition(message: string, from: string, to: string): ApiError {
  return conflict("illegal_transition", message, { from, to });
}

const BASE_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Cache-Control": "no-store",
};

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { ...BASE_HEADERS, "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(payload.length), ...headers });
  res.end(payload);
}

export function sendEmpty(res: ServerResponse, status: number, headers: Record<string, string> = {}): void {
  res.writeHead(status, { ...BASE_HEADERS, ...headers });
  res.end();
}

/** The one error body: code, message and only the published extra keys. */
export const errorBody = (error: ApiError) => ({ error: error.code, message: error.message, ...error.extra });

export function sendError(res: ServerResponse, error: unknown): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (error instanceof ApiError) {
    sendJson(res, error.status, errorBody(error), error.headers);
    return;
  }
  console.error("request failed:", error instanceof Error ? error.message : "unknown error");
  sendJson(res, 500, errorBody(internalError()));
}

export const payloadTooLarge = () => new ApiError(413, "payload_too_large", "The request body is too large.");

/** Rejects early when the declared length is over the limit; reading stops as soon as the client leaves. */
/** Reads a request header by its published name; Node keys incoming headers in lower case. */
export function headerValue(req: IncomingMessage, name: string): string {
  return String(req.headers[name.toLowerCase()] ?? "");
}

export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? NaN);
  if (Number.isFinite(declared) && declared > limit) {
    req.resume();
    return Promise.reject(payloadTooLarge());
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    /** The first outcome wins; later events are ignored. */
    const settle = (): boolean => {
      if (done) return false;
      done = true;
      req.off("data", onData);
      return true;
    };
    const fail = (error: Error) => {
      if (settle()) reject(error);
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        chunks.length = 0;
        req.resume();
        fail(payloadTooLarge());
        return;
      }
      chunks.push(chunk);
    };
    req.on("data", onData);
    req.on("end", () => {
      if (settle()) resolve(Buffer.concat(chunks, size));
    });
    req.on("close", () => {
      if (!req.complete) {
        chunks.length = 0;
        fail(new ClientGone());
      }
    });
    req.on("error", () => fail(new ClientGone()));
  });
}

/** The client left before its body arrived; nothing is answered or recorded. */
export class ClientGone extends Error {}

function isJsonType(value: string | undefined): boolean {
  return (value ?? "").split(";")[0].trim().toLowerCase() === "application/json";
}

/** Step 1 of the error precedence for JSON endpoints: 413 then 415, before anything else. */
export const unsupportedMedia = (type: string) => new ApiError(415, "unsupported_media_type", `Send this request as ${type}.`);

export async function readJson(req: IncomingMessage): Promise<unknown> {
  const hasBody = Number(req.headers["content-length"] ?? 0) > 0 || req.headers["transfer-encoding"] !== undefined;
  if (!hasBody && !req.headers["content-type"]) return {};
  const raw = await readBody(req, JSON_LIMIT);
  if (!isJsonType(req.headers["content-type"])) {
    throw unsupportedMedia("application/json");
  }
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw invalid({ body: "Send a JSON body" });
  }
}

type Params = Record<string, string>;

export interface Context {
  req: IncomingMessage;
  res: ServerResponse;
  params: Params;
  query: URLSearchParams;
}

type Handler = (ctx: Context) => Promise<void>;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  on(method: string, pattern: string, handler: Handler): this {
    this.routes.push({ method, parts: pattern.split("/").filter(Boolean), handler });
    return this;
  }

  match(method: string, path: string): { handler: Handler; params: Params } | null {
    const segments = path.split("/").filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method || route.parts.length !== segments.length) continue;
      const params: Params = {};
      let ok = true;
      for (let i = 0; i < segments.length && ok; i++) {
        const part = route.parts[i];
        if (part.startsWith(":")) {
          try {
            params[part.slice(1)] = decodeURIComponent(segments[i]);
          } catch {
            ok = false;
          }
        } else ok = part === segments[i];
      }
      if (ok) return { handler: route.handler, params };
    }
    return null;
  }
}

/** Type guards for request bodies. */
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const isString = (v: unknown): v is string => typeof v === "string";

