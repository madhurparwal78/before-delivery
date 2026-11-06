// Request plumbing: the route table, the server-boundary checks and the one error helper that
// writes every /api error in the brief's shape.
import type { IncomingMessage, ServerResponse } from "node:http";
import { publicOrigin } from "./config.ts";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string,
    readonly extra: Record<string, unknown> = {}) {
    super(message);
  }
}

export function validationError(fields: Record<string, string>): ApiError {
  return new ApiError(422, "validation_failed", "Some fields need attention.", { fields });
}

export function notFound(): ApiError {
  return new ApiError(404, "not_found", "Nothing was found at this address.");
}

export const API_LIMIT = 1_000_000;
export const PUSH_LIMIT = 4_000_000;
export const DOSSIER_BODY_LIMIT = 5_000_000;

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(payload);
}

export function errorBody(error: ApiError): { error: Record<string, unknown> } {
  return { error: { code: error.code, message: error.message, ...error.extra } };
}

export function sendError(res: ServerResponse, error: ApiError): void {
  sendJson(res, error.status, errorBody(error));
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  body: Buffer;
}

/** The JSON object body; anything else is a validation failure on `body`. */
export function jsonBody(ctx: Ctx): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(ctx.body.toString("utf8") || "null");
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // fall through to the validation answer
  }
  throw validationError({ body: "must be a JSON object" });
}

type Handler = (ctx: Ctx) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  limit: number;
}

const routes: Route[] = [];

export function route(method: string, path: string, handler: Handler, limit = API_LIMIT): void {
  const keys: string[] = [];
  const pattern = new RegExp(`^${path.replace(/:([a-z_]+)/g, (_, key: string) => {
    keys.push(key);
    return "([^/]+)";
  })}$`);
  routes.push({ method, pattern, keys, handler, limit });
}

export function findRoute(method: string, path: string): { route: Route; params: Record<string, string> } | null {
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    const match = candidate.pattern.exec(path);
    if (match) {
      const params = Object.fromEntries(candidate.keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));
      return { route: candidate, params };
    }
  }
  return null;
}

export function hasBody(req: IncomingMessage): boolean {
  return Number(req.headers["content-length"] ?? 0) > 0 || req.headers["transfer-encoding"] !== undefined;
}

export function isJson(req: IncomingMessage): boolean {
  return (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase() === "application/json";
}

/** Reads the whole body; null when it is larger than `limit` (the rest is drained). */
export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size <= limit) chunks.push(chunk as Buffer);
  }
  return size > limit ? null : Buffer.concat(chunks);
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Same origin only: the configured public origin, or the origin the request was addressed to. */
export function crossOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!UNSAFE.has(req.method ?? "") || origin === undefined) return false;
  return origin !== publicOrigin && origin !== `http://${req.headers.host ?? ""}`;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
